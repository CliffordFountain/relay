import json
from datetime import datetime, timezone

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.models.guild import InviteCreateRequest, InviteResponse
from app.routers.guilds import _guild_response_from_proto, _role_response_from_proto, _channel_response_from_proto
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import (
    get_invite_stub,
    get_channel_stub,
    get_guild_stub,
    get_member_stub,
    get_user_stub,
    get_role_stub,
    get_ban_stub,
    get_permission_stub,
)
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.routers.audit_log import create_audit_log, AuditLogAction

router = APIRouter(prefix="/api/v10", tags=["invites"])


def _invite_response_from_proto(
    invite,
    *,
    guild=None,
    channel=None,
    inviter=None,
    approximate_member_count: int | None = None,
    approximate_presence_count: int | None = None,
) -> dict:
    max_age = invite.max_age or 0
    created_at = invite.created_at or ""
    # Compute expires_at: null if never expires (max_age=0), else created_at + max_age
    expires_at: str | None = None
    if max_age > 0 and created_at:
        from datetime import timedelta
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            expires_at = (dt + timedelta(seconds=max_age)).isoformat()
        except (ValueError, TypeError):
            expires_at = None

    resp = InviteResponse(
        code=invite.code,
        guild=guild,
        channel=channel,
        inviter=inviter,
        max_age=max_age,
        max_uses=invite.max_uses or 0,
        uses=invite.uses or 0,
        temporary=invite.temporary or False,
        created_at=created_at,
        expires_at=expires_at,
        approximate_member_count=approximate_member_count,
        approximate_presence_count=approximate_presence_count,
    )
    return resp.model_dump(exclude_none=False)


async def _get_guild_info(guild_id: int) -> dict | None:
    guild_stub = await get_guild_stub()
    try:
        guild = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=guild_id))
        return {
            "id": str(guild.id),
            "name": guild.name,
            "icon": guild.icon,
            "member_count": guild.member_count or 0,
        }
    except grpc.RpcError:
        return None


async def _get_channel_info(channel_id: int) -> dict | None:
    ch_stub = await get_channel_stub()
    try:
        ch = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=channel_id))
        return {"id": str(ch.id), "name": ch.name, "type": ch.type}
    except grpc.RpcError:
        return None


async def _get_inviter_info(user_id: int) -> dict | None:
    user_stub = await get_user_stub()
    try:
        user = await user_stub.GetUser(pb2.GetUserRequest(user_id=user_id))
        return {"id": str(user.id), "username": user.username}
    except grpc.RpcError:
        return None


# ---------- GET /channels/{channel_id}/invites ----------

