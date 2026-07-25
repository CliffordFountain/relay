import json
from urllib.parse import unquote

import grpc
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_reaction_stub, get_message_stub, get_member_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.routers.messages import get_channel_with_access

router = APIRouter(prefix="/api/v10/channels", tags=["reactions"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_emoji(emoji: str) -> tuple[str, int | None]:
    """Parse a URL-decoded emoji string into (emoji_name, emoji_id)."""
    decoded = unquote(emoji)
    if ":" in decoded:
        parts = decoded.split(":", 1)
        name = parts[0]
        try:
            eid = int(parts[1])
        except (ValueError, IndexError):
            raise HTTPException(
                status_code=400,
                detail={"code": 50035, "message": "Invalid emoji format"},
            )
        return name, eid
    return decoded, None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.put(
    "/{channel_id}/messages/{message_id}/reactions/{emoji}/@me",
    status_code=204,
)
async def add_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    emoji_name, emoji_id = parse_emoji(emoji)

    reaction_stub = await get_reaction_stub()
    try:
        await reaction_stub.AddReaction(
            pb2.AddReactionRequest(
                message_id=message_id,
                user_id=int(user_id),
                emoji_name=emoji_name,
                emoji_id=emoji_id,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Publish MESSAGE_REACTION_ADD event
    r = await get_redis()

    # Fetch message author ID and member data for the full reference-compliant payload
    message_author_id = None
    member_data = None
    try:
        msg_stub = await get_message_stub()
        msg = await msg_stub.GetMessage(
            pb2.GetMessageRequest(channel_id=channel_id, message_id=message_id)
        )
        message_author_id = str(msg.author_id) if msg.author_id else None
    except grpc.RpcError:
        pass

    if guild_id:
        try:
            member_stub = await get_member_stub()
            member = await member_stub.GetMember(
                pb2.GetMemberRequest(guild_id=guild_id, user_id=int(user_id))
            )
            member_data = {
                "roles": [str(r) for r in (member.roles or [])],
                "nick": member.nick,
                "joined_at": member.joined_at,
                "deaf": member.deaf,
                "mute": member.mute,
                "flags": 0,
            }
        except grpc.RpcError:
            pass

    event = {
        "t": "MESSAGE_REACTION_ADD",
        "d": {
            "user_id": user_id,
            "channel_id": str(channel_id),
            "message_id": str(message_id),
            "guild_id": str(guild_id) if guild_id else None,
            "emoji": {
                "name": emoji_name,
                "id": str(emoji_id) if emoji_id else None,
            },
            "member": member_data,
            "message_author_id": message_author_id,
        },
    }
    if guild_id:
        await r.publish(f"guild:{guild_id}", json.dumps(event))

    return Response(status_code=204)


@router.delete(
    "/{channel_id}/messages/{message_id}/reactions/{emoji}/@me",
    status_code=204,
)
async def remove_own_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    emoji_name, emoji_id = parse_emoji(emoji)

    reaction_stub = await get_reaction_stub()
    try:
        await reaction_stub.RemoveReaction(
            pb2.RemoveReactionRequest(
                message_id=message_id,
                user_id=int(user_id),
                emoji_name=emoji_name,
                emoji_id=emoji_id,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Publish MESSAGE_REACTION_REMOVE event
    r = await get_redis()
    event = {
        "t": "MESSAGE_REACTION_REMOVE",
        "d": {
            "user_id": user_id,
            "channel_id": str(channel_id),
            "message_id": str(message_id),
            "guild_id": str(guild_id) if guild_id else None,
            "emoji": {
                "name": emoji_name,
                "id": str(emoji_id) if emoji_id else None,
            },
        },
    }
    if guild_id:
        await r.publish(f"guild:{guild_id}", json.dumps(event))

    return Response(status_code=204)


@router.get(
    "/{channel_id}/messages/{message_id}/reactions/{emoji}",
)
async def get_reactions(
    channel_id: int,
    message_id: int,
    emoji: str,
    limit: int = Query(25, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    await get_channel_with_access(channel_id, int(user_id))

    emoji_name, emoji_id = parse_emoji(emoji)

    reaction_stub = await get_reaction_stub()
    try:
        resp = await reaction_stub.GetReactions(
            pb2.GetReactionsRequest(
                message_id=message_id,
                emoji_name=emoji_name,
                emoji_id=emoji_id,
                limit=limit,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    return [
        {
            "id": str(u.id),
            "username": u.username,
            "avatar": u.avatar,
        }
        for u in resp.users
    ]


@router.delete(
    "/{channel_id}/messages/{message_id}/reactions",
    status_code=204,
)
async def remove_all_reactions(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    # Must have MANAGE_MESSAGES permission for guild channels
    if guild_id:
        from app.services.permissions import require_permission, MANAGE_MESSAGES
        await require_permission(
            guild_id, int(user_id), MANAGE_MESSAGES,
            channel_id=channel_id,
        )

    reaction_stub = await get_reaction_stub()
    try:
        await reaction_stub.RemoveAllReactions(
            pb2.RemoveAllReactionsRequest(message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Publish MESSAGE_REACTION_REMOVE_ALL event
    r = await get_redis()
    event = {
        "t": "MESSAGE_REACTION_REMOVE_ALL",
        "d": {
            "channel_id": str(channel_id),
            "message_id": str(message_id),
            "guild_id": str(guild_id) if guild_id else None,
        },
    }
    if guild_id:
        await r.publish(f"guild:{guild_id}", json.dumps(event))

    return Response(status_code=204)
