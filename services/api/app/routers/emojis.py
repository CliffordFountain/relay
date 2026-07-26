import json

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_guild_stub, get_member_stub, get_permission_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/guilds", tags=["emojis"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class EmojiCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=32)
    image: str  # base64 data URI


class EmojiUpdateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=32)


class EmojiResponse(BaseModel):
    id: str
    name: str
    animated: bool = False
    available: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _require_manage_emojis(guild_id: int, user_id: int):
    """Allow the guild owner, an ADMINISTRATOR, or anyone with MANAGE_GUILD_EXPRESSIONS."""
    from app.services.permissions import (
        compute_base_permissions, has_permission, MANAGE_GUILD_EXPRESSIONS,
    )
    perms = await compute_base_permissions(guild_id, user_id)
    if not has_permission(perms, MANAGE_GUILD_EXPRESSIONS):
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Missing Permissions"},
        )


def _upload_emoji_image(emoji_id: int, data_url: str) -> None:
    """Store a custom-emoji image in the relay-emojis bucket keyed by emoji id, so the
    client can load it same-origin via /cdn/relay-emojis/{id}.png. Best-effort: a storage
    failure must not fail emoji creation."""
    if not data_url or not data_url.startswith("data:"):
        return
    import base64
    import boto3
    from botocore.config import Config as BotoConfig
    from app.config import settings
    try:
        header, b64 = data_url.split(",", 1)
        mime = header[5:].split(";")[0] or "image/png"
        raw = base64.b64decode(b64)
        s3 = boto3.client(
            "s3", endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=BotoConfig(signature_version="s3v4"), region_name="us-east-1",
        )
        s3.put_object(Bucket="relay-emojis", Key=f"{emoji_id}.png", Body=raw, ContentType=mime)
    except Exception:
        pass


def _emoji_response_from_proto(emoji) -> EmojiResponse:
    return EmojiResponse(
        id=str(emoji.id),
        name=emoji.name,
        animated=emoji.animated or False,
        available=emoji.available if emoji.available is not None else True,
    )


# ---------------------------------------------------------------------------
# GET /guilds/{guild_id}/emojis
# ---------------------------------------------------------------------------


