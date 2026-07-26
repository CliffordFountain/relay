import grpc
from fastapi import APIRouter, Depends, HTTPException

from app.models.notification import (
    NotificationSettingsRequest,
    NotificationSettingsResponse,
)
from app.middleware.auth import get_current_user_id
from app.grpc_client import get_notification_stub, get_member_stub, get_channel_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/users/@me", tags=["notification-settings"])


async def _require_guild_member(guild_id: int, user_id: int) -> None:
    """Verify that user_id is a member of guild_id."""
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


# ---------------------------------------------------------------------------
# GET /users/@me/guilds/{guild_id}/notification-settings
# ---------------------------------------------------------------------------


@router.get("/guilds/{guild_id}/notification-settings")
async def get_guild_notification_settings(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await _require_guild_member(gid, uid)

    notif_stub = await get_notification_stub()
    try:
        resp = await notif_stub.GetNotificationSettings(
            pb2.GetNotificationSettingsRequest(user_id=uid, guild_id=gid)
        )
    except grpc.RpcError as exc:
        if exc.code() == grpc.StatusCode.NOT_FOUND:
            return NotificationSettingsResponse(guild_id=guild_id).model_dump()
        handle_grpc_error(exc, resource="notification_settings")

    # resp.settings is a list; find the guild-level one (channel_id is None)
    for s in (resp.settings or []):
        if not s.channel_id:
            return NotificationSettingsResponse(
                guild_id=guild_id,
                muted=s.muted or False,
                message_notifications=s.message_notifications or 0,
                suppress_everyone=s.suppress_everyone or False,
                suppress_roles=s.suppress_roles or False,
            ).model_dump()

    return NotificationSettingsResponse(guild_id=guild_id).model_dump()


# ---------------------------------------------------------------------------
# PATCH /users/@me/guilds/{guild_id}/notification-settings
# ---------------------------------------------------------------------------


@router.patch("/guilds/{guild_id}/notification-settings")
async def update_guild_notification_settings(
    guild_id: str,
    body: NotificationSettingsRequest,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await _require_guild_member(gid, uid)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    notif_stub = await get_notification_stub()
    try:
        result = await notif_stub.UpsertNotificationSettings(
            pb2.UpsertNotificationSettingsRequest(
                user_id=uid,
                guild_id=gid,
                muted=updates.get("muted", False),
                message_notifications=updates.get("message_notifications", 0),
                suppress_everyone=updates.get("suppress_everyone", False),
                suppress_roles=updates.get("suppress_roles", False),
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="notification_settings")

    return NotificationSettingsResponse(
        guild_id=guild_id,
        muted=result.muted or False,
        message_notifications=result.message_notifications or 0,
        suppress_everyone=result.suppress_everyone or False,
        suppress_roles=result.suppress_roles or False,
    ).model_dump()


# ---------------------------------------------------------------------------
# GET /users/@me/channels/{channel_id}/notification-settings
# ---------------------------------------------------------------------------


@router.get("/channels/{channel_id}/notification-settings")
async def get_channel_notification_settings(
    channel_id: str,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    # Verify channel exists and user has access
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=cid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    guild_id = channel.guild_id
    if guild_id:
        await _require_guild_member(guild_id, uid)

    notif_stub = await get_notification_stub()
    try:
        resp = await notif_stub.GetNotificationSettings(
            pb2.GetNotificationSettingsRequest(user_id=uid, channel_id=cid)
        )
    except grpc.RpcError as exc:
        if exc.code() == grpc.StatusCode.NOT_FOUND:
            return NotificationSettingsResponse(
                channel_id=channel_id,
                guild_id=str(guild_id) if guild_id else None,
            ).model_dump()
        handle_grpc_error(exc, resource="notification_settings")

    for s in (resp.settings or []):
        if s.channel_id == cid:
            return NotificationSettingsResponse(
                channel_id=channel_id,
                guild_id=str(guild_id) if guild_id else None,
                muted=s.muted or False,
                message_notifications=s.message_notifications or 0,
                suppress_everyone=s.suppress_everyone or False,
                suppress_roles=s.suppress_roles or False,
            ).model_dump()

    return NotificationSettingsResponse(
        channel_id=channel_id,
        guild_id=str(guild_id) if guild_id else None,
    ).model_dump()


# ---------------------------------------------------------------------------
# PATCH /users/@me/channels/{channel_id}/notification-settings
# ---------------------------------------------------------------------------


@router.patch("/channels/{channel_id}/notification-settings")
async def update_channel_notification_settings(
    channel_id: str,
    body: NotificationSettingsRequest,
    user_id: str = Depends(get_current_user_id),
):
    cid = int(channel_id)
    uid = int(user_id)

    # Verify channel exists and user has access
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=cid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    guild_id = channel.guild_id
    if guild_id:
        await _require_guild_member(guild_id, uid)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    notif_stub = await get_notification_stub()
    try:
        result = await notif_stub.UpsertNotificationSettings(
            pb2.UpsertNotificationSettingsRequest(
                user_id=uid,
                guild_id=guild_id,
                channel_id=cid,
                muted=updates.get("muted", False),
                message_notifications=updates.get("message_notifications", 0),
                suppress_everyone=updates.get("suppress_everyone", False),
                suppress_roles=updates.get("suppress_roles", False),
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="notification_settings")

    return NotificationSettingsResponse(
        channel_id=channel_id,
        guild_id=str(guild_id) if guild_id else None,
        muted=result.muted or False,
        message_notifications=result.message_notifications or 0,
        suppress_everyone=result.suppress_everyone or False,
        suppress_roles=result.suppress_roles or False,
    ).model_dump()
