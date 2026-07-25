import json
import re

import grpc
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import Optional

from app.models.guild import (
    GuildCreateRequest,
    GuildUpdateRequest,
    GuildResponse,
    RoleResponse,
    MemberResponse,
    MemberUserResponse,
)
from app.models.channel import ChannelCreateRequest, ChannelResponse, PermissionOverwriteResponse
from app.models.thread import ThreadChannelResponse, ThreadMetadata
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import (
    get_guild_stub, get_channel_stub, get_member_stub,
    get_role_stub, get_user_stub, get_permission_stub, get_thread_stub,
)
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import (
    require_permission,
    MANAGE_GUILD,
    MANAGE_CHANNELS,
)
from app.routers.audit_log import create_audit_log

router = APIRouter(prefix="/api/v10/guilds", tags=["guilds"])

# Default @everyone permissions (matching the reference):
DEFAULT_EVERYONE_PERMISSIONS = (
    (1 << 0)   # CREATE_INSTANT_INVITE
    | (1 << 6)   # ADD_REACTIONS
    | (1 << 9)   # STREAM
    | (1 << 10)  # VIEW_CHANNEL
    | (1 << 11)  # SEND_MESSAGES
    | (1 << 14)  # EMBED_LINKS
    | (1 << 15)  # ATTACH_FILES
    | (1 << 16)  # READ_MESSAGE_HISTORY
    | (1 << 17)  # MENTION_EVERYONE
    | (1 << 18)  # USE_EXTERNAL_EMOJIS
    | (1 << 20)  # CONNECT
    | (1 << 21)  # SPEAK
    | (1 << 25)  # USE_VAD
    | (1 << 26)  # CHANGE_NICKNAME
    | (1 << 31)  # USE_APPLICATION_COMMANDS
    | (1 << 35)  # CREATE_PUBLIC_THREADS
    | (1 << 36)  # CREATE_PRIVATE_THREADS
    | (1 << 37)  # USE_EXTERNAL_STICKERS
    | (1 << 38)  # SEND_MESSAGES_IN_THREADS
    | (1 << 46)  # SEND_VOICE_MESSAGES
    | (1 << 49)  # SEND_POLLS
)


async def require_member(guild_id: int, user_id: int) -> None:
    stub = await get_member_stub()
    try:
        resp = await stub.IsMember(pb2.IsMemberRequest(guild_id=guild_id, user_id=user_id))
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


async def require_owner(guild_id: int, user_id: int) -> None:
    stub = await get_permission_stub()
    try:
        resp = await stub.GetGuildOwner(pb2.GetGuildOwnerRequest(guild_id=guild_id))
        if resp.owner_id != user_id:
            raise HTTPException(
                status_code=403,
                detail={"code": 50013, "message": "Missing Permissions"},
            )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")


def _guild_response_from_proto(guild, *, member_count: int = 0) -> GuildResponse:
    return GuildResponse(
        id=str(guild.id),
        name=guild.name,
        icon=guild.icon if guild.HasField("icon") else None,
        banner=guild.banner if guild.HasField("banner") else None,
        owner_id=str(guild.owner_id),
        description=guild.description if guild.HasField("description") else None,
        member_count=member_count,
        verification_level=guild.verification_level,
        default_message_notifications=guild.default_message_notifications,
        explicit_content_filter=guild.explicit_content_filter,
        nsfw_level=int(guild.nsfw_level) if guild.nsfw_level else 0,
        preferred_locale=guild.preferred_locale if guild.HasField("preferred_locale") else "en-US",
        vanity_url_code=guild.vanity_url_code if guild.HasField("vanity_url_code") else None,
        features=[],
        discoverable=guild.discoverable,
    )


def _role_response_from_proto(role) -> RoleResponse:
    return RoleResponse(
        id=str(role.id),
        name=role.name,
        color=role.color or 0,
        hoist=role.hoist or False,
        position=role.position or 0,
        permissions=str(role.permissions),
        managed=role.managed or False,
        mentionable=role.mentionable or False,
    )


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


