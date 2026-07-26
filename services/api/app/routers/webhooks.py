import json
import secrets
from typing import Any, Optional

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_webhook_stub, get_channel_stub, get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import require_permission, MANAGE_WEBHOOKS
from app.models.message import MessageResponse, MessageAuthor

router = APIRouter(tags=["webhooks"])

MAX_WEBHOOKS_PER_CHANNEL = 15


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class WebhookCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    avatar: Optional[str] = None


class WebhookUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    avatar: Optional[str] = None
    channel_id: Optional[str] = None


class EmbedFooterRequest(BaseModel):
    text: str = Field(max_length=2048)
    icon_url: Optional[str] = None


class EmbedAuthorRequest(BaseModel):
    name: str = Field(max_length=256)
    url: Optional[str] = None
    icon_url: Optional[str] = None


class EmbedFieldRequest(BaseModel):
    name: str = Field(max_length=256)
    value: str = Field(max_length=1024)
    inline: bool = False


class EmbedMediaRequest(BaseModel):
    url: str
    width: Optional[int] = None
    height: Optional[int] = None


class EmbedRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=256)
    description: Optional[str] = Field(default=None, max_length=4096)
    url: Optional[str] = None
    timestamp: Optional[str] = None
    color: Optional[int] = None
    footer: Optional[EmbedFooterRequest] = None
    author: Optional[EmbedAuthorRequest] = None
    fields: Optional[list[EmbedFieldRequest]] = Field(default=None, max_length=25)
    thumbnail: Optional[EmbedMediaRequest] = None
    image: Optional[EmbedMediaRequest] = None


class WebhookExecuteRequest(BaseModel):
    content: Optional[str] = Field(default=None, max_length=2000)
    username: Optional[str] = Field(default=None, max_length=80)
    avatar_url: Optional[str] = None
    tts: bool = False
    embeds: Optional[list[EmbedRequest]] = Field(default=None, max_length=10)
    components: Optional[list[dict[str, Any]]] = None


class WebhookUserResponse(BaseModel):
    id: str
    username: str
    avatar: Optional[str] = None


class WebhookResponse(BaseModel):
    id: str
    type: int
    guild_id: str
    channel_id: str
    name: str
    avatar: Optional[str] = None
    token: Optional[str] = None
    user: Optional[WebhookUserResponse] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


MAX_EMBED_TOTAL_CHARS = 6000


def _validate_embeds(embeds: list[EmbedRequest]) -> None:
    """Validate embed constraints beyond what Pydantic enforces."""
    total_chars = 0
    for embed in embeds:
        # Each embed must have at least one visible field
        has_content = any([
            embed.title,
            embed.description,
            embed.url,
            embed.fields,
            embed.author,
            embed.footer,
            embed.thumbnail,
            embed.image,
        ])
        if not has_content:
            raise HTTPException(
                status_code=400,
                detail={"code": 50035, "message": "Invalid Form Body", "errors": {
                    "embeds": {"_errors": [{"code": "EMBED_EMPTY", "message": "Embed must have at least one field"}]}
                }},
            )
        total_chars += len(embed.title or "")
        total_chars += len(embed.description or "")
        if embed.footer:
            total_chars += len(embed.footer.text)
        if embed.author:
            total_chars += len(embed.author.name)
        for field in (embed.fields or []):
            total_chars += len(field.name) + len(field.value)

    if total_chars > MAX_EMBED_TOTAL_CHARS:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body", "errors": {
                "embeds": {"_errors": [{"code": "EMBED_SIZE_EXCEEDED", "message": f"Total embed characters must not exceed {MAX_EMBED_TOTAL_CHARS}"}]}
            }},
        )


