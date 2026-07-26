import json
from typing import Optional

import grpc
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user_id
from app.grpc_client import get_guild_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import require_permission, MANAGE_GUILD
from app.routers.audit_log import create_audit_log, AuditLogAction

router = APIRouter(prefix="/api/v10/guilds", tags=["automod"])


# ─── Request / Response Models ───

class AutoModActionMetadata(BaseModel):
    channel_id: Optional[str] = None
    duration_seconds: Optional[int] = None


class AutoModAction(BaseModel):
    type: int  # 1 = Block Message, 2 = Send Alert, 3 = Timeout
    metadata: Optional[AutoModActionMetadata] = None


class AutoModTriggerMetadata(BaseModel):
    keyword_filter: Optional[list[str]] = None
    mention_total_limit: Optional[int] = None


class AutoModRuleCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    event_type: int = 1  # MESSAGE_SEND
    trigger_type: int  # 1 = KEYWORD, 3 = SPAM, 5 = MENTION_SPAM
    trigger_metadata: AutoModTriggerMetadata = Field(default_factory=AutoModTriggerMetadata)
    actions: list[AutoModAction] = Field(default_factory=list)
    enabled: bool = True
    exempt_roles: list[str] = Field(default_factory=list)
    exempt_channels: list[str] = Field(default_factory=list)


class AutoModRuleUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    event_type: Optional[int] = None
    trigger_metadata: Optional[AutoModTriggerMetadata] = None
    actions: Optional[list[AutoModAction]] = None
    enabled: Optional[bool] = None
    exempt_roles: Optional[list[str]] = None
    exempt_channels: Optional[list[str]] = None


class AutoModRuleResponse(BaseModel):
    id: str
    guild_id: str
    name: str
    event_type: int
    trigger_type: int
    trigger_metadata: dict
    actions: list
    enabled: bool
    exempt_roles: list[str]
    exempt_channels: list[str]


TRIGGER_TYPE_MAP = {
    1: "keyword",
    3: "spam",
    4: "keyword_preset",
    5: "mention_spam",
}

TRIGGER_TYPE_REVERSE = {v: k for k, v in TRIGGER_TYPE_MAP.items()}


def _rule_to_response(rule: pb2.AutoModRule) -> AutoModRuleResponse:
    trigger_meta: dict = {}
    if rule.trigger_metadata:
        try:
            trigger_meta = json.loads(rule.trigger_metadata)
        except (json.JSONDecodeError, ValueError):
            trigger_meta = {}

    actions_list: list = []
    if rule.actions:
        try:
            actions_list = json.loads(rule.actions)
        except (json.JSONDecodeError, ValueError):
            actions_list = []

    trigger_type_str = TRIGGER_TYPE_MAP.get(rule.trigger_type, "keyword")
    trigger_type_int = TRIGGER_TYPE_REVERSE.get(trigger_type_str, 1)

    return AutoModRuleResponse(
        id=str(rule.id),
        guild_id=str(rule.guild_id),
        name=rule.name,
        event_type=rule.event_type,
        trigger_type=trigger_type_int,
        trigger_metadata=trigger_meta,
        actions=actions_list,
        enabled=rule.enabled,
        exempt_roles=[str(r) for r in rule.exempt_roles],
        exempt_channels=[str(c) for c in rule.exempt_channels],
    )


async def enforce_automod(guild_id: int, channel_id: int, content: str) -> None:
    """Raise if the message content violates an enabled keyword automod rule with a
    block-message action. Called from the message-send path. Fails open on fetch errors."""
    if not content:
        return
    stub = await get_guild_stub()
    try:
        resp = await stub.GetAutoModRules(pb2.GetAutoModRulesRequest(guild_id=guild_id))
    except grpc.RpcError:
        return
    lowered = content.lower()
    for rule in resp.rules:
        if not rule.enabled:
            continue
        if str(channel_id) in [str(c) for c in rule.exempt_channels]:
            continue
        if TRIGGER_TYPE_MAP.get(rule.trigger_type, "keyword") != "keyword":
            continue
        try:
            meta = json.loads(rule.trigger_metadata) if rule.trigger_metadata else {}
            actions = json.loads(rule.actions) if rule.actions else []
        except (json.JSONDecodeError, ValueError):
            continue
        if not any(isinstance(a, dict) and a.get("type") == 1 for a in actions):
            continue  # no Block-Message action
        for kw in (meta.get("keyword_filter") or []):
            if kw and kw.lower() in lowered:
                raise HTTPException(
                    status_code=403,
                    detail={"code": 200000, "message": "Message blocked by automod", "rule": rule.name},
                )