def _member_response_from_proto(member) -> MemberResponse:
    user = member.user
    global_name = None
    try:
        if user.HasField("display_name"):
            global_name = user.display_name
    except (ValueError, AttributeError):
        pass
    user_obj = MemberUserResponse(
        id=str(user.id),
        username=user.username or "",
        global_name=global_name,
        avatar=user.avatar if user.avatar else None,
        bot=False,
    )
    return MemberResponse(
        user=user_obj,
        nick=member.nick if member.nick else None,
        roles=[str(r) for r in (member.roles or [])],
        joined_at=member.joined_at or "",
        deaf=member.deaf if hasattr(member, 'deaf') else False,
        mute=member.mute if hasattr(member, 'mute') else False,
        flags=member.flags if hasattr(member, 'flags') else 0,
        pending=member.pending if hasattr(member, 'pending') else False,
        communication_disabled_until=member.communication_disabled_until if hasattr(member, 'communication_disabled_until') and member.communication_disabled_until and member.communication_disabled_until != "" else None,
    )


# ---------- POST /guilds ----------

@router.post("", status_code=201)
async def create_guild(
    body: GuildCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)
    guild_stub = await get_guild_stub()

    try:
        guild = await guild_stub.CreateGuild(
            pb2.CreateGuildRequest(
                name=body.name,
                owner_id=uid,
                icon=body.icon,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    guild_id = guild.id

    # Track user's guilds in Redis for gateway READY event
    r = await get_redis()
    await r.sadd(f"auth:user:{uid}:guilds", str(guild_id))

    guild_resp = _guild_response_from_proto(guild, member_count=guild.member_count or 1)

    roles = [_role_response_from_proto(role) for role in (guild.roles or [])]
    channels = [_channel_response_from_proto(ch) for ch in (guild.channels or [])]

    response_data = {
        **guild_resp.model_dump(),
        "roles": [r.model_dump() for r in roles],
        "channels": [c.model_dump() for c in channels],
    }

    # GUILD_CREATE gateway event includes extra arrays (empty for new guild)
    guild_create_payload = {
        **response_data,
        "members": [],
        "presences": [],
        "voice_states": [],
        "threads": [],
        "stage_instances": [],
        "guild_scheduled_events": [],
        "joined_at": None,
        "large": False,
        "unavailable": False,
    }

    # Publish GUILD_CREATE event
    redis = await get_redis()
    event = {"t": "GUILD_CREATE", "d": guild_create_payload}
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return response_data


# ---------- GET /guilds/{guild_id} ----------

@router.get("/{guild_id}")
async def get_guild(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_member(gid, uid)

    guild_stub = await get_guild_stub()
    try:
        guild = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    member_stub = await get_member_stub()
    try:
        count_resp = await member_stub.GetMemberCount(pb2.GetMemberCountRequest(guild_id=gid))
        member_count = count_resp.count
    except grpc.RpcError:
        member_count = guild.member_count or 0

    guild_resp = _guild_response_from_proto(guild, member_count=member_count)

    roles = [_role_response_from_proto(r) for r in (guild.roles or [])]
    channels = [_channel_response_from_proto(ch) for ch in (guild.channels or [])]

    return {
        **guild_resp.model_dump(),
        "roles": [r.model_dump() for r in roles],
        "channels": [c.model_dump() for c in channels],
    }


# ---------- PATCH /guilds/{guild_id} ----------

@router.patch("/{guild_id}")
async def update_guild(
    guild_id: str,
    body: GuildUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    guild_stub = await get_guild_stub()

    # Handle ownership transfer separately
    new_owner_id_str = updates.pop("owner_id", None)
    if new_owner_id_str is not None:
        await require_owner(gid, uid)
        new_owner_id = int(new_owner_id_str)

        try:
            await guild_stub.TransferOwnership(
                pb2.TransferOwnershipRequest(guild_id=gid, new_owner_id=new_owner_id)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="guild")

        await create_audit_log(
            guild_id=gid,
            user_id=uid,
            target_id=gid,
            action_type=1,
            changes={"owner_id": {"old_value": str(uid), "new_value": new_owner_id_str}},
        )

    # For other fields, require MANAGE_GUILD permission
    if updates:
        await require_permission(gid, uid, MANAGE_GUILD)

        update_kwargs: dict = {"guild_id": gid}
        for key, value in updates.items():
            update_kwargs[key] = value

        try:
            guild = await guild_stub.UpdateGuild(pb2.UpdateGuildRequest(**update_kwargs))
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="guild")
    else:
        try:
            guild = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=gid))
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="guild")

    member_stub = await get_member_stub()
    try:
        count_resp = await member_stub.GetMemberCount(pb2.GetMemberCountRequest(guild_id=gid))
        member_count = count_resp.count
    except grpc.RpcError:
        member_count = 0

    guild_resp = _guild_response_from_proto(guild, member_count=member_count)

    # Publish GUILD_UPDATE event
    redis = await get_redis()
    event = {"t": "GUILD_UPDATE", "d": guild_resp.model_dump()}
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return guild_resp.model_dump()


