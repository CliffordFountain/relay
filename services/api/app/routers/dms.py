import json

import grpc
from fastapi import APIRouter, Depends, HTTPException

from app.models.channel import DMChannelResponse, DMCreateRequest
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_channel_stub, get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/users/@me/channels", tags=["dms"])

MAX_GROUP_DM_RECIPIENTS = 1000


async def _build_dm_response(channel, current_user_id: int) -> dict:
    """Build a DMChannelResponse dict, fetching recipients via gRPC."""
    ch_stub = await get_channel_stub()
    user_stub = await get_user_stub()

    try:
        dm_members = await ch_stub.GetDmMembers(
            pb2.GetDmMembersRequest(channel_id=channel.id)
        )
    except grpc.RpcError:
        dm_members = None

    recipients = []
    if dm_members:
        for uid in dm_members.user_ids:
            if uid != current_user_id:
                try:
                    user = await user_stub.GetUser(pb2.GetUserRequest(user_id=uid))
                    recipients.append({
                        "id": str(user.id),
                        "username": user.username,
                        "avatar": user.avatar,
                        "display_name": getattr(user, 'display_name', None),
                    })
                except grpc.RpcError:
                    recipients.append({"id": str(uid)})

    return DMChannelResponse(
        id=str(channel.id),
        type=channel.type,
        recipients=recipients,
        last_message_id=str(channel.last_message_id) if channel.last_message_id else None,
    ).model_dump()


# ---------- GET /users/@me/channels ----------

@router.get("")
async def list_dm_channels(
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)
    ch_stub = await get_channel_stub()

    try:
        resp = await ch_stub.GetDmChannels(pb2.GetDmChannelsRequest(user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="channel")

    results = []
    for ch in resp.channels:
        results.append(await _build_dm_response(ch, uid))
    return results


# ---------- POST /users/@me/channels ----------

@router.post("", status_code=200)
async def create_dm_channel(
    body: DMCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)
    ch_stub = await get_channel_stub()

    if body.recipient_id and not body.recipients:
        # 1-on-1 DM
        recipient_id = int(body.recipient_id)

        if recipient_id == uid:
            raise HTTPException(
                status_code=400,
                detail={"code": 50007, "message": "Cannot open a DM with yourself"},
            )

        try:
            channel = await ch_stub.GetOrCreateDm(
                pb2.GetOrCreateDmRequest(user_id=uid, target_id=recipient_id)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="channel")

        response = await _build_dm_response(channel, uid)

        # Publish CHANNEL_CREATE event to both users
        redis = await get_redis()
        event = {"t": "CHANNEL_CREATE", "d": response}
        await redis.publish(f"user:{uid}", json.dumps(event))

        recipient_response = await _build_dm_response(channel, recipient_id)
        recipient_event = {"t": "CHANNEL_CREATE", "d": recipient_response}
        await redis.publish(f"user:{recipient_id}", json.dumps(recipient_event))

        return response

    elif body.recipients:
        # Group DM
        recipient_ids = [int(r) for r in body.recipients]
        recipient_ids = [r for r in recipient_ids if r != uid]

        if len(recipient_ids) < 1:
            raise HTTPException(
                status_code=400,
                detail={"code": 50033, "message": "Must include at least one recipient"},
            )

        if len(recipient_ids) > MAX_GROUP_DM_RECIPIENTS - 1:
            raise HTTPException(
                status_code=400,
                detail={"code": 50033, "message": f"Cannot add more than {MAX_GROUP_DM_RECIPIENTS} recipients"},
            )

        try:
            channel = await ch_stub.CreateGroupDm(
                pb2.CreateGroupDmRequest(
                    owner_id=uid,
                    user_ids=recipient_ids,
                    name="",
                )
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="channel")

        response = await _build_dm_response(channel, uid)

        # Publish CHANNEL_CREATE event to all members
        redis = await get_redis()
        all_members = [uid] + recipient_ids
        for member_id in all_members:
            member_response = await _build_dm_response(channel, member_id)
            event = {"t": "CHANNEL_CREATE", "d": member_response}
            await redis.publish(f"user:{member_id}", json.dumps(event))

        return response

    else:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Must provide recipient_id or recipients"},
        )
