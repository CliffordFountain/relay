import json
from typing import Optional

import grpc
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.models.user import UserResponse, DeleteAccountRequest
from app.models.message import MessageResponse
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import (
    get_user_stub, get_read_state_stub, get_relationship_stub, get_member_stub,
    get_guild_stub, get_message_stub,
)
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.routers.messages import _build_message_response_from_proto, _enrich_message_authors

ph = PasswordHasher()


class ReadStateResponse(BaseModel):
    channel_id: str
    last_message_id: str
    mention_count: int


class UserUpdateRequest(BaseModel):
    username: Optional[str] = Field(default=None, min_length=2, max_length=32)
    email: Optional[str] = None
    avatar: Optional[str] = None
    banner: Optional[str] = None
    global_name: Optional[str] = Field(default=None, max_length=32)
    bio: Optional[str] = Field(default=None, max_length=190)
    accent_color: Optional[int] = None
    pronouns: Optional[str] = Field(default=None, max_length=40)
    old_password: Optional[str] = None
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=72)


class UserUpdateResponse(BaseModel):
    id: str
    username: str
    email: str
    avatar: Optional[str] = None
    global_name: Optional[str] = None
    bio: Optional[str] = None
    accent_color: Optional[int] = None
    pronouns: str = ""
    banner: Optional[str] = None


router = APIRouter(prefix="/api/v10/users", tags=["users"])


@router.get("/@me", response_model=UserResponse)
async def get_current_user(user_id: str = Depends(get_current_user_id)):
    stub = await get_user_stub()
    try:
        user = await stub.GetUser(pb2.GetUserRequest(user_id=int(user_id)))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    return UserResponse(
        id=str(user.id),
        username=user.username,
        discriminator=user.discriminator or "0",
        global_name=getattr(user, 'display_name', None),
        email=user.email,
        avatar=user.avatar,
        banner=user.banner,
        bio=user.bio,
        accent_color=int(user.accent_color) if user.accent_color else None,
        pronouns=user.pronouns or "",
        mfa_enabled=user.mfa_enabled,
        verified=user.verified,
        locale=user.locale,
        flags=user.flags,
        public_flags=user.flags,
        premium_type=user.premium_type,
    )


@router.patch("/@me", response_model=UserUpdateResponse)
async def update_current_user(
    body: UserUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Update the current user's profile fields and/or password."""
    uid = int(user_id)
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    stub = await get_user_stub()

    # Handle password change
    old_password = updates.pop("old_password", None)
    new_password = updates.pop("new_password", None)
    if new_password:
        if not old_password:
            raise HTTPException(
                status_code=400,
                detail={"code": 50035, "message": "Invalid Form Body",
                        "errors": {"old_password": {"_errors": [{"code": "REQUIRED", "message": "Current password is required"}]}}},
            )
        # Get current user to verify password
        try:
            current_user = await stub.GetUser(pb2.GetUserRequest(user_id=uid))
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="user")

        password_hash = getattr(current_user, 'password_hash', None)
        if not password_hash:
            raise HTTPException(status_code=404, detail={"code": 10001, "message": "Unknown Account"})

        try:
            ph.verify(password_hash, old_password)
        except VerifyMismatchError:
            raise HTTPException(
                status_code=400,
                detail={"code": 50035, "message": "Invalid Form Body",
                        "errors": {"old_password": {"_errors": [{"code": "PASSWORD_INCORRECT", "message": "Password does not match"}]}}},
            )
        new_hash = ph.hash(new_password)
        try:
            await stub.UpdatePassword(
                pb2.UpdatePasswordRequest(user_id=uid, password_hash=new_hash)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="user")

    # Build gRPC update request for profile fields
    if updates:
        update_kwargs: dict = {"user_id": uid}
        if "username" in updates:
            update_kwargs["username"] = updates["username"]
        if "email" in updates:
            update_kwargs["email"] = updates["email"]
        if "avatar" in updates:
            update_kwargs["avatar"] = updates["avatar"]
        if "banner" in updates:
            update_kwargs["banner"] = updates["banner"]
        if "global_name" in updates:
            update_kwargs["display_name"] = updates["global_name"]
        if "bio" in updates:
            update_kwargs["bio"] = updates["bio"]
        if "accent_color" in updates:
            update_kwargs["accent_color"] = str(updates["accent_color"]) if updates["accent_color"] is not None else None
        if "pronouns" in updates:
            update_kwargs["pronouns"] = updates["pronouns"]

        try:
            updated_user = await stub.UpdateUser(pb2.UpdateUserRequest(**update_kwargs))
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="user")
    else:
        try:
            updated_user = await stub.GetUser(pb2.GetUserRequest(user_id=uid))
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="user")

    # Propagate the profile change so other clients — and this user's OWN cached views
    # (voice roster, message authors, member lists) — update live instead of showing the
    # old name. (1) Refresh the gateway's user cache, which feeds READY and voice-state
    # enrichment (otherwise a rejoin/reconnect keeps showing the old name). (2) Publish a
    # USER_UPDATE to the user's own sessions and to every guild they share. Best-effort:
    # a Redis hiccup must never fail the profile update.
    try:
        r = await get_redis()
        cache_key = f"auth:user:{uid}:data"
        raw = await r.get(cache_key)
        cached: dict = {}
        if raw:
            try:
                cached = json.loads(raw.decode() if isinstance(raw, (bytes, bytearray)) else raw)
            except (ValueError, TypeError):
                cached = {}
        cached.update({
            "id": str(uid),
            "username": updated_user.username,
            "global_name": updated_user.display_name if updated_user.HasField("display_name") else None,
            "avatar": updated_user.avatar or None,
            "bio": updated_user.bio or None,
            "banner": updated_user.banner or None,
            "accent_color": int(updated_user.accent_color) if updated_user.accent_color else None,
            "pronouns": updated_user.pronouns or "",
            "discriminator": cached.get("discriminator", "0"),
        })
        try:
            await r.set(cache_key, json.dumps(cached), keepttl=True)
        except TypeError:  # older redis-py without keepttl kwarg
            await r.set(cache_key, json.dumps(cached))
        event = json.dumps({"t": "USER_UPDATE", "d": cached})
        # Self: the user's own sessions (updates their own message authors / voice roster).
        await r.publish(f"user:{uid}", event)
        # Shared guilds: every member of a guild the user belongs to. Use the authoritative
        # gRPC guild list (the auth:user:{id}:guilds Redis set can be stale after a join).
        try:
            guilds_resp = await stub.GetUserGuilds(pb2.GetUserGuildsRequest(user_id=uid))
            for g in guilds_resp.guilds:
                await r.publish(f"guild:{g.id}", event)
        except grpc.RpcError:
            pass
    except Exception:
        pass

    return UserUpdateResponse(
        id=str(updated_user.id),
        username=updated_user.username,
        email=updated_user.email,
        avatar=updated_user.avatar,
        global_name=getattr(updated_user, 'display_name', None),
        bio=updated_user.bio,
        accent_color=int(updated_user.accent_color) if updated_user.accent_color else None,
        pronouns=updated_user.pronouns or "",
        banner=updated_user.banner,
    )


