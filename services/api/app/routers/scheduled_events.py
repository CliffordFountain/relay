"""Guild scheduled events."""
import json
from datetime import datetime
from typing import Optional

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_guild_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import require_permission, MANAGE_EVENTS
from app.routers.guilds import require_member

router = APIRouter(prefix="/api/v10/guilds", tags=["scheduled-events"])


class ScheduledEventCreate(BaseModel):
    name: str
    description: Optional[str] = None
    scheduled_start_time: str
    scheduled_end_time: Optional[str] = None
    entity_type: int = 3  # 1=stage, 2=voice, 3=external
    channel_id: Optional[str] = None
    entity_metadata: Optional[dict] = None
    privacy_level: int = 2


class ScheduledEventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    scheduled_start_time: Optional[str] = None
    scheduled_end_time: Optional[str] = None
    entity_type: Optional[int] = None
    status: Optional[int] = None  # 1=scheduled, 2=active, 3=completed, 4=canceled


class ScheduledEventResponse(BaseModel):
    id: str
    guild_id: str
    channel_id: Optional[str] = None
    creator_id: str
    name: str
    description: Optional[str] = None
    scheduled_start_time: str
    scheduled_end_time: Optional[str] = None
    entity_type: int
    entity_metadata: dict = {}
    status: int
    privacy_level: int
    interested_count: int = 0


def _to_response(e) -> ScheduledEventResponse:
    try:
        meta = json.loads(e.entity_metadata) if e.entity_metadata else {}
    except (json.JSONDecodeError, ValueError):
        meta = {}
    return ScheduledEventResponse(
        id=str(e.id),
        guild_id=str(e.guild_id),
        channel_id=str(e.channel_id) if e.HasField("channel_id") else None,
        creator_id=str(e.creator_id),
        name=e.name,
        description=e.description if e.HasField("description") else None,
        scheduled_start_time=e.scheduled_start_time,
        scheduled_end_time=e.scheduled_end_time if e.HasField("scheduled_end_time") else None,
        entity_type=e.entity_type,
        entity_metadata=meta,
        status=e.status,
        privacy_level=e.privacy_level,
        interested_count=getattr(e, "interested_count", 0),
    )


def _validate_iso(value: str, field: str) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail={"code": 50035, "message": f"Invalid {field}"})


