import json

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.models.channel import ChannelUpdateRequest, ChannelResponse, PermissionOverwriteResponse
from app.models.guild import PermissionOverwriteRequest
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_channel_stub, get_member_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import (
    require_permission,
    ADMINISTRATOR,
    MANAGE_CHANNELS,
    MANAGE_ROLES,
)

router = APIRouter(prefix="/api/v10/channels", tags=["channels"])


def _channel_response_from_proto(
    ch,
    overwrites: list[PermissionOverwriteResponse] | None = None,
) -> ChannelResponse:
    return ChannelResponse(
        id=str(ch.id),
        guild_id=str(ch.guild_id) if ch.guild_id else None,
        type=ch.type,
        name=ch.name,
        topic=ch.topic,
        position=ch.position or 0,
        parent_id=str(ch.parent_id) if ch.parent_id else None,
        nsfw=ch.nsfw or False,
        bitrate=ch.bitrate,
        user_limit=ch.user_limit,
        rate_limit_per_user=ch.rate_limit_per_user or 0,
        rtc_region=ch.rtc_region,
        video_quality_mode=ch.video_quality_mode,
        last_message_id=str(ch.last_message_id) if ch.last_message_id else None,
        permission_overwrites=overwrites or [
            PermissionOverwriteResponse(
                id=str(ow.id), type=ow.type,
                allow=str(ow.allow), deny=str(ow.deny),
            )
            for ow in (ch.permission_overwrites or [])
        ],
    )


async def _get_channel_and_check_access(channel_id: int, user_id: int):
    """Fetch channel via gRPC and verify user has access."""
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=channel_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    guild_id = channel.guild_id
    if guild_id:
        member_stub = await get_member_stub()
        try:
            resp = await member_stub.IsMember(
                pb2.IsMemberRequest(guild_id=guild_id, user_id=user_id)
            )
            if not resp.is_member:
                raise HTTPException(
                    status_code=403,
                    detail={"code": 50001, "message": "Missing Access"},
                )
        except grpc.RpcError:
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )
        # Enforce VIEW_CHANNEL so a private channel (VIEW_CHANNEL denied via overwrite)
        # is inaccessible even to guild members, matching messages.get_channel_with_access.
        from app.services.permissions import (
            compute_channel_permissions, has_permission, VIEW_CHANNEL,
        )
        perms = await compute_channel_permissions(guild_id, channel_id, user_id)
        if not has_permission(perms, VIEW_CHANNEL):
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )
    elif channel.type in (1, 3):
        # DM or Group DM -- check dm_channels membership via gRPC
        try:
            dm_members = await ch_stub.GetDmMembers(
                pb2.GetDmMembersRequest(channel_id=channel_id)
            )
            if user_id not in dm_members.user_ids:
                raise HTTPException(
                    status_code=403,
                    detail={"code": 50001, "message": "Missing Access"},
                )
        except grpc.RpcError:
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )

    return channel


# ---------- GET /channels/{channel_id} ----------