def _embed_request_to_proto(embed: EmbedRequest) -> pb2.Embed:
    """Convert an EmbedRequest Pydantic model to a protobuf Embed message."""
    kwargs: dict = {}
    if embed.title is not None:
        kwargs["title"] = embed.title
    if embed.description is not None:
        kwargs["description"] = embed.description
    if embed.url is not None:
        kwargs["url"] = embed.url
    if embed.timestamp is not None:
        kwargs["timestamp"] = embed.timestamp
    if embed.color is not None:
        kwargs["color"] = embed.color
    kwargs["type"] = "rich"
    if embed.author is not None:
        author_kwargs: dict = {"name": embed.author.name}
        if embed.author.url is not None:
            author_kwargs["url"] = embed.author.url
        if embed.author.icon_url is not None:
            author_kwargs["icon_url"] = embed.author.icon_url
        kwargs["author"] = pb2.EmbedAuthor(**author_kwargs)
    if embed.footer is not None:
        footer_kwargs: dict = {"text": embed.footer.text}
        if embed.footer.icon_url is not None:
            footer_kwargs["icon_url"] = embed.footer.icon_url
        kwargs["footer"] = pb2.EmbedFooter(**footer_kwargs)
    if embed.thumbnail is not None:
        thumb_kwargs: dict = {"url": embed.thumbnail.url}
        if embed.thumbnail.width is not None:
            thumb_kwargs["width"] = embed.thumbnail.width
        if embed.thumbnail.height is not None:
            thumb_kwargs["height"] = embed.thumbnail.height
        kwargs["thumbnail"] = pb2.EmbedMedia(**thumb_kwargs)
    if embed.image is not None:
        img_kwargs: dict = {"url": embed.image.url}
        if embed.image.width is not None:
            img_kwargs["width"] = embed.image.width
        if embed.image.height is not None:
            img_kwargs["height"] = embed.image.height
        kwargs["image"] = pb2.EmbedMedia(**img_kwargs)
    if embed.fields:
        kwargs["fields"] = [
            pb2.EmbedField(name=f.name, value=f.value, inline=f.inline)
            for f in embed.fields
        ]
    return pb2.Embed(**kwargs)


def _proto_embed_to_dict(embed: pb2.Embed) -> dict:
    """Convert a protobuf Embed message to a JSON-serializable dict."""
    result: dict = {"type": "rich"}
    if embed.HasField("title"):
        result["title"] = embed.title
    if embed.HasField("description"):
        result["description"] = embed.description
    if embed.HasField("url"):
        result["url"] = embed.url
    if embed.HasField("timestamp"):
        result["timestamp"] = embed.timestamp
    if embed.HasField("color"):
        result["color"] = embed.color
    if embed.HasField("author"):
        author: dict = {"name": embed.author.name}
        if embed.author.HasField("url"):
            author["url"] = embed.author.url
        if embed.author.HasField("icon_url"):
            author["icon_url"] = embed.author.icon_url
        result["author"] = author
    if embed.HasField("footer"):
        footer: dict = {"text": embed.footer.text}
        if embed.footer.HasField("icon_url"):
            footer["icon_url"] = embed.footer.icon_url
        result["footer"] = footer
    if embed.HasField("thumbnail"):
        thumb: dict = {"url": embed.thumbnail.url}
        if embed.thumbnail.HasField("width"):
            thumb["width"] = embed.thumbnail.width
        if embed.thumbnail.HasField("height"):
            thumb["height"] = embed.thumbnail.height
        result["thumbnail"] = thumb
    if embed.HasField("image"):
        img: dict = {"url": embed.image.url}
        if embed.image.HasField("width"):
            img["width"] = embed.image.width
        if embed.image.HasField("height"):
            img["height"] = embed.image.height
        result["image"] = img
    if embed.fields:
        result["fields"] = [
            {"name": f.name, "value": f.value, "inline": f.inline}
            for f in embed.fields
        ]
    return result


def _webhook_to_response(
    wh: pb2.Webhook,
    *,
    include_token: bool = True,
    creator: Optional[pb2.User] = None,
) -> WebhookResponse:
    user_resp = None
    if creator is not None:
        user_resp = WebhookUserResponse(
            id=str(creator.id),
            username=creator.username,
            avatar=creator.avatar if creator.HasField("avatar") else None,
        )
    return WebhookResponse(
        id=str(wh.id),
        type=wh.type,
        guild_id=str(wh.guild_id),
        channel_id=str(wh.channel_id),
        name=wh.name,
        avatar=wh.avatar if wh.HasField("avatar") else None,
        token=wh.token if include_token else None,
        user=user_resp,
    )


