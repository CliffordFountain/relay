import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import grpc
import boto3
from botocore.config import Config as BotoConfig
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
# request.form() yields starlette UploadFile instances. In fastapi 0.139 / starlette 1.3,
# fastapi.UploadFile is a *subclass* of starlette.UploadFile, so `isinstance(value,
# fastapi.UploadFile)` is False for form values — which silently drops every attachment.
# Match against the starlette base class so both types are accepted.
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.config import settings
from app.models.message import (
    AttachmentResponse,
    BulkDeleteRequest,
    MessageCreateRequest,
    MessageUpdateRequest,
    MessageAuthor,
    MessageResponse,
    Reaction,
    ReactionCountDetails,
    ReactionEmoji,
)
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import (
    get_channel_stub, get_member_stub, get_message_stub,
    get_user_stub, get_reaction_stub, get_read_state_stub,
)
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/channels", tags=["messages"])

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# S3 client (MinIO) -- direct access for attachment uploads
# ---------------------------------------------------------------------------

_s3_client = None


def _get_s3():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=BotoConfig(signature_version="s3v4"),
            region_name="us-east-1",
        )
    return _s3_client


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def get_channel_with_access(channel_id: int, user_id: int):
    """Fetch a channel via gRPC and verify the caller has access."""
    ch_stub = await get_channel_stub()
    try:
        channel = await ch_stub.GetChannel(pb2.GetChannelRequest(channel_id=channel_id))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    if channel.guild_id:
        member_stub = await get_member_stub()
        try:
            resp = await member_stub.IsMember(
                pb2.IsMemberRequest(guild_id=channel.guild_id, user_id=user_id)
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
        # Enforce VIEW_CHANNEL so a private channel (VIEW_CHANNEL denied via overwrite) is
        # inaccessible — reading/writing messages both funnel through here.
        from app.services.permissions import (
            compute_channel_permissions, has_permission, VIEW_CHANNEL,
        )
        perms = await compute_channel_permissions(channel.guild_id, channel_id, user_id)
        if not has_permission(perms, VIEW_CHANNEL):
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )
    elif channel.type in (1, 3):
        try:
            dm_members = await ch_stub.GetDmMembers(
                pb2.GetDmMembersRequest(channel_id=channel_id)
            )
            if user_id not in dm_members.user_ids:
                raise HTTPException(
                    status_code=403,
                    detail={"code": 50001, "message": "Missing Access"},
                )
        except grpc.RpcError:
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )
    return channel


async def _publish_channel_event(redis, channel, event_data: dict) -> None:
    """Publish an event to the correct Redis channel."""
    guild_id = channel.guild_id
    if guild_id:
        await redis.publish(f"guild:{guild_id}", json.dumps(event_data))
    else:
        # DM channel -- publish to each participant
        ch_stub = await get_channel_stub()
        try:
            dm_members = await ch_stub.GetDmMembers(
                pb2.GetDmMembersRequest(channel_id=channel.id)
            )
            for dm_user_id in dm_members.user_ids:
                await redis.publish(f"user:{dm_user_id}", json.dumps(event_data))
        except grpc.RpcError:
            pass


