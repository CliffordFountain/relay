import json

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.models.relationship import RelationshipResponse, RelationshipPutRequest, RelationshipCreateRequest
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_relationship_stub, get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10/users/@me/relationships", tags=["relationships"])
mutual_router = APIRouter(prefix="/api/v10/users", tags=["relationships"])


async def _build_relationship_response(rel) -> dict:
    """Build a RelationshipResponse dict from a gRPC Relationship."""
    user_stub = await get_user_stub()
    user_dict: dict = {"id": str(rel.target_id)}
    try:
        target = await user_stub.GetUser(pb2.GetUserRequest(user_id=rel.target_id))
        user_dict = {
            "id": str(target.id),
            "username": target.username,
            "avatar": target.avatar,
            "display_name": getattr(target, 'display_name', None),
        }
    except grpc.RpcError:
        pass

    return RelationshipResponse(
        id=str(rel.id),
        type=rel.type,
        user=user_dict,
    ).model_dump()


async def _publish_relationship_add(rel_stub, redis, user_id: int, target_id: int) -> None:
    """Publish a RELATIONSHIP_ADD event for ``user_id``'s row toward ``target_id``."""
    try:
        rel = await rel_stub.GetRelationship(
            pb2.GetRelationshipRequest(user_id=user_id, target_id=target_id)
        )
        event_data = await _build_relationship_response(rel)
        await redis.publish(f"user:{user_id}", json.dumps({"t": "RELATIONSHIP_ADD", "d": event_data}))
    except grpc.RpcError:
        pass  # best-effort real-time notification


async def _send_friend_request(uid: int, tid: int, rel_stub, redis) -> None:
    """Run the friend-request state machine for ``uid`` -> ``tid``.

    If ``tid`` already has an OUTGOING_REQUEST (4) toward ``uid`` (i.e. they
    already asked to be our friend) this is a mutual acceptance and BOTH rows
    flip to FRIEND (1). Otherwise the sender gets OUTGOING_REQUEST (4) and the
    target gets INCOMING_REQUEST (3). Reciprocal writes are best-effort so a
    transient failure on one side never leaves the caller with a 500 after the
    primary row was written.
    """
    existing_target_rel: int | None = None
    try:
        existing = await rel_stub.GetRelationship(
            pb2.GetRelationshipRequest(user_id=tid, target_id=uid)
        )
        existing_target_rel = existing.type
    except grpc.RpcError:
        pass  # No existing relationship from target to us

    if existing_target_rel == 4:
        # Mutual acceptance -> both become FRIEND (1)
        for (a, b) in [(uid, tid), (tid, uid)]:
            try:
                await rel_stub.UpsertRelationship(
                    pb2.UpsertRelationshipRequest(user_id=a, target_id=b, type=1)
                )
            except grpc.RpcError as exc:
                handle_grpc_error(exc, resource="relationship")
        for (a, b) in [(uid, tid), (tid, uid)]:
            await _publish_relationship_add(rel_stub, redis, a, b)
    else:
        # Normal friend request: sender OUTGOING (4), target INCOMING (3)
        try:
            await rel_stub.UpsertRelationship(
                pb2.UpsertRelationshipRequest(user_id=uid, target_id=tid, type=4)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="relationship")
        try:
            await rel_stub.UpsertRelationship(
                pb2.UpsertRelationshipRequest(user_id=tid, target_id=uid, type=3)
            )
        except grpc.RpcError:
            pass  # Best-effort for the reverse relationship
        for (a, b) in [(uid, tid), (tid, uid)]:
            await _publish_relationship_add(rel_stub, redis, a, b)


# ---------- GET /users/@me/relationships ----------