@router.get("/channels/{channel_id}/invites")
async def get_channel_invites(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    # Get channel
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=cid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    guild_id = channel.guild_id
    if not guild_id:
        raise HTTPException(status_code=400, detail={"code": 50035, "message": "Not a guild channel"})

    # Must be guild member
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(pb2.IsMemberRequest(guild_id=guild_id, user_id=uid))
        if not resp.is_member:
            raise HTTPException(status_code=403, detail={"code": 50001, "message": "Missing Access"})
    except grpc.RpcError:
        raise HTTPException(status_code=403, detail={"code": 50001, "message": "Missing Access"})

    # Viewing a channel's invites (codes + inviter identity) requires MANAGE_CHANNELS.
    from app.services.permissions import require_permission, MANAGE_CHANNELS
    await require_permission(int(guild_id), uid, MANAGE_CHANNELS, channel_id=cid)

    # Fetch invites for this channel
    invite_stub = await get_invite_stub()
    try:
        invites_resp = await invite_stub.GetChannelInvites(pb2.GetChannelInvitesRequest(channel_id=cid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="invite")

    result = []
    for inv in invites_resp.invites:
        inviter = await _get_inviter_info(inv.inviter_id) if inv.inviter_id else None
        result.append({
            "code": inv.code,
            "channel": {"id": str(cid), "name": channel.name, "type": channel.type},
            "inviter": inviter,
            "max_age": inv.max_age or 0,
            "max_uses": inv.max_uses or 0,
            "uses": inv.uses or 0,
            "temporary": inv.temporary or False,
            "created_at": inv.created_at or None,
        })

    return result


# ---------- POST /channels/{channel_id}/invites ----------

@router.post("/channels/{channel_id}/invites", status_code=201)
async def create_invite(
    channel_id: str,
    body: InviteCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    # Get channel and verify it belongs to a guild
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=cid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    guild_id = channel.guild_id
    if not guild_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Cannot create invite for non-guild channel"},
        )

    # Must be a guild member
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(pb2.IsMemberRequest(guild_id=guild_id, user_id=uid))
        if not resp.is_member:
            raise HTTPException(status_code=403, detail={"code": 50001, "message": "Missing Access"})
    except grpc.RpcError:
        raise HTTPException(status_code=403, detail={"code": 50001, "message": "Missing Access"})

    # Creating an invite requires CREATE_INSTANT_INVITE.
    from app.services.permissions import require_permission, CREATE_INSTANT_INVITE
    await require_permission(int(guild_id), uid, CREATE_INSTANT_INVITE, channel_id=cid)

    invite_stub = await get_invite_stub()
    try:
        invite = await invite_stub.CreateInvite(
            pb2.CreateInviteRequest(
                channel_id=cid,
                guild_id=guild_id,
                inviter_id=uid,
                max_age=body.max_age,
                max_uses=body.max_uses,
                temporary=body.temporary,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="invite")

    guild_info = await _get_guild_info(guild_id)
    channel_info = {"id": str(channel.id), "name": channel.name, "type": channel.type}
    inviter_info = await _get_inviter_info(uid)

    # Audit log
    await create_audit_log(
        guild_id, uid, None, AuditLogAction.INVITE_CREATE,
        changes={"code": invite.code, "channel_id": str(cid)},
    )

    return _invite_response_from_proto(
        invite,
        guild=guild_info,
        channel=channel_info,
        inviter=inviter_info,
    )


# ---------- GET /invites/{code} ----------

@router.get("/invites/{code}")
async def get_invite(code: str, with_counts: bool = False):
    """Get invite info. No auth required."""
    invite_stub = await get_invite_stub()
    try:
        invite = await invite_stub.GetInvite(pb2.GetInviteRequest(code=code))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="invite")

    guild_info = await _get_guild_info(invite.guild_id)
    channel_info = await _get_channel_info(invite.channel_id)

    approximate_member_count: int | None = None
    approximate_presence_count: int | None = None

    # Enrich guild info with member count (always, for guild.member_count)
    if guild_info:
        member_stub = await get_member_stub()
        try:
            count_resp = await member_stub.GetMemberCount(
                pb2.GetMemberCountRequest(guild_id=invite.guild_id)
            )
            guild_info["member_count"] = count_resp.count
            if with_counts:
                approximate_member_count = count_resp.count
                # Presence count: approximate online members (use member_count as upper bound)
                approximate_presence_count = 0
        except grpc.RpcError:
            pass

    return _invite_response_from_proto(
        invite,
        guild=guild_info,
        channel=channel_info,
        approximate_member_count=approximate_member_count,
        approximate_presence_count=approximate_presence_count,
    )


# ---------- POST /invites/{code} ----------

@router.post("/invites/{code}")
async def accept_invite(
    code: str,
    user_id: str = Depends(get_current_user_id),
):
    """Accept an invite and join the guild."""
    uid = int(user_id)

    invite_stub = await get_invite_stub()
    is_vanity = False
    try:
        invite = await invite_stub.GetInvite(pb2.GetInviteRequest(code=code))
        guild_id = invite.guild_id
    except grpc.RpcError:
        # Not a regular invite — try resolving the code as a guild vanity URL.
        guild_stub_v = await get_guild_stub()
        try:
            vanity_guild = await guild_stub_v.GetGuildByVanity(
                pb2.GetGuildByVanityRequest(code=code)
            )
            guild_id = vanity_guild.id
            is_vanity = True
        except grpc.RpcError:
            raise HTTPException(
                status_code=404,
                detail={"code": 10006, "message": "Unknown Invite"},
            )

    # Check if already a member
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(pb2.IsMemberRequest(guild_id=guild_id, user_id=uid))
        if resp.is_member:
            guild_info = await _get_guild_info(guild_id)
            if guild_info:
                perm_stub = await get_permission_stub()
                try:
                    owner_resp = await perm_stub.GetGuildOwner(
                        pb2.GetGuildOwnerRequest(guild_id=guild_id)
                    )
                    guild_info["owner_id"] = str(owner_resp.owner_id)
                except grpc.RpcError:
                    pass
                count_resp = await member_stub.GetMemberCount(
                    pb2.GetMemberCountRequest(guild_id=guild_id)
                )
                guild_info["member_count"] = count_resp.count
                return guild_info
    except grpc.RpcError:
        pass

    # Check if user is banned
    ban_stub = await get_ban_stub()
    try:
        await ban_stub.GetBan(pb2.GetBanRequest(guild_id=guild_id, user_id=uid))
        # If GetBan succeeds, the user is banned
        raise HTTPException(
            status_code=403,
            detail={"code": 40007, "message": "The user is banned from this guild"},
        )
    except grpc.RpcError as exc:
        if exc.code() != grpc.StatusCode.NOT_FOUND:
            # Unexpected error
            handle_grpc_error(exc, resource="ban")
        # NOT_FOUND means not banned -- continue

    # Add the member: directly for a vanity-URL join, or via UseInvite (which also
    # increments the invite's use count) for a real invite.
    if is_vanity:
        try:
            await member_stub.AddMember(
                pb2.AddMemberRequest(guild_id=guild_id, user_id=uid)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="guild")
    else:
        try:
            await invite_stub.UseInvite(
                pb2.UseInviteRequest(code=code, user_id=uid)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="invite")

    # Track user's guilds in Redis for gateway READY event
    redis = await get_redis()
    await redis.sadd(f"auth:user:{uid}:guilds", str(guild_id))

    # Fetch guild info for response
    guild_stub = await get_guild_stub()
    try:
        guild = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=guild_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    count_resp = await member_stub.GetMemberCount(
        pb2.GetMemberCountRequest(guild_id=guild_id)
    )

    role_stub = await get_role_stub()
    try:
        roles_resp = await role_stub.GetRoles(pb2.GetRolesRequest(guild_id=guild_id))
        roles = [
            {
                "id": str(r.id),
                "name": r.name,
                "color": r.color or 0,
                "hoist": r.hoist or False,
                "position": r.position or 0,
                "permissions": str(r.permissions),
                "managed": r.managed or False,
                "mentionable": r.mentionable or False,
            }
            for r in roles_resp.roles
        ]
    except grpc.RpcError:
        roles = []

    ch_stub = await get_channel_stub()
    try:
        channels_resp = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=0))
        channels = []
    except grpc.RpcError:
        channels = []

    # Get guild channels
    try:
        channels_resp = await guild_stub.GetGuildChannels(
            pb2.GetGuildChannelsRequest(guild_id=guild_id)
        )
        channels = [
            {
                "id": str(c.id),
                "guild_id": str(c.guild_id) if c.guild_id else None,
                "type": c.type,
                "name": c.name,
                "topic": c.topic,
                "position": c.position or 0,
                "parent_id": str(c.parent_id) if c.parent_id else None,
                "nsfw": c.nsfw or False,
                "last_message_id": str(c.last_message_id) if c.last_message_id else None,
            }
            for c in channels_resp.channels
        ]
    except grpc.RpcError:
        channels = []

    # Publish GUILD_MEMBER_ADD event
    user_stub = await get_user_stub()
    try:
        user_row = await user_stub.GetUser(pb2.GetUserRequest(user_id=uid))
        user_info = {
            "id": str(user_row.id),
            "username": user_row.username,
            "avatar": user_row.avatar if user_row.avatar else None,
            "discriminator": "0",
            "global_name": user_row.display_name if user_row.HasField("display_name") else None,
        }
    except grpc.RpcError:
        user_info = {"id": user_id, "username": "", "discriminator": "0", "global_name": None, "avatar": None}

    joined_at = datetime.now(timezone.utc).isoformat()
    event = {
        "t": "GUILD_MEMBER_ADD",
        "d": {
            "guild_id": str(guild_id),
            "user": user_info,
            "nick": None,
            "avatar": None,
            "roles": [],
            "joined_at": joined_at,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "pending": False,
            "communication_disabled_until": None,
        },
    }
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    perm_stub = await get_permission_stub()
    try:
        owner_resp = await perm_stub.GetGuildOwner(
            pb2.GetGuildOwnerRequest(guild_id=guild_id)
        )
        owner_id = str(owner_resp.owner_id)
    except grpc.RpcError:
        owner_id = str(guild.owner_id)

    # Publish GUILD_CREATE to the joining user's session so their gateway session
    # can display the new guild without requiring reconnect.
    guild_resp = _guild_response_from_proto(guild, member_count=count_resp.count)
    guild_roles = [_role_response_from_proto(r) for r in (guild.roles or [])]
    guild_channels_resp = [_channel_response_from_proto(c) for c in (guild.channels or [])]
    guild_create_payload = {
        **guild_resp.model_dump(),
        "owner_id": owner_id,
        "roles": [r.model_dump() for r in guild_roles],
        "channels": [c.model_dump() for c in guild_channels_resp],
        "members": [],
        "presences": [],
        "voice_states": [],
        "threads": [],
        "stage_instances": [],
        "guild_scheduled_events": [],
        "joined_at": joined_at,
        "large": False,
        "unavailable": False,
    }
    guild_create_event = {"t": "GUILD_CREATE", "d": guild_create_payload}
    await redis.publish(f"user:{uid}", json.dumps(guild_create_event))

    return {
        "id": str(guild.id),
        "name": guild.name,
        "icon": guild.icon,
        "banner": guild.banner,
        "owner_id": owner_id,
        "description": guild.description,
        "member_count": count_resp.count,
        "roles": roles,
        "channels": channels,
    }