async def _fetch_webhook_or_404(webhook_id: int) -> pb2.Webhook:
    stub = await get_webhook_stub()
    try:
        return await stub.GetWebhook(pb2.GetWebhookRequest(webhook_id=webhook_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")


async def _fetch_channel_or_404(channel_id: int) -> pb2.Channel:
    stub = await get_channel_stub()
    try:
        return await stub.GetChannel(pb2.GetChannelRequest(channel_id=channel_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")


async def _fetch_creator(user_id: int) -> Optional[pb2.User]:
    stub = await get_user_stub()
    try:
        return await stub.GetUser(pb2.GetUserRequest(user_id=user_id))
    except grpc.RpcError:
        return None


# ---------------------------------------------------------------------------
# GET /channels/{channel_id}/webhooks
# ---------------------------------------------------------------------------


@router.get("/api/v10/channels/{channel_id}/webhooks")
async def list_channel_webhooks(
    channel_id: int,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    uid = int(user_id)
    channel = await _fetch_channel_or_404(channel_id)

    if not channel.HasField("guild_id") or channel.guild_id == 0:
        raise HTTPException(
            status_code=400,
            detail={"code": 50003, "message": "Cannot execute action on a DM channel"},
        )

    await require_permission(channel.guild_id, uid, MANAGE_WEBHOOKS, channel_id=channel_id)

    stub = await get_webhook_stub()
    try:
        resp = await stub.GetChannelWebhooks(pb2.GetChannelWebhooksRequest(channel_id=channel_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")

    results = []
    for wh in resp.webhooks:
        creator = await _fetch_creator(wh.user_id) if wh.user_id else None
        results.append(_webhook_to_response(wh, creator=creator).model_dump())

    return results


# ---------------------------------------------------------------------------
# POST /channels/{channel_id}/webhooks
# ---------------------------------------------------------------------------


@router.post("/api/v10/channels/{channel_id}/webhooks", status_code=201)
async def create_channel_webhook(
    channel_id: int,
    body: WebhookCreateRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    uid = int(user_id)
    channel = await _fetch_channel_or_404(channel_id)

    if not channel.HasField("guild_id") or channel.guild_id == 0:
        raise HTTPException(
            status_code=400,
            detail={"code": 50003, "message": "Cannot execute action on a DM channel"},
        )

    await require_permission(channel.guild_id, uid, MANAGE_WEBHOOKS, channel_id=channel_id)

    # Check max webhooks per channel
    wh_stub = await get_webhook_stub()
    try:
        existing = await wh_stub.GetChannelWebhooks(
            pb2.GetChannelWebhooksRequest(channel_id=channel_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")

    if len(existing.webhooks) >= MAX_WEBHOOKS_PER_CHANNEL:
        raise HTTPException(
            status_code=400,
            detail={"code": 30007, "message": "Maximum number of webhooks reached (15)"},
        )

    try:
        wh = await wh_stub.CreateWebhook(pb2.CreateWebhookRequest(
            guild_id=channel.guild_id,
            channel_id=channel_id,
            user_id=uid,
            name=body.name,
            avatar=body.avatar or "",
        ))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")

    creator = await _fetch_creator(uid)

    # Publish WEBHOOKS_UPDATE event
    redis = await get_redis()
    event = {"t": "WEBHOOKS_UPDATE", "d": {"guild_id": str(channel.guild_id), "channel_id": str(channel_id)}}
    await redis.publish(f"guild:{channel.guild_id}", json.dumps(event))

    return _webhook_to_response(wh, creator=creator).model_dump()


# ---------------------------------------------------------------------------
# GET /webhooks/{webhook_id}
# ---------------------------------------------------------------------------


@router.get("/api/v10/webhooks/{webhook_id}")
async def get_webhook(
    webhook_id: int,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    uid = int(user_id)
    wh = await _fetch_webhook_or_404(webhook_id)
    await require_permission(wh.guild_id, uid, MANAGE_WEBHOOKS, channel_id=wh.channel_id)
    creator = await _fetch_creator(wh.user_id) if wh.user_id else None
    return _webhook_to_response(wh, creator=creator).model_dump()


# ---------------------------------------------------------------------------
# PATCH /webhooks/{webhook_id}
# ---------------------------------------------------------------------------


@router.patch("/api/v10/webhooks/{webhook_id}")
async def update_webhook(
    webhook_id: int,
    body: WebhookUpdateRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    uid = int(user_id)
    wh = await _fetch_webhook_or_404(webhook_id)
    await require_permission(wh.guild_id, uid, MANAGE_WEBHOOKS, channel_id=wh.channel_id)

    new_channel_id = int(body.channel_id) if body.channel_id else wh.channel_id

    # If moving to a different channel, verify it's in the same guild
    if new_channel_id != wh.channel_id:
        target_ch = await _fetch_channel_or_404(new_channel_id)
        if target_ch.guild_id != wh.guild_id:
            raise HTTPException(
                status_code=400,
                detail={"code": 50035, "message": "Invalid Form Body"},
            )
        await require_permission(wh.guild_id, uid, MANAGE_WEBHOOKS, channel_id=new_channel_id)

    stub = await get_webhook_stub()
    update_req = pb2.UpdateWebhookRequest(webhook_id=webhook_id)
    if body.name is not None:
        update_req.name = body.name
    if body.avatar is not None:
        update_req.avatar = body.avatar
    if body.channel_id is not None:
        update_req.channel_id = new_channel_id

    try:
        updated = await stub.UpdateWebhook(update_req)
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")

    creator = await _fetch_creator(updated.user_id) if updated.user_id else None

    # Publish WEBHOOKS_UPDATE events
    redis = await get_redis()
    event = {"t": "WEBHOOKS_UPDATE", "d": {"guild_id": str(wh.guild_id), "channel_id": str(wh.channel_id)}}
    await redis.publish(f"guild:{wh.guild_id}", json.dumps(event))

    if new_channel_id != wh.channel_id:
        event2 = {"t": "WEBHOOKS_UPDATE", "d": {"guild_id": str(wh.guild_id), "channel_id": str(new_channel_id)}}
        await redis.publish(f"guild:{wh.guild_id}", json.dumps(event2))

    return _webhook_to_response(updated, creator=creator).model_dump()


# ---------------------------------------------------------------------------
# DELETE /webhooks/{webhook_id}
# ---------------------------------------------------------------------------


@router.delete("/api/v10/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: int,
    user_id: str = Depends(get_current_user_id),
) -> Response:
    uid = int(user_id)
    wh = await _fetch_webhook_or_404(webhook_id)
    await require_permission(wh.guild_id, uid, MANAGE_WEBHOOKS, channel_id=wh.channel_id)

    stub = await get_webhook_stub()
    try:
        await stub.DeleteWebhook(pb2.DeleteWebhookRequest(webhook_id=webhook_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="webhook")

    redis = await get_redis()
    event = {"t": "WEBHOOKS_UPDATE", "d": {"guild_id": str(wh.guild_id), "channel_id": str(wh.channel_id)}}
    await redis.publish(f"guild:{wh.guild_id}", json.dumps(event))

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /webhooks/{webhook_id}/{token}  — Execute webhook (no auth required)
# ---------------------------------------------------------------------------


@router.post("/api/v10/webhooks/{webhook_id}/{token}", status_code=200)
async def execute_webhook(
    webhook_id: int,
    token: str,
    body: WebhookExecuteRequest,
) -> dict:
    # Validate webhook + token via gRPC (GetWebhook, then verify token manually)
    stub = await get_webhook_stub()
    try:
        wh = await stub.GetWebhook(pb2.GetWebhookRequest(webhook_id=webhook_id))
    except grpc.RpcError:
        raise HTTPException(status_code=404, detail={"code": 10015, "message": "Unknown Webhook"})

    if wh.token != token:
        raise HTTPException(status_code=404, detail={"code": 10015, "message": "Unknown Webhook"})

    # The gateway protocol requires at least one of: content, embeds, components, files
    has_content = body.content and body.content.strip()
    has_embeds = body.embeds and len(body.embeds) > 0
    has_components = body.components and len(body.components) > 0
    if not has_content and not has_embeds and not has_components:
        raise HTTPException(
            status_code=400,
            detail={"code": 50006, "message": "Cannot send an empty message"},
        )

    # Validate embeds
    if has_embeds:
        assert body.embeds is not None  # for type narrowing
        _validate_embeds(body.embeds)

    if not wh.user_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50006, "message": "Webhook creator no longer exists"},
        )

    # Convert embeds to proto format
    proto_embeds = []
    if has_embeds:
        assert body.embeds is not None
        proto_embeds = [_embed_request_to_proto(e) for e in body.embeds]

    # Create message via MessageService
    from app.grpc_client import get_message_stub
    msg_stub = await get_message_stub()
    try:
        msg_proto = await msg_stub.CreateMessage(pb2.CreateMessageRequest(
            channel_id=wh.channel_id,
            author_id=wh.user_id,
            content=(body.content or "").strip(),
            tts=body.tts,
            guild_id=wh.guild_id,
            embeds=proto_embeds,
        ))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    author_name = body.username or wh.name
    author_avatar = wh.avatar if wh.HasField("avatar") else None

    # Build embeds from proto response
    response_embeds = [_proto_embed_to_dict(e) for e in (msg_proto.embeds or [])]

    msg = MessageResponse(
        id=str(msg_proto.id),
        channel_id=str(msg_proto.channel_id),
        guild_id=str(wh.guild_id),
        author=MessageAuthor(
            id=str(wh.id),
            username=author_name,
            avatar=author_avatar,
        ),
        content=msg_proto.content,
        timestamp=msg_proto.timestamp,
        tts=msg_proto.tts,
        pinned=msg_proto.pinned,
        type=0,
        flags=0,
        embeds=response_embeds,
    )

    redis = await get_redis()
    event = {"t": "MESSAGE_CREATE", "d": msg.model_dump()}
    await redis.publish(f"guild:{wh.guild_id}", json.dumps(event))

    return msg.model_dump()