# ---------- GET / PATCH /guilds/{guild_id}/vanity-url ----------

_VANITY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,24}$")


@router.get("/{guild_id}/vanity-url")
async def get_guild_vanity_url(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_permission(gid, uid, MANAGE_GUILD)
    guild_stub = await get_guild_stub()
    try:
        guild = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")
    code = guild.vanity_url_code if guild.HasField("vanity_url_code") else None
    return {"code": code or None, "uses": 0}


@router.patch("/{guild_id}/vanity-url")
async def update_guild_vanity_url(
    guild_id: str,
    body: dict = Body(default={}),
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_permission(gid, uid, MANAGE_GUILD)

    code = str(body.get("code") or "").strip().lower()
    if not _VANITY_RE.match(code):
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Vanity URL must be 2-25 lowercase letters, numbers, or dashes"},
        )

    guild_stub = await get_guild_stub()
    # Uniqueness: reject if another guild already owns this code.
    try:
        existing = await guild_stub.GetGuildByVanity(pb2.GetGuildByVanityRequest(code=code))
        if existing and existing.id and existing.id != gid:
            raise HTTPException(
                status_code=400,
                detail={"code": 50035, "message": "That vanity URL is already taken"},
            )
    except grpc.RpcError:
        pass  # not found -> code is available

    try:
        guild = await guild_stub.UpdateGuild(
            pb2.UpdateGuildRequest(guild_id=gid, vanity_url_code=code)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    await create_audit_log(
        guild_id=gid, user_id=uid, target_id=gid, action_type=1,
        changes={"vanity_url_code": {"new_value": code}},
    )

    result = guild.vanity_url_code if guild.HasField("vanity_url_code") else code
    return {"code": result, "uses": 0}


# ---------- DELETE /guilds/{guild_id} ----------

@router.delete("/{guild_id}", status_code=204)
async def delete_guild(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_owner(gid, uid)

    guild_stub = await get_guild_stub()
    try:
        await guild_stub.DeleteGuild(pb2.DeleteGuildRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    # Publish GUILD_DELETE event
    redis = await get_redis()
    event = {"t": "GUILD_DELETE", "d": {"id": guild_id}}
    await redis.publish(f"guild:{gid}", json.dumps(event))


# ---------- GET /guilds/{guild_id}/members ----------

@router.get("/{guild_id}/members")
async def get_guild_members(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_member(gid, uid)

    member_stub = await get_member_stub()
    try:
        resp = await member_stub.GetMembers(
            pb2.GetMembersRequest(guild_id=gid, limit=1000)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    return [_member_response_from_proto(m).model_dump() for m in resp.members]


# ---------- GET /guilds/{guild_id}/members/@me ----------

@router.get("/{guild_id}/members/@me")
async def get_guild_member_me(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get the current user's member in a guild. Must be defined before /{member_id}."""
    gid = int(guild_id)
    uid = int(user_id)

    member_stub = await get_member_stub()
    try:
        member = await member_stub.GetMember(
            pb2.GetMemberRequest(guild_id=gid, user_id=uid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    return _member_response_from_proto(member).model_dump()


# ---------- GET /guilds/{guild_id}/members/{member_id} ----------

@router.get("/{guild_id}/members/{member_id}")
async def get_guild_member(
    guild_id: str,
    member_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)
    mid = int(member_id)

    await require_member(gid, uid)

    member_stub = await get_member_stub()
    try:
        member = await member_stub.GetMember(
            pb2.GetMemberRequest(guild_id=gid, user_id=mid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    return _member_response_from_proto(member).model_dump()


# ---------- GET /guilds/{guild_id}/channels ----------

@router.get("/{guild_id}/channels")
async def get_guild_channels(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_member(gid, uid)

    guild_stub = await get_guild_stub()
    try:
        resp = await guild_stub.GetGuildChannels(
            pb2.GetGuildChannelsRequest(guild_id=gid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    return [_channel_response_from_proto(ch).model_dump() for ch in resp.channels]


# ---------- POST /guilds/{guild_id}/channels ----------

@router.post("/{guild_id}/channels", status_code=201)
async def create_guild_channel(
    guild_id: str,
    body: ChannelCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_permission(gid, uid, MANAGE_CHANNELS)

    parent_id = int(body.parent_id) if body.parent_id else None

    # Build permission overwrites from request
    overwrites = []
    if body.permission_overwrites:
        for ow in body.permission_overwrites:
            overwrites.append(pb2.PermissionOverwrite(
                id=int(ow.id),
                type=ow.type,
                allow=int(ow.allow),
                deny=int(ow.deny),
            ))

    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.CreateChannel(
            pb2.CreateChannelRequest(
                guild_id=gid,
                name=body.name,
                type=body.type,
                topic=body.topic,
                nsfw=body.nsfw or False,
                bitrate=body.bitrate or 0,
                user_limit=body.user_limit or 0,
                rate_limit_per_user=body.rate_limit_per_user or 0,
                parent_id=parent_id,
                position=body.position or 0,
                permission_overwrites=overwrites,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    channel_resp = _channel_response_from_proto(channel)

    # Publish CHANNEL_CREATE event
    redis = await get_redis()
    event = {"t": "CHANNEL_CREATE", "d": channel_resp.model_dump()}
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return channel_resp.model_dump()


# ---------------------------------------------------------------------------
# GET /guilds/{guild_id}/threads/active  - List all active threads in a guild
# ---------------------------------------------------------------------------


def _thread_response_from_proto(thread) -> ThreadChannelResponse:
    """Build a ThreadChannelResponse from a gRPC Thread message."""
    thread_metadata = None
    if thread.archived is not None:
        thread_metadata = ThreadMetadata(
            archived=thread.archived or False,
            auto_archive_duration=thread.auto_archive_duration or 1440,
            archive_timestamp=thread.archive_timestamp,
            locked=thread.locked or False,
        )

    return ThreadChannelResponse(
        id=str(thread.id),
        guild_id=str(thread.guild_id) if thread.guild_id else None,
        type=thread.type,
        name=thread.name,
        parent_id=str(thread.parent_id) if thread.parent_id else None,
        owner_id=str(thread.owner_id) if thread.owner_id else None,
        last_message_id=str(thread.last_message_id) if thread.last_message_id else None,
        thread_metadata=thread_metadata,
        message_count=thread.message_count or 0,
        member_count=thread.member_count or 0,
    )


@router.get("/{guild_id}/threads/active")
async def list_active_threads_for_guild(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_member(gid, uid)

    thread_stub = await get_thread_stub()
    try:
        resp = await thread_stub.GetGuildThreads(
            pb2.GetGuildThreadsRequest(guild_id=gid, archived=False)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="thread")

    threads = [_thread_response_from_proto(t) for t in resp.threads]
    return {"threads": [t.model_dump() for t in threads], "has_more": False}


# ---------------------------------------------------------------------------
# Server Discovery (separate router with /api/v10 prefix)
# ---------------------------------------------------------------------------

discovery_router = APIRouter(prefix="/api/v10", tags=["discovery"])


@discovery_router.get("/guild-discovery")
async def discover_guilds(
    query: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
):
    """Browse discoverable guilds. No authentication required."""
    guild_stub = await get_guild_stub()
    try:
        resp = await guild_stub.DiscoverGuilds(
            pb2.DiscoverGuildsRequest(query=query or None, limit=limit)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    return [
        {
            "id": str(g.id),
            "name": g.name,
            "icon": g.icon if g.HasField("icon") else None,
            "description": g.description if g.HasField("description") else None,
            "member_count": g.member_count,
        }
        for g in resp.guilds
    ]


@discovery_router.post("/guild-discovery/{guild_id}/join")
async def join_discoverable_guild(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Join a public (discoverable) guild directly, without an invite."""
    from datetime import datetime, timezone

    gid = int(guild_id)
    uid = int(user_id)

    guild_stub = await get_guild_stub()
    try:
        guild = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    if not guild.discoverable:
        raise HTTPException(
            status_code=403,
            detail={"code": 50001, "message": "This server is not open to public joining."},
        )

    member_stub = await get_member_stub()
    try:
        await member_stub.AddMember(pb2.AddMemberRequest(guild_id=gid, user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    # Track the user's guilds for the gateway READY event.
    redis = await get_redis()
    await redis.sadd(f"auth:user:{uid}:guilds", str(gid))

    try:
        count_resp = await member_stub.GetMemberCount(pb2.GetMemberCountRequest(guild_id=gid))
        member_count = count_resp.count
    except grpc.RpcError:
        member_count = guild.member_count or 1

    guild_resp = _guild_response_from_proto(guild, member_count=member_count)

    # Notify the guild room that a member joined.
    try:
        user_stub = await get_user_stub()
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
            "guild_id": str(gid),
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
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return guild_resp.model_dump()