# ---------- DELETE /invites/{code} ----------

@router.delete("/invites/{code}", status_code=204)
async def delete_invite(
    code: str,
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)

    invite_stub = await get_invite_stub()
    try:
        invite = await invite_stub.GetInvite(pb2.GetInviteRequest(code=code))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="invite")

    guild_id = invite.guild_id

    # Must be invite creator or guild owner
    is_creator = invite.inviter_id == uid

    perm_stub = await get_permission_stub()
    try:
        owner_resp = await perm_stub.GetGuildOwner(
            pb2.GetGuildOwnerRequest(guild_id=guild_id)
        )
        is_owner = owner_resp.owner_id == uid
    except grpc.RpcError:
        is_owner = False

    if not is_creator and not is_owner:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Missing Permissions"},
        )

    try:
        await invite_stub.DeleteInvite(pb2.DeleteInviteRequest(code=code))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="invite")

    # Audit log
    await create_audit_log(
        guild_id, uid, None, AuditLogAction.INVITE_DELETE,
        changes={"code": code},
    )

    return Response(status_code=204)


# ---------- GET /guilds/{guild_id}/invites ----------

@router.get("/guilds/{guild_id}/invites")
async def list_guild_invites(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    # Must be owner
    perm_stub = await get_permission_stub()
    try:
        owner_resp = await perm_stub.GetGuildOwner(
            pb2.GetGuildOwnerRequest(guild_id=gid)
        )
        if owner_resp.owner_id != uid:
            raise HTTPException(
                status_code=403,
                detail={"code": 50013, "message": "Missing Permissions"},
            )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    invite_stub = await get_invite_stub()
    try:
        invites_resp = await invite_stub.GetGuildInvites(
            pb2.GetGuildInvitesRequest(guild_id=gid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="invite")

    result = []
    for inv in invites_resp.invites:
        channel_info = await _get_channel_info(inv.channel_id) if inv.channel_id else None
        inviter_info = await _get_inviter_info(inv.inviter_id) if inv.inviter_id else None
        result.append(_invite_response_from_proto(
            inv,
            channel=channel_info,
            inviter=inviter_info,
        ))

    return result
