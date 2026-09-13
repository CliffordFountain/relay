import json
from datetime import datetime, timezone
from typing import Optional

import grpc
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.models.thread import (
    ThreadCreateRequest,
    ThreadChannelResponse,
    ThreadMetadata,
    ArchivedThreadsResponse,
    FollowResponse,
)
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import (
    get_channel_stub,
    get_member_stub,
    get_thread_stub,
    get_message_stub,
    get_user_stub,
    get_webhook_stub,
)
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/channels", tags=["threads"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_channel_with_access(channel_id: int, user_id: int):
    """Fetch a channel via gRPC and verify the caller has guild membership."""
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
        # Enforce VIEW_CHANNEL so threads on a private channel (VIEW_CHANNEL denied via
        # overwrite) are inaccessible even to guild members.
        from app.services.permissions import (
            compute_channel_permissions, has_permission, VIEW_CHANNEL,
        )
        perms = await compute_channel_permissions(guild_id, channel_id, user_id)
        if not has_permission(perms, VIEW_CHANNEL):
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )
    return channel


def _snowflake_to_iso(snowflake_id: int) -> str:
    """Derive an ISO 8601 timestamp from a Snowflake ID.
    The Snowflake epoch: 2015-01-01T00:00:00Z = 1420070400000 ms
    """
    SNOWFLAKE_EPOCH_MS = 1420070400000
    ms = (snowflake_id >> 22) + SNOWFLAKE_EPOCH_MS
    dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000000+00:00")


def _thread_response_from_proto(thread) -> ThreadChannelResponse:
    """Build a ThreadChannelResponse from a gRPC Thread proto."""
    # Derive create_timestamp from the thread Snowflake ID if the proto doesn't
    # carry an explicit field (Thread proto currently has no created_at).
    create_ts = _snowflake_to_iso(thread.id) if thread.id else datetime.now(timezone.utc).isoformat()

    thread_metadata = ThreadMetadata(
        archived=thread.archived or False,
        auto_archive_duration=thread.auto_archive_duration or 1440,
        archive_timestamp=thread.archive_timestamp if thread.HasField("archive_timestamp") else None,
        locked=thread.locked or False,
        create_timestamp=create_ts,
    )

    return ThreadChannelResponse(
        id=str(thread.id),
        guild_id=str(thread.guild_id) if thread.guild_id else None,
        type=thread.type or 11,
        name=thread.name,
        parent_id=str(thread.parent_id) if thread.parent_id else None,
        owner_id=str(thread.owner_id) if thread.owner_id else None,
        last_message_id=str(thread.last_message_id) if thread.last_message_id else None,
        thread_metadata=thread_metadata,
        message_count=thread.message_count or 0,
        member_count=thread.member_count or 0,
        total_message_sent=thread.message_count or 0,
    )


# ---------------------------------------------------------------------------
# POST /channels/{channel_id}/threads  - Create thread from channel
# ---------------------------------------------------------------------------


