"""
Permission computation for Relay API.

All permission computations are delegated to the Rust data-services via gRPC.
This module provides convenience wrappers that raise FastAPI HTTPExceptions
when a user lacks the required permission.
"""
from __future__ import annotations

from typing import Optional

import grpc
from fastapi import HTTPException

from app.grpc_client import get_permission_stub, get_member_stub, get_role_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2


# ── Permission bit flags (matching packages/common/src/constants/permissions.ts) ──

CREATE_INSTANT_INVITE = 1 << 0
KICK_MEMBERS = 1 << 1
BAN_MEMBERS = 1 << 2
ADMINISTRATOR = 1 << 3
MANAGE_CHANNELS = 1 << 4
MANAGE_GUILD = 1 << 5
ADD_REACTIONS = 1 << 6
VIEW_AUDIT_LOG = 1 << 7
PRIORITY_SPEAKER = 1 << 8
STREAM = 1 << 9
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
SEND_TTS_MESSAGES = 1 << 12
MANAGE_MESSAGES = 1 << 13
EMBED_LINKS = 1 << 14
ATTACH_FILES = 1 << 15
READ_MESSAGE_HISTORY = 1 << 16
MENTION_EVERYONE = 1 << 17
USE_EXTERNAL_EMOJIS = 1 << 18
VIEW_GUILD_INSIGHTS = 1 << 19
CONNECT = 1 << 20
SPEAK = 1 << 21
MUTE_MEMBERS = 1 << 22
DEAFEN_MEMBERS = 1 << 23
MOVE_MEMBERS = 1 << 24
USE_VAD = 1 << 25
CHANGE_NICKNAME = 1 << 26
MANAGE_NICKNAMES = 1 << 27
MANAGE_ROLES = 1 << 28
MANAGE_WEBHOOKS = 1 << 29
MANAGE_GUILD_EXPRESSIONS = 1 << 30
USE_APPLICATION_COMMANDS = 1 << 31
REQUEST_TO_SPEAK = 1 << 32
MANAGE_EVENTS = 1 << 33
MANAGE_THREADS = 1 << 34
CREATE_PUBLIC_THREADS = 1 << 35
CREATE_PRIVATE_THREADS = 1 << 36
USE_EXTERNAL_STICKERS = 1 << 37
SEND_MESSAGES_IN_THREADS = 1 << 38
USE_EMBEDDED_ACTIVITIES = 1 << 39
MODERATE_MEMBERS = 1 << 40
VIEW_CREATOR_MONETIZATION_ANALYTICS = 1 << 41
USE_SOUNDBOARD = 1 << 42
CREATE_GUILD_EXPRESSIONS = 1 << 43
CREATE_EVENTS = 1 << 44
USE_EXTERNAL_SOUNDS = 1 << 45
SEND_VOICE_MESSAGES = 1 << 46
SEND_POLLS = 1 << 49
USE_EXTERNAL_APPS = 1 << 50

ALL_PERMISSIONS = (
    CREATE_INSTANT_INVITE
    | KICK_MEMBERS
    | BAN_MEMBERS
    | ADMINISTRATOR
    | MANAGE_CHANNELS
    | MANAGE_GUILD
    | ADD_REACTIONS
    | VIEW_AUDIT_LOG
    | PRIORITY_SPEAKER
    | STREAM
    | VIEW_CHANNEL
    | SEND_MESSAGES
    | SEND_TTS_MESSAGES
    | MANAGE_MESSAGES
    | EMBED_LINKS
    | ATTACH_FILES
    | READ_MESSAGE_HISTORY
    | MENTION_EVERYONE
    | USE_EXTERNAL_EMOJIS
    | VIEW_GUILD_INSIGHTS
    | CONNECT
    | SPEAK
    | MUTE_MEMBERS
    | DEAFEN_MEMBERS
    | MOVE_MEMBERS
    | USE_VAD
    | CHANGE_NICKNAME
    | MANAGE_NICKNAMES
    | MANAGE_ROLES
    | MANAGE_WEBHOOKS
    | MANAGE_GUILD_EXPRESSIONS
    | USE_APPLICATION_COMMANDS
    | REQUEST_TO_SPEAK
    | MANAGE_EVENTS
    | MANAGE_THREADS
    | CREATE_PUBLIC_THREADS
    | CREATE_PRIVATE_THREADS
    | USE_EXTERNAL_STICKERS
    | SEND_MESSAGES_IN_THREADS
    | USE_EMBEDDED_ACTIVITIES
    | MODERATE_MEMBERS
    | VIEW_CREATOR_MONETIZATION_ANALYTICS
    | USE_SOUNDBOARD
    | CREATE_GUILD_EXPRESSIONS
    | CREATE_EVENTS
    | USE_EXTERNAL_SOUNDS
    | SEND_VOICE_MESSAGES
    | SEND_POLLS
    | USE_EXTERNAL_APPS
)


