import json

import grpc
from fastapi import APIRouter, Depends, HTTPException, Request

from app.middleware.auth import get_current_user_id
from app.grpc_client import get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/users", tags=["settings"])


# ---------------------------------------------------------------------------
# GET /@me/settings
# ---------------------------------------------------------------------------


@router.get("/@me/settings")
async def get_settings(user_id: str = Depends(get_current_user_id)):
    """Return the current user's settings blob."""
    user_stub = await get_user_stub()
    try:
        settings = await user_stub.GetUserSettings(
            pb2.GetUserSettingsRequest(user_id=int(user_id))
        )
    except grpc.RpcError as exc:
        if exc.code() == grpc.StatusCode.NOT_FOUND:
            return {}
        handle_grpc_error(exc, resource="user")

    # Convert proto to dict, filtering out None/default values
    result: dict = {
        # Fields not yet in proto: return sensible defaults
        "developer_mode": False,
        "convert_emoticons": True,
        "friend_source_flags": {"all": True},
        "status": "online",
        "custom_status": None,
    }
    for field in ("locale", "theme", "enable_tts_command", "message_display_compact",
                  "show_current_game", "default_guilds_restricted", "inline_attachment_media",
                  "inline_embed_media", "gif_auto_play", "render_embeds", "render_reactions",
                  "animate_emoji", "enable_tts", "explicit_content_filter"):
        val = getattr(settings, field, None)
        if val is not None:
            result[field] = val
    return result


# ---------------------------------------------------------------------------
# PATCH /@me/settings
# ---------------------------------------------------------------------------


@router.patch("/@me/settings")
async def update_settings(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """Merge partial settings into existing user settings."""
    body = await request.json()

    # Build update request with only provided fields
    update_kwargs: dict = {"user_id": int(user_id)}
    for key in ("locale", "theme", "enable_tts_command", "message_display_compact",
                "inline_attachment_media", "render_embeds", "animate_emoji",
                "explicit_content_filter"):
        if key in body:
            update_kwargs[key] = body[key]

    user_stub = await get_user_stub()
    try:
        updated = await user_stub.UpdateUserSettings(
            pb2.UpdateUserSettingsRequest(**update_kwargs)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    # Build response with default values for fields not in proto
    result: dict = {
        "developer_mode": False,
        "convert_emoticons": True,
        "friend_source_flags": {"all": True},
        "status": "online",
        "custom_status": None,
    }
    for field in ("locale", "theme", "enable_tts_command", "message_display_compact",
                  "show_current_game", "default_guilds_restricted", "inline_attachment_media",
                  "inline_embed_media", "gif_auto_play", "render_embeds", "render_reactions",
                  "animate_emoji", "enable_tts", "explicit_content_filter"):
        val = getattr(updated, field, None)
        if val is not None:
            result[field] = val

    # Merge the incoming body on top for immediate response
    result.update(body)
    return result