def _build_message_response_from_proto(
    msg, *, guild_id: int | None = None, current_user_id: int | None = None
) -> MessageResponse:
    """Turn a gRPC Message into a MessageResponse."""
    author = MessageAuthor(
        id=str(msg.author_id),
        username="",  # Will be enriched if user data available
        global_name=None,
        avatar=None,
    )

    # Build attachments
    attachments = [
        AttachmentResponse(
            id=str(a.id),
            filename=a.filename,
            size=a.size,
            url=a.url,
            proxy_url=a.proxy_url,
            content_type=a.content_type,
            width=a.width if a.width else None,
            height=a.height if a.height else None,
        )
        for a in (msg.attachments or [])
    ]

    # Build reactions
    reactions = [
        Reaction(
            emoji=ReactionEmoji(
                name=r.emoji.name,
                id=str(r.emoji.id) if r.emoji.id else None,
            ),
            count=r.count,
            me=r.me,
            burst_colors=[],
            count_details=ReactionCountDetails(burst=0, normal=r.count),
            me_burst=False,
        )
        for r in (msg.reactions or [])
    ]

    # Parse message_reference
    # Use HasField because bool(msg.message_reference) is True even when unset
    # (protobuf returns a default-initialized empty MessageReference object).
    msg_ref = None
    if msg.HasField("message_reference"):
        msg_ref = {
            "message_id": str(msg.message_reference.message_id),
            "channel_id": str(msg.message_reference.channel_id),
        }
        if msg.message_reference.guild_id:
            msg_ref["guild_id"] = str(msg.message_reference.guild_id)

    # Build referenced message
    # Check both that the field is present AND that id != 0 (default/unset).
    # A plain `if msg.referenced_message:` is truthy for empty proto Message objects,
    # so we explicitly check the id to distinguish a real referenced message from a
    # default-initialized empty proto message.
    referenced_message = None
    if msg.referenced_message and msg.referenced_message.id:
        ref = msg.referenced_message
        referenced_message = MessageResponse(
            id=str(ref.id),
            channel_id=str(ref.channel_id),
            guild_id=str(guild_id) if guild_id else None,
            author=MessageAuthor(
                id=str(ref.author_id),
                username="",
                global_name=None,
                avatar=None,
            ),
            content=ref.content or "",
            timestamp=ref.timestamp or "",
            edited_timestamp=ref.edited_timestamp or None,
            tts=ref.tts,
            mention_everyone=ref.mention_everyone,
            pinned=ref.pinned,
            type=ref.type,
            flags=ref.flags,
            attachments=[
                AttachmentResponse(
                    id=str(a.id), filename=a.filename, size=a.size,
                    url=a.url, proxy_url=a.proxy_url, content_type=a.content_type,
                    width=a.width if a.width else None,
                    height=a.height if a.height else None,
                )
                for a in (ref.attachments or [])
            ],
            message_reference=None,
        )

    return MessageResponse(
        id=str(msg.id),
        channel_id=str(msg.channel_id),
        guild_id=str(guild_id) if guild_id else (str(msg.guild_id) if msg.guild_id else None),
        author=author,
        content=msg.content or "",
        timestamp=msg.timestamp or "",
        edited_timestamp=msg.edited_timestamp or None,
        tts=msg.tts,
        mention_everyone=msg.mention_everyone,
        pinned=msg.pinned,
        type=msg.type,
        flags=msg.flags,
        message_reference=msg_ref,
        reactions=reactions,
        attachments=attachments,
        referenced_message=referenced_message,
        nonce=msg.nonce,
    )


async def _enrich_message_authors(messages: list[MessageResponse]) -> None:
    """Enrich message author fields by fetching user data via gRPC."""
    user_stub = await get_user_stub()
    author_ids = set()
    for m in messages:
        author_ids.add(int(m.author.id))
        if m.referenced_message:
            author_ids.add(int(m.referenced_message.author.id))

    user_cache: dict[int, object] = {}
    for aid in author_ids:
        try:
            user = await user_stub.GetUser(pb2.GetUserRequest(user_id=aid))
            user_cache[aid] = user
        except grpc.RpcError:
            pass

    for m in messages:
        uid = int(m.author.id)
        if uid in user_cache:
            u = user_cache[uid]
            m.author.username = u.username
            m.author.global_name = getattr(u, 'display_name', None)
            m.author.avatar = u.avatar
        if m.referenced_message:
            ref_uid = int(m.referenced_message.author.id)
            if ref_uid in user_cache:
                u = user_cache[ref_uid]
                m.referenced_message.author.username = u.username
                m.referenced_message.author.global_name = getattr(u, 'display_name', None)
                m.referenced_message.author.avatar = u.avatar


# Max size for a single uploaded attachment.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MiB

# Content types a browser may render INLINE without executing script. Anything else
# (notably text/html and image/svg+xml, which can run JS on our origin) is stored and
# served as an opaque download, never as the attacker-declared type.
_INLINE_SAFE_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
    "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav", "application/pdf",
}