# ─── GET /guilds/{guild_id}/auto-moderation/rules ───

@router.get("/{guild_id}/auto-moderation/rules")
async def list_automod_rules(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
) -> list[AutoModRuleResponse]:
    gid = int(guild_id)
    uid = int(user_id)

    await require_permission(gid, uid, MANAGE_GUILD)

    stub = await get_guild_stub()
    try:
        resp = await stub.GetAutoModRules(pb2.GetAutoModRulesRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    return [_rule_to_response(r) for r in resp.rules]


# ─── POST /guilds/{guild_id}/auto-moderation/rules ───

@router.post("/{guild_id}/auto-moderation/rules", status_code=201)
async def create_automod_rule(
    guild_id: str,
    body: AutoModRuleCreateRequest,
    user_id: str = Depends(get_current_user_id),
) -> AutoModRuleResponse:
    gid = int(guild_id)
    uid = int(user_id)

    await require_permission(gid, uid, MANAGE_GUILD)

    if body.trigger_type not in TRIGGER_TYPE_MAP:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": f"Invalid trigger_type: {body.trigger_type}"},
        )

    trigger_meta = body.trigger_metadata.model_dump(exclude_none=True)
    actions_json = [a.model_dump(exclude_none=True) for a in body.actions]
    exempt_roles_int = [int(r) for r in body.exempt_roles]
    exempt_channels_int = [int(c) for c in body.exempt_channels]

    stub = await get_guild_stub()
    try:
        rule = await stub.CreateAutoModRule(pb2.CreateAutoModRuleRequest(
            guild_id=gid,
            name=body.name,
            creator_id=uid,
            event_type=body.event_type,
            trigger_type=body.trigger_type,
            trigger_metadata=json.dumps(trigger_meta),
            actions=json.dumps(actions_json),
            enabled=body.enabled,
            exempt_roles=exempt_roles_int,
            exempt_channels=exempt_channels_int,
        ))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    result = _rule_to_response(rule)

    await create_audit_log(
        gid, uid, int(result.id), AuditLogAction.AUTOMOD_RULE_CREATE,
        changes=[{"key": "name", "new_value": body.name}],
    )

    return result


# ─── PATCH /guilds/{guild_id}/auto-moderation/rules/{rule_id} ───

@router.patch("/{guild_id}/auto-moderation/rules/{rule_id}")
async def update_automod_rule(
    guild_id: str,
    rule_id: str,
    body: AutoModRuleUpdateRequest,
    user_id: str = Depends(get_current_user_id),
) -> AutoModRuleResponse:
    gid = int(guild_id)
    uid = int(user_id)
    rid = int(rule_id)

    await require_permission(gid, uid, MANAGE_GUILD)

    update_req = pb2.UpdateAutoModRuleRequest(rule_id=rid, guild_id=gid)

    if body.name is not None:
        update_req.name = body.name
    if body.trigger_metadata is not None:
        update_req.trigger_metadata = json.dumps(body.trigger_metadata.model_dump(exclude_none=True))
    if body.actions is not None:
        update_req.actions = json.dumps([a.model_dump(exclude_none=True) for a in body.actions])
    if body.enabled is not None:
        update_req.enabled = body.enabled

    stub = await get_guild_stub()
    try:
        rule = await stub.UpdateAutoModRule(update_req)
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="automod_rule")

    result = _rule_to_response(rule)
    await create_audit_log(gid, uid, rid, AuditLogAction.AUTOMOD_RULE_UPDATE)

    return result


# ─── DELETE /guilds/{guild_id}/auto-moderation/rules/{rule_id} ───

@router.delete("/{guild_id}/auto-moderation/rules/{rule_id}", status_code=204)
async def delete_automod_rule(
    guild_id: str,
    rule_id: str,
    user_id: str = Depends(get_current_user_id),
) -> None:
    gid = int(guild_id)
    uid = int(user_id)
    rid = int(rule_id)

    await require_permission(gid, uid, MANAGE_GUILD)

    stub = await get_guild_stub()
    try:
        # Fetch name for audit log before deletion
        rule = await stub.GetAutoModRule(pb2.GetAutoModRuleRequest(rule_id=rid, guild_id=gid))
        rule_name = rule.name
        await stub.DeleteAutoModRule(pb2.DeleteAutoModRuleRequest(rule_id=rid, guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="automod_rule")

    await create_audit_log(
        gid, uid, rid, AuditLogAction.AUTOMOD_RULE_DELETE,
        changes=[{"key": "name", "old_value": rule_name}],
    )