async def compute_base_permissions(
    guild_id: int,
    user_id: int,
) -> int:
    """
    Compute a member's base (guild-level) permissions via gRPC.
    """
    stub = await get_permission_stub()
    try:
        resp = await stub.ComputePermissions(
            pb2.ComputePermissionsRequest(guild_id=guild_id, user_id=user_id)
        )
        return int(resp.permissions)
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")
        return 0  # unreachable, handle_grpc_error always raises


async def compute_channel_permissions(
    guild_id: int,
    channel_id: int,
    user_id: int,
    base_permissions: Optional[int] = None,
) -> int:
    """
    Compute permissions for a specific channel, applying overwrites, via gRPC.
    """
    stub = await get_permission_stub()
    try:
        resp = await stub.ComputeChannelPermissions(
            pb2.ComputeChannelPermissionsRequest(
                guild_id=guild_id, channel_id=channel_id, user_id=user_id
            )
        )
        return int(resp.permissions)
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")
        return 0  # unreachable


def has_permission(permissions: int, permission: int) -> bool:
    """Check if a permission set includes a specific permission."""
    if (permissions & ADMINISTRATOR) == ADMINISTRATOR:
        return True
    return (permissions & permission) == permission


async def require_permission(
    guild_id: int,
    user_id: int,
    permission: int,
    *,
    channel_id: Optional[int] = None,
    error_code: int = 50013,
    error_message: str = "Missing Permissions",
) -> int:
    """
    Check that a user has a specific permission. Raises HTTPException if not.
    Returns the computed permissions for potential further checks.
    """
    if channel_id is not None:
        perms = await compute_channel_permissions(guild_id, channel_id, user_id)
    else:
        perms = await compute_base_permissions(guild_id, user_id)

    if not has_permission(perms, permission):
        raise HTTPException(
            status_code=403,
            detail={"code": error_code, "message": error_message},
        )

    return perms


async def get_member_highest_role_position(guild_id: int, user_id: int) -> int:
    """Get the highest role position for a member via gRPC."""
    perm_stub = await get_permission_stub()
    try:
        owner_resp = await perm_stub.GetGuildOwner(
            pb2.GetGuildOwnerRequest(guild_id=guild_id)
        )
        if owner_resp.owner_id == user_id:
            return 999999  # Owner is always highest
    except grpc.RpcError:
        pass  # Fall through to role check

    role_stub = await get_role_stub()
    member_stub = await get_member_stub()
    try:
        roles_resp = await member_stub.GetMemberRoles(
            pb2.GetMemberRolesRequest(guild_id=guild_id, user_id=user_id)
        )
        role_ids = list(roles_resp.role_ids)
        if not role_ids:
            return 0

        all_roles_resp = await role_stub.GetRoles(
            pb2.GetRolesRequest(guild_id=guild_id)
        )
        max_pos = 0
        for role in all_roles_resp.roles:
            if role.id in role_ids:
                if role.position > max_pos:
                    max_pos = role.position
        return max_pos
    except grpc.RpcError:
        return 0


async def require_role_hierarchy(
    guild_id: int,
    actor_user_id: int,
    target_role_position: int,
) -> None:
    """Ensure the actor's highest role is above the target role."""
    actor_position = await get_member_highest_role_position(guild_id, actor_user_id)
    if actor_position <= target_role_position:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Missing Permissions - role hierarchy"},
        )


async def require_member_hierarchy(
    guild_id: int,
    actor_user_id: int,
    target_user_id: int,
) -> None:
    """Ensure the actor's highest role is above the target member's highest role."""
    perm_stub = await get_permission_stub()
    try:
        owner_resp = await perm_stub.GetGuildOwner(
            pb2.GetGuildOwnerRequest(guild_id=guild_id)
        )
        owner_id = owner_resp.owner_id
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")
        return  # unreachable

    if owner_id == actor_user_id:
        return
    if owner_id == target_user_id:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Missing Permissions - cannot act on server owner"},
        )

    actor_position = await get_member_highest_role_position(guild_id, actor_user_id)
    target_position = await get_member_highest_role_position(guild_id, target_user_id)

    if actor_position <= target_position:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Missing Permissions - role hierarchy"},
        )