def _sniff_content_type(b: bytes) -> str | None:
    """Best-effort MIME detection from the leading bytes (magic numbers)."""
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    if b[:4] == b"RIFF" and b[8:12] == b"WAVE":
        return "audio/wav"
    if b[:5] == b"%PDF-":
        return "application/pdf"
    if b[:4] == b"OggS":
        return "audio/ogg"
    if b[:3] == b"ID3" or b[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if b[:4] == b"\x1aE\xdf\xa3":
        return "video/webm"
    if b[4:8] == b"ftyp":
        return "image/avif" if b[8:10] == b"av" else "video/mp4"
    return None


def _sanitize_filename(name: str) -> str:
    """Strip path separators and header-unsafe characters from a client filename."""
    name = name.replace("\\", "/").split("/")[-1]  # basename only (no traversal)
    name = "".join(c for c in name if c.isprintable() and c not in '"\r\n')
    name = name.strip().lstrip(".") or "file"
    return name[:255]


async def _upload_file_to_s3(
    file: UploadFile,
    channel_id: int,
    message_id: int,
) -> dict:
    """Upload a file to S3/MinIO and return metadata dict."""
    if file.size is not None and file.size > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail={"code": 40005, "message": f"File too large (max {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MiB)"})
    file_bytes = await file.read()
    file_size = len(file_bytes)
    if file_size > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail={"code": 40005, "message": f"File too large (max {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MiB)"})
    original_filename = _sanitize_filename(file.filename or "unknown")

    # NEVER trust the client-declared content type — it is served back from our own origin,
    # so a declared text/html or image/svg+xml would run script and steal the session token.
    # Sniff the real type; render inline only for a known-safe allowlist, else force an
    # opaque, attachment-disposition download.
    sniffed = _sniff_content_type(file_bytes)
    if sniffed in _INLINE_SAFE_TYPES:
        content_type = sniffed
        content_disposition = None
    else:
        content_type = "application/octet-stream"
        content_disposition = f'attachment; filename="{original_filename}"'

    unique_id = uuid.uuid4().hex[:12]
    s3_key = f"{channel_id}/{message_id}/{unique_id}/{original_filename}"

    s3 = _get_s3()
    put_kwargs = dict(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        Body=file_bytes,
        ContentType=content_type,
    )
    if content_disposition:
        put_kwargs["ContentDisposition"] = content_disposition
    s3.put_object(**put_kwargs)

    url = f"{settings.s3_public_url}/{settings.s3_bucket}/{s3_key}"

    width = None
    height = None
    if content_type.startswith("image/"):
        try:
            import io
            from struct import unpack

            data = io.BytesIO(file_bytes)
            if content_type in ("image/png", "image/apng"):
                data.seek(16)
                width, height = unpack(">II", data.read(8))
            elif content_type in ("image/jpeg", "image/jpg"):
                data.seek(0)
                data.read(2)
                while True:
                    marker = data.read(2)
                    if len(marker) < 2:
                        break
                    if marker[0] != 0xFF:
                        break
                    if marker[1] in (0xC0, 0xC2):
                        data.read(3)
                        h_bytes = data.read(2)
                        w_bytes = data.read(2)
                        if len(h_bytes) == 2 and len(w_bytes) == 2:
                            height = unpack(">H", h_bytes)[0]
                            width = unpack(">H", w_bytes)[0]
                        break
                    else:
                        length_bytes = data.read(2)
                        if len(length_bytes) < 2:
                            break
                        length = unpack(">H", length_bytes)[0]
                        data.seek(length - 2, 1)
            elif content_type == "image/gif":
                data.seek(6)
                width, height = unpack("<HH", data.read(4))
            elif content_type == "image/webp":
                data.seek(0)
                riff = data.read(4)
                if riff == b"RIFF":
                    data.read(4)
                    webp = data.read(4)
                    if webp == b"WEBP":
                        chunk_type = data.read(4)
                        if chunk_type == b"VP8 ":
                            data.read(4)
                            data.read(3)
                            sync = data.read(3)
                            if sync == b"\x9d\x01\x2a":
                                dim = data.read(4)
                                if len(dim) == 4:
                                    width = unpack("<H", dim[0:2])[0] & 0x3FFF
                                    height = unpack("<H", dim[2:4])[0] & 0x3FFF
        except Exception:
            pass

    return {
        "filename": original_filename,
        "content_type": content_type,
        "size": file_size,
        "url": url,
        "proxy_url": url,
        "width": width,
        "height": height,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/{channel_id}/messages",
    response_model=list[MessageResponse],
)
async def get_messages(
    channel_id: int,
    before: Optional[int] = Query(None),
    after: Optional[int] = Query(None),
    around: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    msg_stub = await get_message_stub()
    try:
        resp = await msg_stub.GetMessages(
            pb2.GetMessagesRequest(
                channel_id=channel_id,
                before=before,
                after=after,
                around=around,
                limit=limit,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    messages = [
        _build_message_response_from_proto(m, guild_id=guild_id, current_user_id=int(user_id))
        for m in resp.messages
    ]
    await _enrich_message_authors(messages)
    return messages


@router.post(
    "/{channel_id}/messages",
    status_code=201,
    response_model=MessageResponse,
)
async def create_message(
    channel_id: int,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    # For guild channels, check the appropriate send permission.
    # Threads (types 10, 11, 12) require SEND_MESSAGES_IN_THREADS;
    # regular channels require SEND_MESSAGES.
    if guild_id:
        from app.services.permissions import (
            require_permission, has_permission,
            SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, MANAGE_MESSAGES,
        )
        is_thread = channel.type in (10, 11, 12)
        send_perm = SEND_MESSAGES_IN_THREADS if is_thread else SEND_MESSAGES
        perms = await require_permission(
            guild_id, int(user_id), send_perm,
            channel_id=channel_id,
            error_code=50013,
            error_message="Missing Permissions",
        )
        # Enforce timeouts: a member whose communication_disabled_until is in the future
        # cannot send messages (setting the timeout was previously cosmetic).
        member_stub = await get_member_stub()
        try:
            m = await member_stub.GetMember(
                pb2.GetMemberRequest(guild_id=guild_id, user_id=int(user_id))
            )
            cdu = m.communication_disabled_until
        except grpc.RpcError:
            cdu = None
        if cdu:
            try:
                until = datetime.fromisoformat(cdu.replace("Z", "+00:00"))
            except ValueError:
                until = None
            if until is not None and until > datetime.now(timezone.utc):
                raise HTTPException(
                    status_code=403,
                    detail={"code": 50013, "message": "You are timed out and cannot send messages in this server"},
                )

        # Slowmode: members without MANAGE_MESSAGES may send at most one message per
        # rate_limit_per_user seconds (tracked with a short-lived Redis key).
        rate = getattr(channel, "rate_limit_per_user", 0) or 0
        if rate > 0 and not has_permission(perms, MANAGE_MESSAGES):
            redis = await get_redis()
            sm_key = f"slowmode:{channel_id}:{user_id}"
            if await redis.get(sm_key):
                raise HTTPException(
                    status_code=429,
                    detail={"code": 20016, "message": "You are sending messages too quickly (slowmode)"},
                )
            await redis.set(sm_key, "1", ex=rate)

    content_type_header = request.headers.get("content-type", "")
    files: list[UploadFile] = []
    body: MessageCreateRequest

    if "multipart/form-data" in content_type_header:
        form = await request.form()
        content_value = form.get("content", "")
        content_str = content_value if isinstance(content_value, str) else ""

        nonce_value = form.get("nonce")
        nonce_str = str(nonce_value) if nonce_value else None

        tts_value = form.get("tts", "false")
        tts_bool = str(tts_value).lower() in ("true", "1", "yes")

        msg_ref_value = form.get("message_reference")
        msg_ref = None
        if msg_ref_value:
            try:
                msg_ref = json.loads(str(msg_ref_value))
            except (json.JSONDecodeError, TypeError):
                pass

        body = MessageCreateRequest(
            content=content_str,
            tts=tts_bool,
            nonce=nonce_str,
            message_reference=msg_ref,
        )

        for key in form:
            value = form[key]
            if isinstance(value, (UploadFile, StarletteUploadFile)):
                files.append(value)
    else:
        raw_body = await request.body()
        body = MessageCreateRequest.model_validate_json(raw_body)

    if not body.content.strip() and len(files) == 0:
        raise HTTPException(
            status_code=400,
            detail={"code": 50006, "message": "Cannot send an empty message"},
        )

    # Automod: block messages matching an enabled keyword rule (owner/admins are gated the
    # same as anyone — automod applies to all non-exempt members).
    if guild_id and body.content:
        from app.routers.automod import enforce_automod
        await enforce_automod(guild_id, channel_id, body.content)

    # Determine mention_everyone
    mention_everyone = "@everyone" in body.content or "@here" in body.content
    if body.allowed_mentions:
        if "everyone" not in body.allowed_mentions.parse:
            mention_everyone = False

    # Build message_reference for gRPC
    grpc_msg_ref = None
    if body.message_reference:
        ref_id = body.message_reference.get("message_id")
        if ref_id:
            grpc_msg_ref = pb2.MessageReference(
                message_id=int(ref_id),
                channel_id=channel_id,
                guild_id=guild_id if guild_id else None,
            )

    msg_flags = body.flags if body.flags else 0
    msg_type = 0
    if body.message_reference:
        ref_type = body.message_reference.get("type", 0)
        if ref_type == 1:
            msg_type = 0
        else:
            msg_type = 19

    # Upload files first to get attachment info
    attachment_inputs = []
    if files:
        # We need a temporary message ID for S3 paths; use 0 and rename later
        for file in files:
            file_meta = await _upload_file_to_s3(file, channel_id, 0)
            attachment_inputs.append(pb2.AttachmentInput(
                filename=file_meta["filename"],
                content_type=file_meta["content_type"],
                size=file_meta["size"],
                url=file_meta["url"],
                width=file_meta["width"],
                height=file_meta["height"],
            ))

    msg_stub = await get_message_stub()
    try:
        msg = await msg_stub.CreateMessage(
            pb2.CreateMessageRequest(
                channel_id=channel_id,
                author_id=int(user_id),
                content=body.content,
                type=msg_type,
                flags=msg_flags,
                tts=body.tts,
                message_reference=grpc_msg_ref,
                mention_everyone=mention_everyone,
                attachments=attachment_inputs,
                nonce=body.nonce,
                guild_id=guild_id if guild_id else None,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    result = _build_message_response_from_proto(msg, guild_id=guild_id, current_user_id=int(user_id))

    # If this is a reply, fetch the referenced message and embed it in the response.
    # The create_message gRPC call doesn't return the referenced message body, so we
    # fetch it explicitly here so the client receives the full reply preview inline.
    if grpc_msg_ref and grpc_msg_ref.message_id:
        try:
            ref_msg_proto = await msg_stub.GetMessage(
                pb2.GetMessageRequest(
                    message_id=grpc_msg_ref.message_id,
                    channel_id=channel_id,
                )
            )
            result.referenced_message = _build_message_response_from_proto(
                ref_msg_proto, guild_id=guild_id, current_user_id=int(user_id)
            )
        except grpc.RpcError:
            pass  # Best-effort; client will fall back to just message_reference

    await _enrich_message_authors([result])

    if body.nonce:
        result.nonce = body.nonce

    # Index message in Elasticsearch (fire and forget)
    from app.routers.search import index_message
    asyncio.create_task(
        index_message(
            message_id=msg.id,
            channel_id=channel_id,
            guild_id=guild_id,
            author_id=int(user_id),
            content=body.content,
        )
    )

    # Publish MESSAGE_CREATE event
    r = await get_redis()
    event_data = result.model_dump()

    # Add member object for guild messages
    if guild_id:
        member_stub = await get_member_stub()
        try:
            member = await member_stub.GetMember(
                pb2.GetMemberRequest(guild_id=guild_id, user_id=int(user_id))
            )
            # The partial member object in MESSAGE_CREATE includes a user sub-object
            author = event_data.get("author", {})
            event_data["member"] = {
                "user": {
                    "id": author.get("id"),
                    "username": author.get("username"),
                    "discriminator": author.get("discriminator", "0"),
                    "global_name": author.get("global_name"),
                    "avatar": author.get("avatar"),
                },
                "roles": [str(rid) for rid in (member.roles or [])],
                "nick": member.nick,
                "joined_at": member.joined_at,
                "deaf": member.deaf,
                "mute": member.mute,
                "flags": 0,
            }
        except grpc.RpcError:
            pass

    event = {"t": "MESSAGE_CREATE", "d": event_data}
    await _publish_channel_event(r, channel, event)

    return result


@router.get(
    "/{channel_id}/messages/{message_id}",
    response_model=MessageResponse,
)
async def get_message(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))

    msg_stub = await get_message_stub()
    try:
        msg = await msg_stub.GetMessage(
            pb2.GetMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    result = _build_message_response_from_proto(
        msg, guild_id=channel.guild_id, current_user_id=int(user_id)
    )
    await _enrich_message_authors([result])
    return result


@router.patch(
    "/{channel_id}/messages/{message_id}",
    response_model=MessageResponse,
)
async def edit_message(
    channel_id: int,
    message_id: int,
    body: MessageUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    # Get existing message to check authorship
    msg_stub = await get_message_stub()
    try:
        existing = await msg_stub.GetMessage(
            pb2.GetMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    if existing.author_id != int(user_id):
        raise HTTPException(
            status_code=403,
            detail={"code": 50005, "message": "Cannot edit a message authored by another user"},
        )

    try:
        updated = await msg_stub.UpdateMessage(
            pb2.UpdateMessageRequest(
                channel_id=channel_id,
                message_id=message_id,
                content=body.content,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    result = _build_message_response_from_proto(
        updated, guild_id=guild_id, current_user_id=int(user_id)
    )
    await _enrich_message_authors([result])

    # Publish MESSAGE_UPDATE event
    r = await get_redis()
    event = {"t": "MESSAGE_UPDATE", "d": result.model_dump()}
    await _publish_channel_event(r, channel, event)

    return result


@router.delete(
    "/{channel_id}/messages/{message_id}",
    status_code=204,
)
async def delete_message(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    msg_stub = await get_message_stub()
    try:
        existing = await msg_stub.GetMessage(
            pb2.GetMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Must be author OR have MANAGE_MESSAGES permission
    is_author = existing.author_id == int(user_id)
    has_manage = False
    if guild_id and not is_author:
        from app.services.permissions import compute_channel_permissions, has_permission, MANAGE_MESSAGES
        perms = await compute_channel_permissions(guild_id, channel_id, int(user_id))
        has_manage = has_permission(perms, MANAGE_MESSAGES)

    if not is_author and not has_manage:
        raise HTTPException(
            status_code=403,
            detail={"code": 50003, "message": "Missing Permissions"},
        )

    try:
        await msg_stub.DeleteMessage(
            pb2.DeleteMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Remove from Elasticsearch index (fire and forget)
    from app.routers.search import delete_message_index
    asyncio.create_task(delete_message_index(message_id))

    # Publish MESSAGE_DELETE event
    r = await get_redis()
    event = {
        "t": "MESSAGE_DELETE",
        "d": {
            "id": str(message_id),
            "channel_id": str(channel_id),
            "guild_id": str(guild_id) if guild_id else None,
        },
    }
    await _publish_channel_event(r, channel, event)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Bulk Delete
# ---------------------------------------------------------------------------


@router.post(
    "/{channel_id}/messages/bulk-delete",
    status_code=204,
)
async def bulk_delete_messages(
    channel_id: int,
    body: BulkDeleteRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Delete multiple messages at once. Requires MANAGE_MESSAGES permission."""
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    if not guild_id:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Bulk delete is only available in guild channels"},
        )

    from app.services.permissions import require_permission, MANAGE_MESSAGES
    await require_permission(
        guild_id, int(user_id), MANAGE_MESSAGES,
        channel_id=channel_id,
    )

    message_ids = [int(mid) for mid in body.messages]

    msg_stub = await get_message_stub()
    try:
        await msg_stub.BulkDeleteMessages(
            pb2.BulkDeleteMessagesRequest(channel_id=channel_id, message_ids=message_ids)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Remove from Elasticsearch (fire and forget)
    from app.routers.search import delete_message_index
    for mid in message_ids:
        asyncio.create_task(delete_message_index(mid))

    # Publish MESSAGE_DELETE_BULK event
    r = await get_redis()
    event = {
        "t": "MESSAGE_DELETE_BULK",
        "d": {
            "ids": [str(mid) for mid in message_ids],
            "channel_id": str(channel_id),
            "guild_id": str(guild_id) if guild_id else None,
        },
    }
    await _publish_channel_event(r, channel, event)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Pins
# ---------------------------------------------------------------------------


@router.get(
    "/{channel_id}/pins",
    response_model=list[MessageResponse],
)
async def get_pinned_messages(
    channel_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    msg_stub = await get_message_stub()
    try:
        resp = await msg_stub.GetPinnedMessages(
            pb2.GetPinnedMessagesRequest(channel_id=channel_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    messages = [
        _build_message_response_from_proto(m, guild_id=guild_id, current_user_id=int(user_id))
        for m in resp.messages
    ]
    await _enrich_message_authors(messages)
    return messages


@router.put(
    "/{channel_id}/pins/{message_id}",
    status_code=204,
)
async def pin_message(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    if guild_id:
        from app.services.permissions import require_permission, MANAGE_MESSAGES
        await require_permission(
            guild_id, int(user_id), MANAGE_MESSAGES,
            channel_id=channel_id,
        )

    msg_stub = await get_message_stub()
    try:
        await msg_stub.PinMessage(
            pb2.PinMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    # Publish CHANNEL_PINS_UPDATE event
    r = await get_redis()
    event = {
        "t": "CHANNEL_PINS_UPDATE",
        "d": {
            "guild_id": str(guild_id) if guild_id else None,
            "channel_id": str(channel_id),
            "last_pin_timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }
    await _publish_channel_event(r, channel, event)

    return Response(status_code=204)


@router.delete(
    "/{channel_id}/pins/{message_id}",
    status_code=204,
)
async def unpin_message(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    if guild_id:
        from app.services.permissions import require_permission, MANAGE_MESSAGES
        await require_permission(
            guild_id, int(user_id), MANAGE_MESSAGES,
            channel_id=channel_id,
        )

    msg_stub = await get_message_stub()
    try:
        await msg_stub.UnpinMessage(
            pb2.UnpinMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    r = await get_redis()
    event = {
        "t": "CHANNEL_PINS_UPDATE",
        "d": {
            "guild_id": str(guild_id) if guild_id else None,
            "channel_id": str(channel_id),
            "last_pin_timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }
    await _publish_channel_event(r, channel, event)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Crosspost
# ---------------------------------------------------------------------------


async def _deliver_crosspost_to_follower(
    follower,
    *,
    source_channel_id: int,
    source_guild_id: Optional[int],
    message_id: int,
    updated,
    author_id: int,
    current_user_id: int,
) -> None:
    """Deliver one crossposted message to a single follower's target channel.

    Raises on failure -- callers must catch and log so one bad follower does
    not affect delivery to the others or the crosspost response itself.
    """
    target_channel_id = follower.target_channel_id

    ch_stub = await get_channel_stub()
    target_channel = await ch_stub.GetChannel(
        pb2.GetChannelRequest(channel_id=target_channel_id)
    )

    attachment_inputs = [
        pb2.AttachmentInput(
            filename=a.filename,
            content_type=a.content_type,
            size=a.size,
            url=a.url,
            width=a.width if a.width else None,
            height=a.height if a.height else None,
        )
        for a in (updated.attachments or [])
    ]

    msg_stub = await get_message_stub()
    new_msg = await msg_stub.CreateMessage(
        pb2.CreateMessageRequest(
            channel_id=target_channel_id,
            author_id=author_id,
            content=updated.content,
            type=0,
            flags=2,  # IS_CROSSPOST -- this copy originated from a followed channel
            attachments=attachment_inputs,
            message_reference=pb2.MessageReference(
                message_id=message_id,
                channel_id=source_channel_id,
                guild_id=source_guild_id if source_guild_id else None,
            ),
            guild_id=target_channel.guild_id if target_channel.guild_id else None,
        )
    )

    result = _build_message_response_from_proto(
        new_msg, guild_id=target_channel.guild_id, current_user_id=current_user_id
    )
    await _enrich_message_authors([result])

    r = await get_redis()
    event = {"t": "MESSAGE_CREATE", "d": result.model_dump()}
    await _publish_channel_event(r, target_channel, event)


@router.post(
    "/{channel_id}/messages/{message_id}/crosspost",
    response_model=MessageResponse,
)
async def crosspost_message(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    """Crosspost a message in an announcement channel to following channels."""
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    if channel.type != 5:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "This can only be used on announcement channels"},
        )

    msg_stub = await get_message_stub()
    try:
        existing = await msg_stub.GetMessage(
            pb2.GetMessageRequest(channel_id=channel_id, message_id=message_id)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    is_author = existing.author_id == int(user_id)
    has_manage = False
    if guild_id and not is_author:
        from app.services.permissions import compute_channel_permissions, has_permission, MANAGE_MESSAGES
        perms = await compute_channel_permissions(guild_id, channel_id, int(user_id))
        has_manage = has_permission(perms, MANAGE_MESSAGES)

    if not is_author and not has_manage:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Missing Permissions"},
        )

    # Set CROSSPOSTED flag
    new_flags = existing.flags | 1
    try:
        updated = await msg_stub.UpdateMessage(
            pb2.UpdateMessageRequest(
                channel_id=channel_id,
                message_id=message_id,
                flags=new_flags,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    result = _build_message_response_from_proto(
        updated, guild_id=guild_id, current_user_id=int(user_id)
    )
    await _enrich_message_authors([result])

    r = await get_redis()
    event = {"t": "MESSAGE_UPDATE", "d": result.model_dump()}
    await _publish_channel_event(r, channel, event)

    # Fan out to channels following this announcement channel. A follower is
    # only present once ChannelService.FollowChannel has been called for it
    # (see threads.py's follow_announcement_channel), so an empty list here
    # just means "no one follows this channel" and we behave exactly as
    # before. Delivery failures for individual followers are logged and
    # skipped -- they must never fail the crosspost response.
    try:
        ch_stub = await get_channel_stub()
        followers_resp = await ch_stub.GetChannelFollowers(
            pb2.GetChannelFollowersRequest(source_channel_id=channel_id)
        )
        followers = list(followers_resp.followers) if followers_resp.followers else []
    except grpc.RpcError:
        logger.exception(
            "Failed to fetch followers for channel %s during crosspost of message %s",
            channel_id, message_id,
        )
        followers = []

    for follower in followers:
        try:
            await _deliver_crosspost_to_follower(
                follower,
                source_channel_id=channel_id,
                source_guild_id=guild_id,
                message_id=message_id,
                updated=updated,
                author_id=existing.author_id,
                current_user_id=int(user_id),
            )
        except grpc.RpcError:
            logger.exception(
                "Crosspost fan-out failed delivering message %s to follower target channel %s",
                message_id, follower.target_channel_id,
            )
        except Exception:
            logger.exception(
                "Unexpected error during crosspost fan-out of message %s to follower target channel %s",
                message_id, follower.target_channel_id,
            )

    return result


# ---------------------------------------------------------------------------
# Typing / Ack
# ---------------------------------------------------------------------------


@router.post(
    "/{channel_id}/messages/{message_id}/ack",
    status_code=204,
)
async def ack_message(
    channel_id: int,
    message_id: int,
    user_id: str = Depends(get_current_user_id),
):
    """Mark a message as the last read message for the user in this channel."""
    await get_channel_with_access(channel_id, int(user_id))

    rs_stub = await get_read_state_stub()
    try:
        await rs_stub.AckMessage(
            pb2.AckMessageRequest(
                user_id=int(user_id),
                channel_id=channel_id,
                message_id=message_id,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="message")

    return Response(status_code=204)


@router.post(
    "/{channel_id}/typing",
    status_code=204,
)
async def trigger_typing(
    channel_id: int,
    user_id: str = Depends(get_current_user_id),
):
    channel = await get_channel_with_access(channel_id, int(user_id))
    guild_id = channel.guild_id

    r = await get_redis()
    event_data: dict = {
        "channel_id": str(channel_id),
        "guild_id": str(guild_id) if guild_id else None,
        "user_id": user_id,
        "timestamp": int(datetime.now(timezone.utc).timestamp()),
    }

    # Add member info for guild channels
    if guild_id:
        try:
            member_stub = await get_member_stub()
            member = await member_stub.GetMember(
                pb2.GetMemberRequest(guild_id=guild_id, user_id=int(user_id))
            )
            user_stub = await get_user_stub()
            user_info = await user_stub.GetUser(pb2.GetUserRequest(user_id=int(user_id)))
            event_data["member"] = {
                "user": {
                    "id": user_id,
                    "username": user_info.username,
                    "avatar": user_info.avatar if user_info.avatar else None,
                    "discriminator": "0",
                    "global_name": user_info.display_name if user_info.HasField("display_name") else None,
                },
                "roles": [str(r_id) for r_id in member.role_ids] if member.role_ids else [],
                "nick": member.nick if member.nick else None,
                "joined_at": member.joined_at if member.joined_at else None,
                "deaf": False,
                "mute": False,
            }
        except grpc.RpcError:
            pass  # Omit member field on gRPC failure

    event = {"t": "TYPING_START", "d": event_data}
    await _publish_channel_event(r, channel, event)

    return Response(status_code=204)
