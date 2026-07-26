"""Async gRPC channel and stub management for data-services communication.

Exposes a lazily-initialized ``grpc.aio.Channel`` and pre-built service
stubs.  Call :func:`get_channel` to obtain the channel, or use the
convenience accessors (:func:`get_user_stub`, :func:`get_guild_stub`, etc.)
for typed stubs.
"""

from __future__ import annotations

import grpc.aio

from app.config import settings
from app.grpc_stubs.relay_pb2_grpc import (
    BanServiceStub,
    ChannelServiceStub,
    GuildServiceStub,
    InviteServiceStub,
    MemberServiceStub,
    MessageServiceStub,
    NotificationServiceStub,
    PermissionServiceStub,
    ReactionServiceStub,
    ReadStateServiceStub,
    RelationshipServiceStub,
    RoleServiceStub,
    ThreadServiceStub,
    UserServiceStub,
    WebhookServiceStub,
)

# ---------------------------------------------------------------------------
# Module-level singleton channel
# ---------------------------------------------------------------------------

_channel: grpc.aio.Channel | None = None


async def get_channel() -> grpc.aio.Channel:
    """Return the shared async gRPC channel, creating it on first call."""
    global _channel
    if _channel is None:
        _channel = grpc.aio.insecure_channel(
            settings.data_services_url,
            options=[
                ("grpc.max_send_message_length", 50 * 1024 * 1024),
                ("grpc.max_receive_message_length", 50 * 1024 * 1024),
                ("grpc.keepalive_time_ms", 30000),
                ("grpc.keepalive_timeout_ms", 10000),
            ],
        )
    return _channel


async def close_channel() -> None:
    """Gracefully close the gRPC channel (call during shutdown)."""
    global _channel
    if _channel is not None:
        await _channel.close()
        _channel = None


# ---------------------------------------------------------------------------
# Stub accessors -- each creates a new lightweight stub wrapper around the
# shared channel.  Stubs are cheap; the channel is the expensive part.
# ---------------------------------------------------------------------------

async def get_user_stub() -> UserServiceStub:
    return UserServiceStub(await get_channel())


async def get_guild_stub() -> GuildServiceStub:
    return GuildServiceStub(await get_channel())


async def get_channel_stub() -> ChannelServiceStub:
    return ChannelServiceStub(await get_channel())


async def get_message_stub() -> MessageServiceStub:
    return MessageServiceStub(await get_channel())


async def get_reaction_stub() -> ReactionServiceStub:
    return ReactionServiceStub(await get_channel())


async def get_member_stub() -> MemberServiceStub:
    return MemberServiceStub(await get_channel())


async def get_role_stub() -> RoleServiceStub:
    return RoleServiceStub(await get_channel())


async def get_permission_stub() -> PermissionServiceStub:
    return PermissionServiceStub(await get_channel())


async def get_invite_stub() -> InviteServiceStub:
    return InviteServiceStub(await get_channel())


async def get_ban_stub() -> BanServiceStub:
    return BanServiceStub(await get_channel())


async def get_relationship_stub() -> RelationshipServiceStub:
    return RelationshipServiceStub(await get_channel())


async def get_read_state_stub() -> ReadStateServiceStub:
    return ReadStateServiceStub(await get_channel())


async def get_thread_stub() -> ThreadServiceStub:
    return ThreadServiceStub(await get_channel())


async def get_webhook_stub() -> WebhookServiceStub:
    return WebhookServiceStub(await get_channel())


async def get_notification_stub() -> NotificationServiceStub:
    return NotificationServiceStub(await get_channel())
