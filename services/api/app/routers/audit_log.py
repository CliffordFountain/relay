import json
from enum import IntEnum
from typing import Optional

import grpc
from fastapi import APIRouter, Depends, Query

from app.middleware.auth import get_current_user_id
from app.grpc_client import get_guild_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import require_permission, VIEW_AUDIT_LOG

router = APIRouter(prefix="/api/v10/guilds", tags=["audit-log"])


class AuditLogAction(IntEnum):
    GUILD_UPDATE = 1
    CHANNEL_CREATE = 10
    CHANNEL_UPDATE = 11
    CHANNEL_DELETE = 12
    MEMBER_KICK = 20
    MEMBER_BAN_ADD = 22
    MEMBER_BAN_REMOVE = 23
    MEMBER_UPDATE = 24
    MEMBER_ROLE_UPDATE = 25
    ROLE_CREATE = 30
    ROLE_UPDATE = 31
    ROLE_DELETE = 32
    INVITE_CREATE = 40
    INVITE_DELETE = 42
    AUTOMOD_RULE_CREATE = 140
    AUTOMOD_RULE_UPDATE = 141
    AUTOMOD_RULE_DELETE = 142


async def create_audit_log(
    guild_id: int,
    user_id: int,
    target_id: int | None,
    action_type: int,
    changes: dict | None = None,
    reason: str | None = None,
) -> None:
    """Record an audit log entry via gRPC."""
    stub = await get_guild_stub()
    try:
        await stub.CreateAuditLogEntry(
            pb2.CreateAuditLogEntryRequest(
                guild_id=guild_id,
                user_id=user_id,
                target_id=target_id,
                action_type=action_type,
                changes=json.dumps(changes) if changes else None,
                reason=reason,
            )
        )
    except grpc.RpcError:
        # Audit log write failures should not block the main operation
        pass


# ---------- GET /guilds/{guild_id}/audit-logs ----------

@router.get("/{guild_id}/audit-logs")
async def get_audit_logs(
    guild_id: str,
    user_id_filter: Optional[str] = Query(None, alias="user_id"),
    action_type: Optional[int] = Query(None),
    before: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    # Require VIEW_AUDIT_LOG permission (not just owner)
    await require_permission(gid, uid, VIEW_AUDIT_LOG)

    stub = await get_guild_stub()
    try:
        resp = await stub.GetAuditLogs(
            pb2.GetAuditLogsRequest(
                guild_id=gid,
                user_id=int(user_id_filter) if user_id_filter else None,
                action_type=action_type,
                before=int(before) if before else None,
                limit=limit,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    entries = []
    user_ids_seen: set[int] = set()
    for entry in resp.entries:
        changes_val = None
        if entry.changes:
            try:
                changes_val = json.loads(entry.changes)
            except (json.JSONDecodeError, TypeError):
                changes_val = entry.changes

        entries.append({
            "id": str(entry.id),
            "user_id": str(entry.user_id) if entry.user_id else None,
            "target_id": str(entry.target_id) if entry.target_id else None,
            "action_type": entry.action_type,
            "changes": changes_val if changes_val else [],
            "options": None,
            "reason": entry.reason if entry.reason else None,
        })
        if entry.user_id:
            user_ids_seen.add(entry.user_id)

    # Fetch user objects for all users referenced in the log (the gateway protocol includes these)
    users = []
    if user_ids_seen:
        from app.grpc_client import get_user_stub
        user_stub = await get_user_stub()
        for uid_ref in user_ids_seen:
            try:
                user = await user_stub.GetUser(pb2.GetUserRequest(user_id=uid_ref))
                users.append({
                    "id": str(user.id),
                    "username": user.username,
                    "discriminator": "0",
                    "global_name": user.display_name if user.HasField("display_name") else None,
                    "avatar": user.avatar if user.avatar else None,
                    "bot": False,
                    "flags": 0,
                    "public_flags": 0,
                })
            except Exception:
                pass

    return {
        "audit_log_entries": entries,
        "users": users,
        "webhooks": [],
        "threads": [],
        "application_commands": [],
        "auto_moderation_rules": [],
        "guild_scheduled_events": [],
    }
