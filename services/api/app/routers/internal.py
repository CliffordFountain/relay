"""
Internal, service-to-service endpoints.

These are NOT called by end-user clients. They are invoked by other Relay
services (currently the Elixir gateway) and are authenticated with a shared
secret (``X-Internal-Secret``) rather than a user bearer token. The router is
mounted under ``/internal`` and is exempt from the per-user rate limiter.
"""
from __future__ import annotations

import hmac

import grpc
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.config import DEV_DEFAULT_INTERNAL_SECRET, settings
from app.grpc_client import get_channel_stub, get_member_stub
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import (
    CONNECT,
    VIEW_CHANNEL,
    compute_channel_permissions,
    has_permission,
)

router = APIRouter(prefix="/internal", tags=["internal"])

# Voice-capable channel types (see packages/common/src/constants/channels.ts).
_VOICE_CHANNEL_TYPES = {2, 13}  # GuildVoice, GuildStageVoice


class VoiceAuthorizeRequest(BaseModel):
    user_id: int
    guild_id: int
    channel_id: int


class VoiceAuthorizeResponse(BaseModel):
    authorized: bool
    reason: str = "ok"


def _require_internal_secret(provided: str | None) -> None:
    """Reject the request unless the shared internal secret matches (constant-time).

    Fails CLOSED outside development if the secret is missing or still the shipped
    dev-default: the default is published in the source tree, and this router is mounted
    on the same app served on the public API port, so accepting it would make /internal an
    oracle for anyone on the network. A production deploy MUST set a strong
    INTERNAL_SERVICE_SECRET; until it does, every /internal call is refused.
    """
    expected = settings.internal_service_secret
    if not settings.is_development and (not expected or expected == DEV_DEFAULT_INTERNAL_SECRET):
        raise HTTPException(
            status_code=403,
            detail={"code": 40001, "message": "Internal endpoint disabled: set a strong INTERNAL_SERVICE_SECRET"},
        )
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(
            status_code=403,
            detail={"code": 40001, "message": "Invalid internal service credentials"},
        )


@router.post("/voice/authorize", response_model=VoiceAuthorizeResponse)
async def authorize_voice_join(
    body: VoiceAuthorizeRequest,
    x_internal_secret: str | None = Header(default=None),
) -> VoiceAuthorizeResponse:
    """
    Authorize a user joining a specific voice channel.

    This is the channel-scoped check the gateway performs before minting a
    ``voice:grant:*`` for the voice-server. It answers a single question: may
    ``user_id`` CONNECT to ``channel_id``, given that the channel really belongs
    to ``guild_id``? All three conditions must hold:

      1. The channel exists and its authoritative ``guild_id`` matches the
         requested one — this is what stops a caller pairing a channel from
         guild H with a guild id G they happen to belong to (cross-guild spoof).
      2. The channel is a voice channel and the user is a member of the guild.
      3. The user's computed channel permissions include VIEW_CHANNEL and
         CONNECT (so a private voice channel they lack CONNECT on is refused).

    Returns ``{authorized: false, reason}`` rather than an error for the "not
    allowed" cases, so the gateway has a single boolean to act on.
    """
    _require_internal_secret(x_internal_secret)

    # 1. Resolve the channel and confirm it belongs to the claimed guild.
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(
            pb2.GetChannelRequest(channel_id=body.channel_id)
        )
    except grpc.RpcError:
        return VoiceAuthorizeResponse(authorized=False, reason="channel_not_found")

    # ``guild_id`` is an optional proto field: 0/unset means a non-guild (DM) channel.
    if not channel.guild_id or channel.guild_id != body.guild_id:
        return VoiceAuthorizeResponse(authorized=False, reason="channel_guild_mismatch")

    if channel.type not in _VOICE_CHANNEL_TYPES:
        return VoiceAuthorizeResponse(authorized=False, reason="not_a_voice_channel")

    # 2. Membership. Defense-in-depth: the gateway already gates on guild
    #    membership, but this endpoint must be correct on its own.
    member_stub = await get_member_stub()
    try:
        member_resp = await member_stub.IsMember(
            pb2.IsMemberRequest(guild_id=body.guild_id, user_id=body.user_id)
        )
        if not member_resp.is_member:
            return VoiceAuthorizeResponse(authorized=False, reason="not_a_member")
    except grpc.RpcError:
        return VoiceAuthorizeResponse(authorized=False, reason="not_a_member")

    # 3. Channel-level permissions: must be able to see AND connect to the channel.
    perms = await compute_channel_permissions(
        body.guild_id, body.channel_id, body.user_id
    )
    if not has_permission(perms, VIEW_CHANNEL):
        return VoiceAuthorizeResponse(authorized=False, reason="missing_view_channel")
    if not has_permission(perms, CONNECT):
        return VoiceAuthorizeResponse(authorized=False, reason="missing_connect")

    return VoiceAuthorizeResponse(authorized=True, reason="ok")
