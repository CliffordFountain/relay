import json
from datetime import datetime, timezone

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.models.guild import BanCreateRequest, BanResponse, MemberUpdateRequest, MemberResponse, MemberUserResponse
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_ban_stub, get_member_stub, get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.routers.audit_log import create_audit_log, AuditLogAction
from app.services.permissions import (
    require_permission,
    require_member_hierarchy,
    KICK_MEMBERS,
    BAN_MEMBERS,
    MANAGE_NICKNAMES,
    MODERATE_MEMBERS,
    CHANGE_NICKNAME,
)

router = APIRouter(prefix="/api/v10/guilds", tags=["moderation"])


# ---------- PUT /guilds/{guild_id}/bans/{user_id} ----------

@router.put("/{guild_id}/bans/{target_id}", status_code=204)
async def ban_user(
    guild_id: str,
    target_id: str,
    user_id: str = Depends(get_current_user_id),
    body: BanCreateRequest | None = None,
):
    gid = int(guild_id)
    tid = int(target_id)
    uid = int(user_id)

    # Require BAN_MEMBERS permission
    await require_permission(gid, uid, BAN_MEMBERS)

    # Cannot ban yourself
    if tid == uid:
        raise HTTPException(
            status_code=400,
            detail={"code": 50013, "message": "Cannot ban yourself"},
        )

    # Check role hierarchy (cannot ban members with higher/equal role)
    await require_member_hierarchy(gid, uid, tid)

    # Check if user exists
    user_stub = await get_user_stub()
    try:
        target_user = await user_stub.GetUser(pb2.GetUserRequest(user_id=tid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    # Create ban (data-services handles removing member, deleting messages, etc.)
    ban_stub = await get_ban_stub()
    try:
        await ban_stub.CreateBan(
            pb2.CreateBanRequest(
                guild_id=gid,
                user_id=tid,
                reason=body.reason if body else None,
                delete_message_days=(body.delete_message_seconds // 86400)
                if (body and body.delete_message_seconds) else 0,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="ban")

    # Remove member from guild
    member_stub = await get_member_stub()
    try:
        await member_stub.RemoveMember(
            pb2.RemoveMemberRequest(guild_id=gid, user_id=tid)
        )
    except grpc.RpcError:
        pass  # Member may not exist (banning a non-member is valid)

    # Audit log
    await create_audit_log(
        gid, uid, tid, AuditLogAction.MEMBER_BAN_ADD,
        reason=body.reason if body else None,
    )

    # Publish events
    redis = await get_redis()

    ban_event = {
        "t": "GUILD_BAN_ADD",
        "d": {
            "guild_id": guild_id,
            "user": {
                "id": str(target_user.id),
                "username": target_user.username,
                "avatar": target_user.avatar,
            },
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(ban_event))

    remove_event = {
        "t": "GUILD_MEMBER_REMOVE",
        "d": {
            "guild_id": guild_id,
            "user": {
                "id": str(target_user.id),
                "username": target_user.username,
                "avatar": target_user.avatar,
            },
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(remove_event))

    return Response(status_code=204)


# ---------- DELETE /guilds/{guild_id}/bans/{user_id} ----------

@router.delete("/{guild_id}/bans/{target_id}", status_code=204)
async def unban_user(
    guild_id: str,
    target_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    tid = int(target_id)
    uid = int(user_id)

    # Require BAN_MEMBERS permission
    await require_permission(gid, uid, BAN_MEMBERS)

    # Check ban exists
    ban_stub = await get_ban_stub()
    try:
        await ban_stub.GetBan(pb2.GetBanRequest(guild_id=gid, user_id=tid))
    except grpc.RpcError as exc:
        if exc.code() == grpc.StatusCode.NOT_FOUND:
            raise HTTPException(
                status_code=404,
                detail={"code": 10026, "message": "Unknown Ban"},
            )
        handle_grpc_error(exc, resource="ban")

    try:
        await ban_stub.DeleteBan(pb2.DeleteBanRequest(guild_id=gid, user_id=tid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="ban")

    # Audit log
    await create_audit_log(
        gid, uid, tid, AuditLogAction.MEMBER_BAN_REMOVE,
    )

    # Publish GUILD_BAN_REMOVE event
    redis = await get_redis()
    user_stub = await get_user_stub()
    try:
        target_user = await user_stub.GetUser(pb2.GetUserRequest(user_id=tid))
        user_info = {
            "id": str(target_user.id),
            "username": target_user.username,
            "avatar": target_user.avatar,
        }
    except grpc.RpcError:
        user_info = {"id": target_id}

    event = {
        "t": "GUILD_BAN_REMOVE",
        "d": {
            "guild_id": guild_id,
            "user": user_info,
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return Response(status_code=204)


# ---------- GET /guilds/{guild_id}/bans ----------

@router.get("/{guild_id}/bans")
async def list_bans(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    # Require BAN_MEMBERS permission to view bans
    await require_permission(gid, uid, BAN_MEMBERS)

    ban_stub = await get_ban_stub()
    try:
        bans_resp = await ban_stub.GetBans(pb2.GetBansRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="ban")

    result = []
    for ban in bans_resp.bans:
        user_info: dict
        if ban.user:
            user_info = {
                "id": str(ban.user.id),
                "username": ban.user.username,
                "avatar": ban.user.avatar,
            }
        else:
            # ban.user unpopulated: the Ban message carries no bare user_id, so there is no id
            # to look up here. Return a minimal entry rather than querying GetUser with the
            # wrong id (it previously passed ban.guild_id as the user id).
            user_info = {"id": "0"}

        result.append(BanResponse(
            user=user_info,
            reason=ban.reason,
        ).model_dump())

    return result


# ---------- DELETE /guilds/{guild_id}/members/{user_id} ----------

@router.delete("/{guild_id}/members/{target_id}", status_code=204)
async def kick_member(
    guild_id: str,
    target_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    tid = int(target_id)
    uid = int(user_id)

    # Require KICK_MEMBERS permission
    await require_permission(gid, uid, KICK_MEMBERS)

    # Cannot kick yourself
    if tid == uid:
        raise HTTPException(
            status_code=400,
            detail={"code": 50013, "message": "Cannot kick yourself"},
        )

    # Check role hierarchy
    await require_member_hierarchy(gid, uid, tid)

    # Verify member exists
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(pb2.IsMemberRequest(guild_id=gid, user_id=tid))
        if not resp.is_member:
            raise HTTPException(
                status_code=404,
                detail={"code": 10007, "message": "Unknown Member"},
            )
    except grpc.RpcError:
        raise HTTPException(
            status_code=404,
            detail={"code": 10007, "message": "Unknown Member"},
        )

    # Remove member
    try:
        await member_stub.RemoveMember(
            pb2.RemoveMemberRequest(guild_id=gid, user_id=tid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    # Audit log
    await create_audit_log(
        gid, uid, tid, AuditLogAction.MEMBER_KICK,
    )

    # Publish GUILD_MEMBER_REMOVE event
    redis = await get_redis()
    user_stub = await get_user_stub()
    try:
        target_user = await user_stub.GetUser(pb2.GetUserRequest(user_id=tid))
        user_info = {
            "id": str(target_user.id),
            "username": target_user.username,
            "avatar": target_user.avatar,
        }
    except grpc.RpcError:
        user_info = {"id": target_id}

    event = {
        "t": "GUILD_MEMBER_REMOVE",
        "d": {
            "guild_id": guild_id,
            "user": user_info,
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return Response(status_code=204)


# ---------- PATCH /guilds/{guild_id}/members/{user_id} ----------

@router.patch("/{guild_id}/members/{target_id}")
async def update_member(
    guild_id: str,
    target_id: str,
    body: MemberUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Update member - used for timeouts (communication_disabled_until) and nickname changes."""
    gid = int(guild_id)
    uid = int(user_id)
    # @me is shorthand for the current user
    tid = uid if target_id == "@me" else int(target_id)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    # Permission check depends on what's being changed
    if "nick" in updates:
        if tid == uid:
            await require_permission(gid, uid, CHANGE_NICKNAME)
        else:
            await require_permission(gid, uid, MANAGE_NICKNAMES)
            await require_member_hierarchy(gid, uid, tid)

    if "communication_disabled_until" in updates:
        await require_permission(gid, uid, MODERATE_MEMBERS)
        await require_member_hierarchy(gid, uid, tid)

    # Verify member exists
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(pb2.IsMemberRequest(guild_id=gid, user_id=tid))
        if not resp.is_member:
            raise HTTPException(
                status_code=404,
                detail={"code": 10007, "message": "Unknown Member"},
            )
    except grpc.RpcError:
        raise HTTPException(
            status_code=404,
            detail={"code": 10007, "message": "Unknown Member"},
        )

    # Handle communication_disabled_until: a timestamp sets the timeout; an explicit null
    # clears it. Forward "" to data-services as the explicit-clear sentinel — a proto None is
    # indistinguishable from "field absent / don't change" (which COALESCE would keep).
    cdu_present = "communication_disabled_until" in updates
    cdu_str = None
    if cdu_present:
        val = updates["communication_disabled_until"]
        if val is None:
            cdu_str = ""  # explicit clear (un-timeout)
        else:
            try:
                timeout_dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                raise HTTPException(
                    status_code=400,
                    detail={"code": 50035, "message": "Invalid ISO8601 timestamp"},
                )
            max_timeout = datetime.now(timezone.utc).timestamp() + (28 * 24 * 60 * 60)
            if timeout_dt.timestamp() > max_timeout:
                raise HTTPException(
                    status_code=400,
                    detail={"code": 50035, "message": "Timeout duration exceeds maximum of 28 days"},
                )
            cdu_str = timeout_dt.isoformat()

    # Build update request
    update_kwargs: dict = {"guild_id": gid, "user_id": tid}
    if "nick" in updates:
        update_kwargs["nick"] = updates["nick"]
    if cdu_present:
        update_kwargs["communication_disabled_until"] = cdu_str

    try:
        updated = await member_stub.UpdateMember(
            pb2.UpdateMemberRequest(**update_kwargs)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    # Get roles
    try:
        roles_resp = await member_stub.GetMemberRoles(
            pb2.GetMemberRolesRequest(guild_id=gid, user_id=tid)
        )
        roles = [str(r) for r in roles_resp.role_ids]
    except grpc.RpcError:
        roles = []

    # Fetch user data for the response
    user_stub = await get_user_stub()
    try:
        user_row = await user_stub.GetUser(pb2.GetUserRequest(user_id=tid))
        user = MemberUserResponse(
            id=str(tid),
            username=user_row.username or "",
            global_name=user_row.display_name if user_row.display_name else None,
            avatar=user_row.avatar if user_row.avatar else None,
            bot=False,
        )
    except grpc.RpcError:
        user = MemberUserResponse(
            id=str(tid),
            username=f"User-{str(tid)[-4:]}",
        )

    result = MemberResponse(
        user=user,
        nick=updated.nick if updated else None,
        roles=roles,
        joined_at=updated.joined_at if updated else "",
        communication_disabled_until=(updated.communication_disabled_until or None) if updated else None,
    )

    # Publish GUILD_MEMBER_UPDATE event
    redis = await get_redis()
    event = {
        "t": "GUILD_MEMBER_UPDATE",
        "d": {
            "guild_id": guild_id,
            **result.model_dump(),
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return result.model_dump()