@router.get("/{guild_id}/scheduled-events")
async def list_scheduled_events(guild_id: str, user_id: str = Depends(get_current_user_id)):
    gid = int(guild_id)
    uid = int(user_id)
    await require_member(gid, uid)
    stub = await get_guild_stub()
    try:
        resp = await stub.GetScheduledEvents(pb2.GetScheduledEventsRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")
    return [_to_response(e).model_dump() for e in resp.events]


@router.post("/{guild_id}/scheduled-events", status_code=201)
async def create_scheduled_event(
    guild_id: str,
    body: ScheduledEventCreate,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_permission(gid, uid, MANAGE_EVENTS)
    _validate_iso(body.scheduled_start_time, "scheduled_start_time")
    if body.scheduled_end_time:
        _validate_iso(body.scheduled_end_time, "scheduled_end_time")

    kwargs = dict(
        guild_id=gid,
        creator_id=uid,
        name=body.name,
        scheduled_start_time=body.scheduled_start_time,
        entity_type=body.entity_type,
        privacy_level=body.privacy_level,
        entity_metadata=json.dumps(body.entity_metadata or {}),
    )
    if body.description is not None:
        kwargs["description"] = body.description
    if body.scheduled_end_time is not None:
        kwargs["scheduled_end_time"] = body.scheduled_end_time
    if body.channel_id is not None:
        kwargs["channel_id"] = int(body.channel_id)

    stub = await get_guild_stub()
    try:
        event = await stub.CreateScheduledEvent(pb2.CreateScheduledEventRequest(**kwargs))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="guild")

    result = _to_response(event)
    redis = await get_redis()
    await redis.publish(
        f"guild:{gid}",
        json.dumps({"t": "GUILD_SCHEDULED_EVENT_CREATE", "d": result.model_dump()}),
    )
    return result.model_dump()


@router.get("/{guild_id}/scheduled-events/{event_id}")
async def get_scheduled_event(
    guild_id: str, event_id: str, user_id: str = Depends(get_current_user_id)
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_member(gid, uid)
    stub = await get_guild_stub()
    try:
        event = await stub.GetScheduledEvent(
            pb2.GetScheduledEventRequest(event_id=int(event_id), guild_id=gid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="event")
    return _to_response(event).model_dump()


@router.patch("/{guild_id}/scheduled-events/{event_id}")
async def update_scheduled_event(
    guild_id: str,
    event_id: str,
    body: ScheduledEventUpdate,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_permission(gid, uid, MANAGE_EVENTS)
    if body.scheduled_start_time:
        _validate_iso(body.scheduled_start_time, "scheduled_start_time")
    if body.scheduled_end_time:
        _validate_iso(body.scheduled_end_time, "scheduled_end_time")

    kwargs = dict(guild_id=gid, event_id=int(event_id))
    for field in ("name", "description", "scheduled_start_time", "scheduled_end_time"):
        val = getattr(body, field)
        if val is not None:
            kwargs[field] = val
    if body.entity_type is not None:
        kwargs["entity_type"] = body.entity_type
    if body.status is not None:
        kwargs["status"] = body.status

    stub = await get_guild_stub()
    try:
        event = await stub.UpdateScheduledEvent(pb2.UpdateScheduledEventRequest(**kwargs))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="event")

    result = _to_response(event)
    redis = await get_redis()
    await redis.publish(
        f"guild:{gid}",
        json.dumps({"t": "GUILD_SCHEDULED_EVENT_UPDATE", "d": result.model_dump()}),
    )
    return result.model_dump()


@router.delete("/{guild_id}/scheduled-events/{event_id}", status_code=204)
async def delete_scheduled_event(
    guild_id: str, event_id: str, user_id: str = Depends(get_current_user_id)
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_permission(gid, uid, MANAGE_EVENTS)
    stub = await get_guild_stub()
    try:
        await stub.DeleteScheduledEvent(
            pb2.DeleteScheduledEventRequest(event_id=int(event_id), guild_id=gid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="event")
    redis = await get_redis()
    await redis.publish(
        f"guild:{gid}",
        json.dumps({"t": "GUILD_SCHEDULED_EVENT_DELETE", "d": {"id": event_id, "guild_id": guild_id}}),
    )
    return Response(status_code=204)


@router.post("/{guild_id}/scheduled-events/{event_id}/users/@me", status_code=204)
async def add_scheduled_event_interest(
    guild_id: str, event_id: str, user_id: str = Depends(get_current_user_id)
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_member(gid, uid)
    stub = await get_guild_stub()
    try:
        await stub.AddScheduledEventInterest(
            pb2.ScheduledEventInterestRequest(event_id=int(event_id), user_id=uid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="event")
    return Response(status_code=204)


@router.delete("/{guild_id}/scheduled-events/{event_id}/users/@me", status_code=204)
async def remove_scheduled_event_interest(
    guild_id: str, event_id: str, user_id: str = Depends(get_current_user_id)
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_member(gid, uid)
    stub = await get_guild_stub()
    try:
        await stub.RemoveScheduledEventInterest(
            pb2.ScheduledEventInterestRequest(event_id=int(event_id), user_id=uid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="event")
    return Response(status_code=204)


@router.get("/{guild_id}/scheduled-events/{event_id}/users")
async def get_scheduled_event_interested(
    guild_id: str, event_id: str, user_id: str = Depends(get_current_user_id)
):
    gid = int(guild_id)
    uid = int(user_id)
    await require_member(gid, uid)
    stub = await get_guild_stub()
    try:
        resp = await stub.GetScheduledEventInterested(
            pb2.GetScheduledEventInterestedRequest(event_id=int(event_id))
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="event")
    return {"user_ids": [str(uid) for uid in resp.user_ids], "count": resp.count}