@router.get("/{guild_id}/emojis")
async def list_guild_emojis(
    guild_id: int,
    user_id: str = Depends(get_current_user_id),
):
    """List all custom emojis for a guild. Requires guild membership."""
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(
            pb2.IsMemberRequest(guild_id=guild_id, user_id=int(user_id))
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

    guild_stub = await get_guild_stub()
    try:
        resp = await guild_stub.GetGuildEmojis(
            pb2.GetGuildEmojisRequest(guild_id=guild_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="emoji")

    return [_emoji_response_from_proto(e).model_dump() for e in resp.emojis]


# ---------------------------------------------------------------------------
# GET /guilds/{guild_id}/emojis/{emoji_id}
# ---------------------------------------------------------------------------


@router.get("/{guild_id}/emojis/{emoji_id}")
async def get_guild_emoji(
    guild_id: int,
    emoji_id: int,
    user_id: str = Depends(get_current_user_id),
):
    """Get a single custom emoji."""
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(
            pb2.IsMemberRequest(guild_id=guild_id, user_id=int(user_id))
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

    guild_stub = await get_guild_stub()
    try:
        emojis_resp = await guild_stub.GetGuildEmojis(
            pb2.GetGuildEmojisRequest(guild_id=guild_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="emoji")

    for e in emojis_resp.emojis:
        if e.id == emoji_id:
            return _emoji_response_from_proto(e).model_dump()

    raise HTTPException(
        status_code=404,
        detail={"code": 10014, "message": "Unknown Emoji"},
    )


# ---------------------------------------------------------------------------
# POST /guilds/{guild_id}/emojis
# ---------------------------------------------------------------------------


@router.post("/{guild_id}/emojis", status_code=201)
async def create_guild_emoji(
    guild_id: int,
    body: EmojiCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Upload a custom emoji. Requires owner or MANAGE_GUILD_EXPRESSIONS."""
    uid = int(user_id)
    await _require_manage_emojis(guild_id, uid)

    guild_stub = await get_guild_stub()
    try:
        emoji = await guild_stub.CreateEmoji(
            pb2.CreateEmojiRequest(
                guild_id=guild_id,
                name=body.name,
                image_url=body.image,
                user_id=uid,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="emoji")

    # Persist the image so it can be served same-origin via /cdn/relay-emojis/{id}.png.
    _upload_emoji_image(emoji.id, body.image)

    result = _emoji_response_from_proto(emoji)

    # Publish GUILD_EMOJIS_UPDATE event
    redis = await get_redis()
    try:
        all_resp = await guild_stub.GetGuildEmojis(
            pb2.GetGuildEmojisRequest(guild_id=guild_id)
        )
        all_emojis = [_emoji_response_from_proto(e).model_dump() for e in all_resp.emojis]
    except grpc.RpcError:
        all_emojis = [result.model_dump()]

    event = {
        "t": "GUILD_EMOJIS_UPDATE",
        "d": {
            "guild_id": str(guild_id),
            "emojis": all_emojis,
        },
    }
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return result.model_dump()


# ---------------------------------------------------------------------------
# PATCH /guilds/{guild_id}/emojis/{emoji_id}
# ---------------------------------------------------------------------------


@router.patch("/{guild_id}/emojis/{emoji_id}")
async def update_guild_emoji(
    guild_id: int,
    emoji_id: int,
    body: EmojiUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Rename a custom emoji."""
    uid = int(user_id)
    await _require_manage_emojis(guild_id, uid)

    guild_stub = await get_guild_stub()
    try:
        updated = await guild_stub.UpdateEmoji(
            pb2.UpdateEmojiRequest(
                emoji_id=emoji_id,
                guild_id=guild_id,
                name=body.name,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="emoji")

    result = _emoji_response_from_proto(updated)

    # Publish GUILD_EMOJIS_UPDATE event
    redis = await get_redis()
    try:
        all_resp = await guild_stub.GetGuildEmojis(
            pb2.GetGuildEmojisRequest(guild_id=guild_id)
        )
        all_emojis = [_emoji_response_from_proto(e).model_dump() for e in all_resp.emojis]
    except grpc.RpcError:
        all_emojis = [result.model_dump()]

    event = {
        "t": "GUILD_EMOJIS_UPDATE",
        "d": {
            "guild_id": str(guild_id),
            "emojis": all_emojis,
        },
    }
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return result.model_dump()


# ---------------------------------------------------------------------------
# DELETE /guilds/{guild_id}/emojis/{emoji_id}
# ---------------------------------------------------------------------------


@router.delete("/{guild_id}/emojis/{emoji_id}", status_code=204)
async def delete_guild_emoji(
    guild_id: int,
    emoji_id: int,
    user_id: str = Depends(get_current_user_id),
):
    """Delete a custom emoji."""
    uid = int(user_id)
    await _require_manage_emojis(guild_id, uid)

    guild_stub = await get_guild_stub()
    try:
        await guild_stub.DeleteEmoji(
            pb2.DeleteEmojiRequest(emoji_id=emoji_id, guild_id=guild_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="emoji")

    # Publish GUILD_EMOJIS_UPDATE event
    redis = await get_redis()
    try:
        all_resp = await guild_stub.GetGuildEmojis(
            pb2.GetGuildEmojisRequest(guild_id=guild_id)
        )
        all_emojis = [_emoji_response_from_proto(e).model_dump() for e in all_resp.emojis]
    except grpc.RpcError:
        all_emojis = []

    event = {
        "t": "GUILD_EMOJIS_UPDATE",
        "d": {
            "guild_id": str(guild_id),
            "emojis": all_emojis,
        },
    }
    await redis.publish(f"guild:{guild_id}", json.dumps(event))

    return Response(status_code=204)