@router.post("/@me/delete", status_code=204)
async def delete_account(
    body: DeleteAccountRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Soft-delete the current user's account after verifying password."""
    uid = int(user_id)
    stub = await get_user_stub()

    try:
        user = await stub.GetUser(pb2.GetUserRequest(user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    password_hash = getattr(user, 'password_hash', None)
    if not password_hash:
        raise HTTPException(status_code=404, detail={"code": 10001, "message": "Unknown Account"})

    try:
        ph.verify(password_hash, body.password)
    except VerifyMismatchError:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body",
                    "errors": {"password": {"_errors": [{"code": "PASSWORD_INCORRECT", "message": "Password does not match"}]}}},
        )

    try:
        await stub.DeleteUser(pb2.DeleteUserRequest(user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")


class MutualGuildResponse(BaseModel):
    id: str
    name: str
    icon: str | None


class UserProfileResponse(BaseModel):
    id: str
    username: str
    global_name: str | None = None
    avatar: str | None = None
    banner: str | None = None
    bio: str | None = None
    accent_color: int | None = None
    pronouns: str = ""
    mutual_guilds: list[MutualGuildResponse] = []
    mutual_friends_count: int = 0


@router.get("/{target_user_id}/profile", response_model=UserProfileResponse)
async def get_user_profile(
    target_user_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return a user's profile including mutual guilds and mutual friends count."""
    uid = int(user_id)
    tid = int(target_user_id)

    user_stub = await get_user_stub()
    rel_stub = await get_relationship_stub()

    # Fetch target user
    try:
        target = await user_stub.GetUser(pb2.GetUserRequest(user_id=tid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    # Mutual guilds
    mutual_guilds: list[MutualGuildResponse] = []
    try:
        mutual_guilds_resp = await rel_stub.GetMutualGuilds(
            pb2.GetMutualGuildsRequest(user_id=uid, target_id=tid)
        )
        mutual_guilds = [
            MutualGuildResponse(
                id=str(g.id),
                name=g.name,
                icon=g.icon,
            )
            for g in mutual_guilds_resp.guilds
        ]
    except grpc.RpcError:
        pass  # Non-critical

    # Mutual friends count
    mutual_friends_count = 0
    if uid != tid:
        try:
            mutual_friends_resp = await rel_stub.GetMutualFriends(
                pb2.GetMutualFriendsRequest(user_id=uid, target_id=tid)
            )
            mutual_friends_count = len(mutual_friends_resp.relationships)
        except grpc.RpcError:
            pass  # Non-critical

    return UserProfileResponse(
        id=str(target.id),
        username=target.username,
        global_name=getattr(target, 'display_name', None),
        avatar=target.avatar,
        banner=target.banner,
        bio=target.bio,
        accent_color=int(target.accent_color) if target.accent_color else None,
        pronouns=target.pronouns or "",
        mutual_guilds=mutual_guilds,
        mutual_friends_count=mutual_friends_count,
    )


class GuildSummary(BaseModel):
    """The the API /users/@me/guilds partial guild object."""
    id: str
    name: str
    icon: str | None
    owner: bool = False  # True if the current user owns this guild
    owner_id: str = ""  # Included for client permission checks
    permissions: str = "0"  # The current user's computed permissions (as string bigint)
    features: list[str] = []
    approximate_member_count: int | None = None
    approximate_presence_count: int | None = None


@router.get("/@me/guilds", response_model=list[GuildSummary])
async def get_my_guilds(
    user_id: str = Depends(get_current_user_id),
    with_counts: bool = False,
):
    """Return all guilds the current user is a member of."""
    uid = int(user_id)
    stub = await get_user_stub()
    try:
        resp = await stub.GetUserGuilds(pb2.GetUserGuildsRequest(user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    return [
        GuildSummary(
            id=str(g.id),
            name=g.name,
            icon=g.icon if g.icon else None,
            owner=g.owner_id == uid,
            owner_id=str(g.owner_id),
        )
        for g in resp.guilds
    ]


@router.delete("/@me/guilds/{guild_id}", status_code=204)
async def leave_guild(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Leave a guild — remove the current user's own membership.

    This route was missing entirely, so the client's "Leave Server" (DELETE
    /users/@me/guilds/{id}) 404'd and the membership was never removed — the guild
    reappeared on refresh. Mirrors the kick flow (RemoveMember) but self-scoped.
    """
    gid = int(guild_id)
    uid = int(user_id)

    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(pb2.IsMemberRequest(guild_id=gid, user_id=uid))
        is_member = resp.is_member
    except grpc.RpcError:
        is_member = False
    if not is_member:
        raise HTTPException(status_code=404, detail={"code": 10004, "message": "Unknown Guild"})

    # The owner cannot leave their own guild (they must delete or transfer it) — matches the implementation.
    try:
        guild_stub = await get_guild_stub()
        g = await guild_stub.GetGuild(pb2.GetGuildRequest(guild_id=gid))
        if g.owner_id == uid:
            raise HTTPException(
                status_code=400,
                detail={"code": 50055, "message": "Owner cannot leave the guild; transfer ownership or delete it."},
            )
    except grpc.RpcError:
        pass

    try:
        await member_stub.RemoveMember(pb2.RemoveMemberRequest(guild_id=gid, user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    # Drop the guild from the cached membership set and notify clients (the leaver's own
    # session removes the guild; remaining members see the member leave).
    try:
        r = await get_redis()
        await r.srem(f"auth:user:{uid}:guilds", str(gid))
        await r.publish(f"user:{uid}", json.dumps({"t": "GUILD_DELETE", "d": {"id": str(gid)}}))
        await r.publish(
            f"guild:{gid}",
            json.dumps({"t": "GUILD_MEMBER_REMOVE", "d": {"guild_id": str(gid), "user": {"id": str(uid)}}}),
        )
    except Exception:
        pass


@router.get("/@me/read-states", response_model=list[ReadStateResponse])
async def get_read_states(user_id: str = Depends(get_current_user_id)):
    """Return all read states for the current user."""
    stub = await get_read_state_stub()
    try:
        resp = await stub.GetReadStates(pb2.GetReadStatesRequest(user_id=int(user_id)))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    return [
        ReadStateResponse(
            channel_id=str(rs.channel_id),
            last_message_id=str(rs.last_message_id),
            mention_count=rs.mention_count,
        )
        for rs in resp.read_states
    ]


@router.get("/@me/mentions", response_model=list[MessageResponse])
async def get_my_mentions(
    user_id: str = Depends(get_current_user_id),
    limit: int = 50,
):
    """Return recent messages that @mention the current user, newest first."""
    limit = max(1, min(limit, 100))

    msg_stub = await get_message_stub()
    try:
        resp = await msg_stub.GetUserMentions(
            pb2.GetUserMentionsRequest(user_id=int(user_id), limit=limit)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    messages = [
        _build_message_response_from_proto(
            m.message, guild_id=m.guild_id if m.guild_id else None
        )
        for m in resp.mentions
    ]
    await _enrich_message_authors(messages)
    return messages