@router.post("/{channel_id}/threads", status_code=201)
async def create_thread(
    channel_id: str,
    body: ThreadCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)
    guild_id = channel.guild_id

    if not guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Cannot create threads in non-guild channels"},
        )

    # Determine thread type based on parent channel type
    if channel.type == 15:  # Forum channel
        thread_type = 11  # Public thread
    elif channel.type == 5:  # Announcement channel
        thread_type = 10  # Announcement thread
    else:
        thread_type = body.type or 11

    # Validate parent channel type supports threads
    if channel.type not in (0, 5, 15):  # text, announcement, forum
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "This channel type does not support threads"},
        )

    # Check thread creation permission on the parent channel.
    # Private threads (type 12) require CREATE_PRIVATE_THREADS;
    # public/announcement threads require CREATE_PUBLIC_THREADS.
    from app.services.permissions import (
        require_permission, CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS,
    )
    create_perm = CREATE_PRIVATE_THREADS if thread_type == 12 else CREATE_PUBLIC_THREADS
    await require_permission(
        guild_id, uid, create_perm, channel_id=cid,
    )

    thread_stub = await get_thread_stub()
    try:
        thread = await thread_stub.CreateThread(
            pb2.CreateThreadRequest(
                channel_id=cid,
                guild_id=guild_id,
                owner_id=uid,
                name=body.name,
                type=thread_type,
                auto_archive_duration=body.auto_archive_duration or 1440,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # If forum channel and message content provided, create starter message
    starter_message_dict: Optional[dict] = None
    if channel.type == 15 and body.message:
        msg_stub = await get_message_stub()
        try:
            created_msg = await msg_stub.CreateMessage(
                pb2.CreateMessageRequest(
                    channel_id=thread.id,
                    author_id=uid,
                    content=body.message.content,
                    type=0,
                    guild_id=guild_id,
                )
            )
            # Build message dict for the response
            author_info: dict = {"id": str(uid), "username": "", "avatar": None}
            try:
                user_stub = await get_user_stub()
                author_user = await user_stub.GetUser(pb2.GetUserRequest(user_id=uid))
                author_info = {
                    "id": str(author_user.id),
                    "username": author_user.username,
                    "avatar": author_user.avatar if author_user.avatar else None,
                    "global_name": author_user.display_name if author_user.HasField("display_name") else None,
                }
            except grpc.RpcError:
                pass

            starter_message_dict = {
                "id": str(created_msg.id),
                "channel_id": str(created_msg.channel_id),
                "author": author_info,
                "content": created_msg.content or "",
                "timestamp": created_msg.timestamp or _snowflake_to_iso(created_msg.id),
                "edited_timestamp": None,
                "tts": False,
                "mention_everyone": False,
                "mentions": [],
                "mention_roles": [],
                "attachments": [],
                "embeds": [],
                "pinned": False,
                "type": created_msg.type,
                "flags": created_msg.flags if created_msg.flags else 0,
            }
        except grpc.RpcError:
            pass

    # Add creator as thread member
    try:
        await thread_stub.AddThreadMember(
            pb2.AddThreadMemberRequest(thread_id=thread.id, user_id=uid)
        )
    except grpc.RpcError:
        pass

    response = _thread_response_from_proto(thread)

    # Attach the starter message for forum posts (clients expect it in the response)
    if starter_message_dict is not None:
        response.message = starter_message_dict

    # Set newly_created=True on the response (included in both the REST response and the gateway event)
    response.newly_created = True

    # Publish THREAD_CREATE event
    redis = await get_redis()
    event = {"t": "THREAD_CREATE", "d": response.model_dump(exclude_none=True)}
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return response.model_dump(exclude_none=True)


# ---------------------------------------------------------------------------
# POST /channels/{channel_id}/messages/{message_id}/threads
# ---------------------------------------------------------------------------


@router.post("/{channel_id}/messages/{message_id}/threads", status_code=201)
async def create_thread_from_message(
    channel_id: str,
    message_id: str,
    body: ThreadCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    mid = int(message_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)
    guild_id = channel.guild_id

    if not guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Cannot create threads in non-guild channels"},
        )

    # Verify the message exists
    msg_stub = await get_message_stub()
    try:
        await msg_stub.GetMessage(
            pb2.GetMessageRequest(channel_id=cid, message_id=mid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    thread_type = body.type or 11

    # Check thread creation permission on the parent channel
    from app.services.permissions import (
        require_permission, CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS,
    )
    create_perm = CREATE_PRIVATE_THREADS if thread_type == 12 else CREATE_PUBLIC_THREADS
    await require_permission(
        guild_id, uid, create_perm, channel_id=cid,
    )

    thread_stub = await get_thread_stub()
    try:
        thread = await thread_stub.CreateThread(
            pb2.CreateThreadRequest(
                channel_id=cid,
                guild_id=guild_id,
                owner_id=uid,
                name=body.name,
                type=thread_type,
                auto_archive_duration=body.auto_archive_duration or 1440,
                message_id=mid,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Add creator as thread member
    try:
        await thread_stub.AddThreadMember(
            pb2.AddThreadMemberRequest(thread_id=thread.id, user_id=uid)
        )
    except grpc.RpcError:
        pass

    response = _thread_response_from_proto(thread)
    response.newly_created = True

    # Publish THREAD_CREATE event
    redis = await get_redis()
    event = {"t": "THREAD_CREATE", "d": response.model_dump(exclude_none=True)}
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return response.model_dump(exclude_none=True)


# ---------------------------------------------------------------------------
# GET /channels/{channel_id}/threads/archived/public
# ---------------------------------------------------------------------------


@router.get("/{channel_id}/threads/archived/public")
async def list_archived_public_threads(
    channel_id: str,
    before: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    await _get_channel_with_access(cid, uid)

    thread_stub = await get_thread_stub()
    try:
        resp = await thread_stub.GetChannelThreads(
            pb2.GetChannelThreadsRequest(channel_id=cid, archived=True)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Filter to public threads (type 10, 11)
    all_threads = [t for t in resp.threads if t.type in (10, 11)]

    # Apply cursor
    if before:
        before_id = int(before)
        all_threads = [t for t in all_threads if t.id < before_id]

    has_more = len(all_threads) > limit
    threads = [_thread_response_from_proto(t) for t in all_threads[:limit]]

    return ArchivedThreadsResponse(
        threads=threads,
        has_more=has_more,
    ).model_dump()


# ---------------------------------------------------------------------------
# GET /channels/{channel_id}/threads/archived/private
# ---------------------------------------------------------------------------


@router.get("/{channel_id}/threads/archived/private")
async def list_archived_private_threads(
    channel_id: str,
    before: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    await _get_channel_with_access(cid, uid)

    thread_stub = await get_thread_stub()
    try:
        resp = await thread_stub.GetChannelThreads(
            pb2.GetChannelThreadsRequest(channel_id=cid, archived=True)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Filter to private threads (type 12)
    all_threads = [t for t in resp.threads if t.type == 12]

    if before:
        before_id = int(before)
        all_threads = [t for t in all_threads if t.id < before_id]

    has_more = len(all_threads) > limit
    threads = [_thread_response_from_proto(t) for t in all_threads[:limit]]

    return ArchivedThreadsResponse(
        threads=threads,
        has_more=has_more,
    ).model_dump()


# ---------------------------------------------------------------------------
# GET /channels/{channel_id}/thread-members
# ---------------------------------------------------------------------------


@router.get("/{channel_id}/thread-members")
async def list_thread_members(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)

    # Must be a thread channel
    if channel.type not in (10, 11, 12):
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Channel is not a thread"},
        )

    # Thread service doesn't have a GetThreadMembers RPC yet.
    # Return empty for now. TODO: Add GetThreadMembers RPC to data-services.
    return []


# ---------------------------------------------------------------------------
# PUT /channels/{channel_id}/thread-members/@me  - Join thread
# ---------------------------------------------------------------------------


@router.put("/{channel_id}/thread-members/@me", status_code=204)
async def join_thread(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)

    if channel.type not in (10, 11, 12):
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Channel is not a thread"},
        )

    # Check if thread is archived and locked. GetChannel returns a Channel proto which does
    # not carry archived/locked (those live on the Thread proto), so read them defensively —
    # otherwise every join 500s with AttributeError.
    if getattr(channel, "archived", False) and getattr(channel, "locked", False):
        raise HTTPException(
            status_code=403,
            detail={"code": 50083, "message": "Thread is locked"},
        )

    thread_stub = await get_thread_stub()
    try:
        await thread_stub.AddThreadMember(
            pb2.AddThreadMemberRequest(thread_id=cid, user_id=uid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Publish THREAD_MEMBER_UPDATE event
    redis = await get_redis()
    guild_id = channel.guild_id
    event = {
        "t": "THREAD_MEMBER_UPDATE",
        "d": {
            "id": str(cid),
            "user_id": str(uid),
            "guild_id": str(guild_id) if guild_id else None,
        },
    }
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# DELETE /channels/{channel_id}/thread-members/@me  - Leave thread
# ---------------------------------------------------------------------------


@router.delete("/{channel_id}/thread-members/@me", status_code=204)
async def leave_thread(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)

    if channel.type not in (10, 11, 12):
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Channel is not a thread"},
        )

    thread_stub = await get_thread_stub()
    try:
        await thread_stub.RemoveThreadMember(
            pb2.RemoveThreadMemberRequest(thread_id=cid, user_id=uid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    # Publish THREAD_MEMBER_UPDATE event
    redis = await get_redis()
    guild_id = channel.guild_id
    event = {
        "t": "THREAD_MEMBER_UPDATE",
        "d": {
            "id": str(cid),
            "user_id": str(uid),
            "guild_id": str(guild_id) if guild_id else None,
        },
    }
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# GET /channels/{channel_id}/threads/active  - List active threads for channel
# ---------------------------------------------------------------------------


@router.get("/{channel_id}/threads/active")
async def list_active_threads(
    channel_id: str,
    sort: Optional[str] = Query(None, pattern="^(latest_activity|creation_date)$"),
    tag_id: Optional[str] = Query(None),
    before: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    """List active (non-archived) threads in a channel.

    For forum channels (type 15) this returns forum posts sorted by latest
    activity or creation date.  For regular text channels it returns active
    threads.
    """
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)
    guild_id = channel.guild_id

    # For forum channels, use GetForumPosts
    if channel.type == 15:
        thread_stub = await get_thread_stub()
        sort_order = sort or "latest_activity"
        try:
            resp = await thread_stub.GetForumPosts(
                pb2.GetForumPostsRequest(
                    channel_id=cid,
                    sort_order=sort_order,
                    limit=limit + 1,
                )
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="channel")

        threads_list = list(resp.threads) if resp.threads else []
        has_more = len(threads_list) > limit
        threads_list = threads_list[:limit]

        threads_out = []
        user_stub = await get_user_stub()
        for t in threads_list:
            resp_obj = _thread_response_from_proto(t)
            thread_dict = resp_obj.model_dump()

            # Get the thread creator info
            if t.owner_id:
                try:
                    author = await user_stub.GetUser(pb2.GetUserRequest(user_id=t.owner_id))
                    thread_dict["author"] = {
                        "id": str(author.id),
                        "username": author.username,
                        "avatar": author.avatar,
                    }
                except grpc.RpcError:
                    pass

            thread_dict["applied_tags"] = []
            threads_out.append(thread_dict)

        return {"threads": threads_out, "has_more": has_more}

    # For non-forum channels, get active threads
    thread_stub = await get_thread_stub()
    try:
        resp = await thread_stub.GetChannelThreads(
            pb2.GetChannelThreadsRequest(channel_id=cid, archived=False)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    threads = [_thread_response_from_proto(t) for t in resp.threads] if resp.threads else []
    return {"threads": [t.model_dump() for t in threads], "has_more": False}


# ---------------------------------------------------------------------------
# POST /channels/{channel_id}/followers  - Follow announcement channel
# ---------------------------------------------------------------------------


@router.post("/{channel_id}/followers", status_code=200)
async def follow_announcement_channel(
    channel_id: str,
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)

    # Must be an announcement channel (type=5)
    if channel.type != 5:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Can only follow announcement channels"},
        )

    webhook_channel_id = body.get("webhook_channel_id")
    if not webhook_channel_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "webhook_channel_id is required"},
        )

    target_cid = int(webhook_channel_id)

    # Verify target channel exists and user has access
    target_channel = await _get_channel_with_access(target_cid, uid)

    target_guild_id = target_channel.guild_id
    if not target_guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50003, "message": "Cannot follow into a DM channel"},
        )

    # Following posts into the target channel via a webhook, so the caller needs
    # MANAGE_WEBHOOKS on the target channel (mirrors POST /channels/{id}/webhooks).
    from app.services.permissions import require_permission, MANAGE_WEBHOOKS
    await require_permission(target_guild_id, uid, MANAGE_WEBHOOKS, channel_id=target_cid)

    # Create the webhook that will mirror the announcement channel's messages
    # into the target channel.
    wh_stub = await get_webhook_stub()
    try:
        webhook = await wh_stub.CreateWebhook(
            pb2.CreateWebhookRequest(
                guild_id=target_guild_id,
                channel_id=target_cid,
                user_id=uid,
                name=channel.name or "Announcements",
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")

    # Register the follow relationship so future publishes fan out to the target.
    channel_stub = await get_channel_stub()
    try:
        follow_resp = await channel_stub.FollowChannel(
            pb2.FollowChannelRequest(
                source_channel_id=cid,
                target_channel_id=target_cid,
                webhook_id=webhook.id,
                created_by=uid,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    return FollowResponse(
        channel_id=str(cid),
        webhook_id=str(follow_resp.webhook_id or webhook.id),
    ).model_dump()


# ---------------------------------------------------------------------------
# GET /channels/{channel_id}/tags  - Get available tags for a forum channel
# ---------------------------------------------------------------------------


@router.get("/{channel_id}/tags")
async def get_forum_tags(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return the available_tags for a forum channel."""
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)

    if channel.type != 15:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Channel is not a forum channel"},
        )

    # available_tags is stored as part of the channel data.
    # The Channel proto doesn't currently have available_tags.
    # TODO: Add available_tags field to Channel proto.
    return []


# ---------------------------------------------------------------------------
# PUT /channels/{channel_id}/tags  - Set available tags on a forum channel
# ---------------------------------------------------------------------------


@router.put("/{channel_id}/tags")
async def set_forum_tags(
    channel_id: str,
    body: list[dict],
    user_id: str = Depends(get_current_user_id),
):
    """Set the available_tags for a forum channel."""
    cid = int(channel_id)
    uid = int(user_id)

    channel = await _get_channel_with_access(cid, uid)

    if channel.type != 15:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Channel is not a forum channel"},
        )

    guild_id = channel.guild_id
    if guild_id:
        from app.services.permissions import require_permission, MANAGE_CHANNELS
        await require_permission(guild_id, uid, MANAGE_CHANNELS, channel_id=cid)

    # TODO: Update available_tags via ChannelService.UpdateChannel when the field is added.
    # For now, return the body as-is.

    return body