@router.get("/{channel_id}")
async def get_channel(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    channel = await _get_channel_and_check_access(cid, int(user_id))
    return _channel_response_from_proto(channel).model_dump()


# ---------- PATCH /channels/{channel_id} ----------

@router.patch("/{channel_id}")
async def update_channel(
    channel_id: str,
    body: ChannelUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_and_check_access(cid, uid)
    guild_id = channel.guild_id

    if guild_id:
        await require_permission(guild_id, uid, MANAGE_CHANNELS, channel_id=cid)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    # Build gRPC update request
    update_kwargs: dict = {"channel_id": cid}
    if "name" in updates:
        update_kwargs["name"] = updates["name"]
    if "topic" in updates:
        update_kwargs["topic"] = updates["topic"]
    if "nsfw" in updates:
        update_kwargs["nsfw"] = updates["nsfw"]
    if "bitrate" in updates:
        update_kwargs["bitrate"] = updates["bitrate"]
    if "user_limit" in updates:
        update_kwargs["user_limit"] = updates["user_limit"]
    if "rate_limit_per_user" in updates:
        update_kwargs["rate_limit_per_user"] = updates["rate_limit_per_user"]
    if "parent_id" in updates:
        # has_parent_id tells the data layer to apply parent_id (a null value moves
        # the channel to the guild root); without it the update is left unchanged.
        update_kwargs["has_parent_id"] = True
        update_kwargs["parent_id"] = int(updates["parent_id"]) if updates["parent_id"] else None
    if "position" in updates:
        update_kwargs["position"] = updates["position"]
    if "rtc_region" in updates:
        update_kwargs["rtc_region"] = updates["rtc_region"]
    if "video_quality_mode" in updates:
        update_kwargs["video_quality_mode"] = updates["video_quality_mode"]

    ch_stub = await get_channel_stub()
    try:
        updated = await ch_stub.UpdateChannel(pb2.UpdateChannelRequest(**update_kwargs))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    channel_resp = _channel_response_from_proto(updated)

    # Publish CHANNEL_UPDATE event
    if guild_id:
        redis = await get_redis()
        event = {"t": "CHANNEL_UPDATE", "d": channel_resp.model_dump()}
        await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return channel_resp.model_dump()


# ---------- DELETE /channels/{channel_id} ----------

@router.delete("/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_and_check_access(cid, uid)
    guild_id = channel.guild_id

    if guild_id:
        await require_permission(guild_id, uid, MANAGE_CHANNELS, channel_id=cid)

    # Build full channel response BEFORE deletion (data won't be available after)
    channel_data = _channel_response_from_proto(channel).model_dump()

    ch_stub = await get_channel_stub()
    try:
        await ch_stub.DeleteChannel(pb2.DeleteChannelRequest(channel_id=cid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Publish CHANNEL_DELETE event with full channel payload
    if guild_id:
        redis = await get_redis()
        event = {"t": "CHANNEL_DELETE", "d": channel_data}
        await redis.publish(f"guild:{guild_id}", json.dumps(event))


# ---------- PUT /channels/{channel_id}/permissions/{overwrite_id} ----------

@router.put("/{channel_id}/permissions/{overwrite_id}", status_code=204)
async def set_permission_overwrite(
    channel_id: str,
    overwrite_id: str,
    body: PermissionOverwriteRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Set a permission overwrite for a role or member on a channel."""
    cid = int(channel_id)
    oid = int(overwrite_id)
    uid = int(user_id)

    channel = await _get_channel_and_check_access(cid, uid)
    guild_id = channel.guild_id

    if not guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Cannot set permissions on non-guild channel"},
        )

    actor_perms = await require_permission(
        guild_id, uid, MANAGE_ROLES, channel_id=cid,
    )

    allow_int = int(body.allow)
    deny_int = int(body.deny)

    # Privilege escalation check
    exempt_bits = MANAGE_ROLES | ADMINISTRATOR
    granting_bits = (allow_int | deny_int) & ~exempt_bits
    missing = granting_bits & ~actor_perms
    if missing:
        raise HTTPException(
            status_code=403,
            detail={
                "code": 50013,
                "message": "Missing Permissions - cannot set permissions you do not have",
            },
        )

    ch_stub = await get_channel_stub()
    try:
        await ch_stub.UpsertPermissionOverwrite(
            pb2.UpsertPermissionOverwriteRequest(
                channel_id=cid,
                overwrite_id=oid,
                type=body.type,
                allow=allow_int,
                deny=deny_int,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Publish CHANNEL_UPDATE event with updated channel
    try:
        updated_ch = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=cid))
        channel_resp = _channel_response_from_proto(updated_ch)
        redis = await get_redis()
        event = {"t": "CHANNEL_UPDATE", "d": channel_resp.model_dump()}
        await redis.publish(f"guild:{guild_id}", json.dumps(event))
    except grpc.RpcError:
        pass  # Non-critical

    return Response(status_code=204)


# ---------- DELETE /channels/{channel_id}/permissions/{overwrite_id} ----------

@router.delete("/{channel_id}/permissions/{overwrite_id}", status_code=204)
async def delete_permission_overwrite(
    channel_id: str,
    overwrite_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Delete a permission overwrite for a role or member on a channel."""
    cid = int(channel_id)
    oid = int(overwrite_id)
    uid = int(user_id)

    channel = await _get_channel_and_check_access(cid, uid)
    guild_id = channel.guild_id

    if not guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Cannot modify permissions on non-guild channel"},
        )

    await require_permission(guild_id, uid, MANAGE_ROLES, channel_id=cid)

    ch_stub = await get_channel_stub()
    try:
        await ch_stub.DeletePermissionOverwrite(
            pb2.DeletePermissionOverwriteRequest(channel_id=cid, overwrite_id=oid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Publish CHANNEL_UPDATE event
    try:
        updated_ch = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=cid))
        channel_resp = _channel_response_from_proto(updated_ch)
        redis = await get_redis()
        event = {"t": "CHANNEL_UPDATE", "d": channel_resp.model_dump()}
        await redis.publish(f"guild:{guild_id}", json.dumps(event))
    except grpc.RpcError:
        pass

    return Response(status_code=204)


# ---------- POST /channels/{channel_id}/permissions/sync ----------

@router.post("/{channel_id}/permissions/sync", status_code=200)
async def sync_permissions_with_category(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Re-sync a channel's permission overwrites with its parent category."""
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_and_check_access(cid, uid)
    guild_id = channel.guild_id

    if not guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Cannot sync permissions on non-guild channel"},
        )

    parent_id = channel.parent_id
    if not parent_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Channel has no parent category to sync with"},
        )

    # Verify parent is a category
    ch_stub = await get_channel_stub()
    try:
        parent = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=int(parent_id)))
    except grpc.RpcError:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Parent channel not found"},
        )

    if parent.type != 4:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Parent channel is not a category"},
        )

    await require_permission(guild_id, uid, MANAGE_CHANNELS, channel_id=cid)

    # Get parent overwrites, then delete current and copy parent's
    parent_overwrites = parent.permission_overwrites or []

    # Delete current overwrites
    try:
        current_overwrites = await ch_stub.GetChannelOverwrites(
            pb2.GetChannelOverwritesRequest(channel_id=cid)
        )
        for ow in current_overwrites.overwrites:
            await ch_stub.DeletePermissionOverwrite(
                pb2.DeletePermissionOverwriteRequest(channel_id=cid, overwrite_id=ow.id)
            )
    except grpc.RpcError:
        pass

    # Copy parent overwrites
    synced_overwrites: list[PermissionOverwriteResponse] = []
    for ow in parent_overwrites:
        try:
            await ch_stub.UpsertPermissionOverwrite(
                pb2.UpsertPermissionOverwriteRequest(
                    channel_id=cid,
                    overwrite_id=ow.id,
                    type=ow.type,
                    allow=ow.allow,
                    deny=ow.deny,
                )
            )
        except grpc.RpcError:
            pass
        synced_overwrites.append(PermissionOverwriteResponse(
            id=str(ow.id),
            type=ow.type,
            allow=str(ow.allow),
            deny=str(ow.deny),
        ))

    synced_channel = _channel_response_from_proto(channel, synced_overwrites)

    # Publish CHANNEL_UPDATE event
    redis_conn = await get_redis()
    sync_event = {"t": "CHANNEL_UPDATE", "d": synced_channel.model_dump()}
    await redis_conn.publish(f"guild:{guild_id}", json.dumps(sync_event))

    return synced_channel.model_dump()