@router.get("")
async def get_relationships(
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)
    rel_stub = await get_relationship_stub()

    try:
        resp = await rel_stub.GetRelationships(pb2.GetRelationshipsRequest(user_id=uid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="relationship")

    results = []
    for rel in resp.relationships:
        results.append(await _build_relationship_response(rel))
    return results


# ---------- POST /users/@me/relationships ----------

@router.post("", status_code=204)
async def create_relationship(
    body: RelationshipCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Send a friend request by username.

    Resolves the target user via data-services' username lookup, then runs the
    friend-request state machine (creating the outgoing/pending pair, or
    auto-accepting when the target already sent us a request). Self-adds,
    unknown usernames and existing relationships are rejected with sane errors.
    """
    uid = int(user_id)
    username = (body.username or "").strip()

    if not username:
        raise HTTPException(
            status_code=400,
            detail={
                "code": 80004,
                "message": "Hm, that didn't work. Double-check that the username is correct.",
            },
        )

    rel_stub = await get_relationship_stub()
    redis = await get_redis()

    # Resolve the username -> target user via data-services.
    try:
        target = await rel_stub.GetUserByUsername(
            pb2.GetUserByUsernameRequest(username=username)
        )
    except grpc.RpcError as exc:
        if exc.code() == grpc.StatusCode.NOT_FOUND:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": 80004,
                    "message": "Hm, that didn't work. Double-check that the username is correct.",
                },
            )
        handle_grpc_error(exc, resource="user")

    tid = int(target.id)

    if tid == uid:
        raise HTTPException(
            status_code=400,
            detail={"code": 80004, "message": "You can't send a friend request to yourself."},
        )

    # Reject obvious duplicates with a friendly message. A missing relationship
    # (NOT_FOUND) is the normal path and simply falls through to send. An
    # INCOMING_REQUEST (3) means they already asked us -> fall through so the
    # state machine auto-accepts.
    try:
        existing = await rel_stub.GetRelationship(
            pb2.GetRelationshipRequest(user_id=uid, target_id=tid)
        )
        if existing.type == 1:
            raise HTTPException(
                status_code=400,
                detail={"code": 80007, "message": "You're already friends with that user."},
            )
        if existing.type == 4:
            raise HTTPException(
                status_code=400,
                detail={"code": 80007, "message": "You've already sent a friend request to that user."},
            )
        if existing.type == 2:
            raise HTTPException(
                status_code=400,
                detail={"code": 80007, "message": "You have this user blocked."},
            )
    except grpc.RpcError:
        pass  # No existing relationship -> proceed

    await _send_friend_request(uid, tid, rel_stub, redis)
    return Response(status_code=204)


# ---------- PUT /users/@me/relationships/{target_user_id} ----------
# Relationship state machine:
#   type=1 (friend request):
#     If target already has OUTGOING_REQUEST to us -> both become FRIEND
#     Otherwise -> sender gets OUTGOING_REQUEST (4), target gets INCOMING_REQUEST (3)
#   type=2 (block):
#     Sender gets BLOCKED (2), remove any relationship in the other direction
#   type=4 (OUTGOING_REQUEST): same as type=1 for compatibility

@router.put("/{target_user_id}", status_code=204)
async def put_relationship(
    target_user_id: str,
    body: RelationshipPutRequest,
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)
    tid = int(target_user_id)

    if uid == tid:
        raise HTTPException(
            status_code=400,
            detail={"code": 50007, "message": "Cannot create a relationship with yourself"},
        )

    rel_stub = await get_relationship_stub()
    redis = await get_redis()

    if body.type in (1, 4):
        # Friend request / accept flow. When the target already has an outgoing
        # request toward us this accepts it (both rows flip to FRIEND); this is
        # exactly how the client's "Accept" button works (PUT type=1).
        await _send_friend_request(uid, tid, rel_stub, redis)

    elif body.type == 2:
        # Block: sender blocks target, remove reverse relationship
        try:
            await rel_stub.UpsertRelationship(
                pb2.UpsertRelationshipRequest(user_id=uid, target_id=tid, type=2)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="relationship")
        # Remove any incoming relationship (target -> us)
        try:
            await rel_stub.DeleteRelationship(pb2.DeleteRelationshipRequest(user_id=tid, target_id=uid))
        except grpc.RpcError:
            pass
        try:
            resp = await rel_stub.GetRelationship(pb2.GetRelationshipRequest(user_id=uid, target_id=tid))
            event_data = await _build_relationship_response(resp)
            await redis.publish(f"user:{uid}", json.dumps({"t": "RELATIONSHIP_ADD", "d": event_data}))
        except grpc.RpcError:
            pass
        # Notify target their relationship was removed
        await redis.publish(f"user:{tid}", json.dumps({"t": "RELATIONSHIP_REMOVE", "d": {"id": str(uid), "type": 0}}))
    else:
        # For any other type, just upsert directly
        try:
            await rel_stub.UpsertRelationship(
                pb2.UpsertRelationshipRequest(user_id=uid, target_id=tid, type=body.type)
            )
        except grpc.RpcError as exc:
            handle_grpc_error(exc, resource="relationship")

    return Response(status_code=204)


# ---------- DELETE /users/@me/relationships/{target_user_id} ----------

@router.delete("/{target_user_id}", status_code=204)
async def delete_relationship(
    target_user_id: str,
    user_id: str = Depends(get_current_user_id),
):
    uid = int(user_id)
    tid = int(target_user_id)

    rel_stub = await get_relationship_stub()

    try:
        await rel_stub.DeleteRelationship(
            pb2.DeleteRelationshipRequest(user_id=uid, target_id=tid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="relationship")

    # Publish removal events
    redis = await get_redis()
    await redis.publish(
        f"user:{uid}",
        json.dumps({"t": "RELATIONSHIP_REMOVE", "d": {"id": target_user_id, "type": 0}}),
    )
    await redis.publish(
        f"user:{tid}",
        json.dumps({"t": "RELATIONSHIP_REMOVE", "d": {"id": user_id, "type": 0}}),
    )

    return Response(status_code=204)


# ---------- GET /users/{target_user_id}/relationships ----------

@mutual_router.get("/{target_user_id}/relationships")
async def get_mutual_friends(
    target_user_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return mutual friends between the current user and the target user."""
    uid = int(user_id)
    tid = int(target_user_id)

    if uid == tid:
        return []

    rel_stub = await get_relationship_stub()
    try:
        resp = await rel_stub.GetMutualFriends(
            pb2.GetMutualFriendsRequest(user_id=uid, target_id=tid)
        )
    except grpc.RpcError:
        return []

    user_stub = await get_user_stub()
    results = []
    for rel in resp.relationships:
        try:
            user = await user_stub.GetUser(pb2.GetUserRequest(user_id=rel.target_id))
            results.append({
                "id": str(user.id),
                "username": user.username,
                "avatar": user.avatar,
                "display_name": getattr(user, 'display_name', None),
            })
        except grpc.RpcError:
            pass

    return results
