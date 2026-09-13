"""
Tests for the friend-request flow on /api/v10/users/@me/relationships.

Covers the add-by-username POST path (resolve username -> create the
outgoing/pending + incoming/pending pair), the mutual-acceptance short-circuit,
the PUT accept path (both rows flip to FRIEND), and the self / unknown /
duplicate rejections. Data-services gRPC is mocked; we assert on the
UpsertRelationship calls the router issues.
"""

from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.middleware.auth import get_current_user_id
from app.grpc_stubs import relay_pb2 as pb2


SELF_ID = 1000
TARGET_ID = 2000


class FakeRpcError(grpc.RpcError):
    """grpc.RpcError with a usable code()/details() for the router's paths."""

    def __init__(self, code=grpc.StatusCode.NOT_FOUND, details=""):
        self._code = code
        self._details = details

    def code(self):
        return self._code

    def details(self):
        return self._details


class FakeRedis:
    """Minimal async Redis covering the rate limiter and event publishing."""

    async def get(self, key):
        return None

    async def incr(self, key):
        return 1

    async def expire(self, key, ttl):
        return True

    async def pexpire(self, key, ttl):
        return True

    async def ttl(self, key):
        return 1

    async def pttl(self, key):
        return 1000

    async def setex(self, key, ttl, value):
        return True

    async def publish(self, channel, message):
        return 1


def _make_rel_stub(*, target_id: int = TARGET_ID, rel_map: dict | None = None) -> MagicMock:
    """Build a RelationshipService stub mock.

    ``rel_map`` maps (user_id, target_id) -> relationship type. Any pair not in
    the map raises NOT_FOUND, mirroring "no relationship exists".
    """
    rel_map = rel_map or {}
    stub = MagicMock()

    async def _get_user_by_username(req):
        return pb2.User(id=target_id, username=req.username)

    async def _get_relationship(req):
        key = (req.user_id, req.target_id)
        if key in rel_map:
            return pb2.Relationship(
                id=1,
                user_id=req.user_id,
                target_id=req.target_id,
                type=rel_map[key],
                user=pb2.User(id=req.target_id),
            )
        raise FakeRpcError(grpc.StatusCode.NOT_FOUND)

    async def _upsert(req):
        return pb2.Relationship(
            id=1, user_id=req.user_id, target_id=req.target_id, type=req.type,
            user=pb2.User(id=req.target_id),
        )

    stub.GetUserByUsername = AsyncMock(side_effect=_get_user_by_username)
    stub.GetRelationship = AsyncMock(side_effect=_get_relationship)
    stub.UpsertRelationship = AsyncMock(side_effect=_upsert)
    return stub


def _make_user_stub() -> MagicMock:
    stub = MagicMock()
    stub.GetUser = AsyncMock(return_value=pb2.User(id=TARGET_ID, username="bob"))
    return stub


def _upsert_tuples(rel_stub: MagicMock) -> set:
    return {
        (c.args[0].user_id, c.args[0].target_id, c.args[0].type)
        for c in rel_stub.UpsertRelationship.call_args_list
    }


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    app.dependency_overrides[get_current_user_id] = lambda: str(SELF_ID)
    transport = ASGITransport(app=app)
    fake_redis = FakeRedis()
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            with patch(
                "app.middleware.rate_limit.get_redis",
                new=AsyncMock(return_value=fake_redis),
            ):
                yield ac
    finally:
        app.dependency_overrides.pop(get_current_user_id, None)


def _patches(rel_stub, user_stub, fake_redis=None):
    fake_redis = fake_redis or FakeRedis()
    return (
        patch("app.routers.relationships.get_relationship_stub", new=AsyncMock(return_value=rel_stub)),
        patch("app.routers.relationships.get_user_stub", new=AsyncMock(return_value=user_stub)),
        patch("app.routers.relationships.get_redis", new=AsyncMock(return_value=fake_redis)),
    )


@pytest.mark.asyncio
async def test_add_by_username_creates_pending_pair(client: AsyncClient):
    """POST by username creates OUTGOING(4) for sender and INCOMING(3) for target."""
    rel_stub = _make_rel_stub()
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "bob"}
        )

    assert resp.status_code == 204
    # username resolved case-preservingly
    assert rel_stub.GetUserByUsername.call_args.args[0].username == "bob"
    tuples = _upsert_tuples(rel_stub)
    assert (SELF_ID, TARGET_ID, 4) in tuples  # sender -> outgoing/pending
    assert (TARGET_ID, SELF_ID, 3) in tuples  # target -> incoming/pending


@pytest.mark.asyncio
async def test_add_by_username_is_case_insensitive_forwarded(client: AsyncClient):
    """The raw username is forwarded to data-services (which matches LOWER())."""
    rel_stub = _make_rel_stub()
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "BoB"}
        )

    assert resp.status_code == 204
    assert rel_stub.GetUserByUsername.call_args.args[0].username == "BoB"


@pytest.mark.asyncio
async def test_add_existing_incoming_request_auto_accepts(client: AsyncClient):
    """If the target already sent us a request, adding them makes both FRIEND(1)."""
    # target already has OUTGOING(4) toward us; we hold INCOMING(3) toward them.
    rel_stub = _make_rel_stub(
        rel_map={(SELF_ID, TARGET_ID): 3, (TARGET_ID, SELF_ID): 4}
    )
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "bob"}
        )

    assert resp.status_code == 204
    tuples = _upsert_tuples(rel_stub)
    assert (SELF_ID, TARGET_ID, 1) in tuples
    assert (TARGET_ID, SELF_ID, 1) in tuples


@pytest.mark.asyncio
async def test_add_self_is_rejected(client: AsyncClient):
    """Adding yourself by username returns 400 and writes no relationship."""
    rel_stub = _make_rel_stub(target_id=SELF_ID)  # username resolves to us
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "me"}
        )

    assert resp.status_code == 400
    rel_stub.UpsertRelationship.assert_not_called()


@pytest.mark.asyncio
async def test_add_unknown_username_is_rejected(client: AsyncClient):
    """An unknown username (NOT_FOUND from data-services) returns 400 code 80004."""
    rel_stub = _make_rel_stub()
    rel_stub.GetUserByUsername = AsyncMock(
        side_effect=FakeRpcError(grpc.StatusCode.NOT_FOUND)
    )
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "ghost"}
        )

    assert resp.status_code == 400
    # Custom HTTPException handler (app/main.py) returns the detail body unwrapped.
    assert resp.json()["code"] == 80004
    rel_stub.UpsertRelationship.assert_not_called()


@pytest.mark.asyncio
async def test_add_duplicate_when_already_friends_is_rejected(client: AsyncClient):
    """Adding someone you're already friends with returns 400 and writes nothing."""
    rel_stub = _make_rel_stub(rel_map={(SELF_ID, TARGET_ID): 1})
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "bob"}
        )

    assert resp.status_code == 400
    rel_stub.UpsertRelationship.assert_not_called()


@pytest.mark.asyncio
async def test_add_duplicate_when_request_already_sent_is_rejected(client: AsyncClient):
    """Re-sending a pending outgoing request returns 400 and writes nothing."""
    rel_stub = _make_rel_stub(rel_map={(SELF_ID, TARGET_ID): 4})
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.post(
            "/api/v10/users/@me/relationships", json={"username": "bob"}
        )

    assert resp.status_code == 400
    rel_stub.UpsertRelationship.assert_not_called()


@pytest.mark.asyncio
async def test_accept_via_put_makes_both_friends(client: AsyncClient):
    """PUT type=1 accepting an incoming request flips BOTH rows to FRIEND(1)."""
    # We are SELF (the accepter); TARGET already sent us a request -> TARGET has
    # OUTGOING(4) toward us.
    rel_stub = _make_rel_stub(rel_map={(TARGET_ID, SELF_ID): 4})
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.put(
            f"/api/v10/users/@me/relationships/{TARGET_ID}", json={"type": 1}
        )

    assert resp.status_code == 204
    tuples = _upsert_tuples(rel_stub)
    assert (SELF_ID, TARGET_ID, 1) in tuples
    assert (TARGET_ID, SELF_ID, 1) in tuples


@pytest.mark.asyncio
async def test_accept_via_put_self_is_rejected(client: AsyncClient):
    """PUT toward yourself is rejected before any write."""
    rel_stub = _make_rel_stub()
    user_stub = _make_user_stub()
    p1, p2, p3 = _patches(rel_stub, user_stub)
    with p1, p2, p3:
        resp = await client.put(
            f"/api/v10/users/@me/relationships/{SELF_ID}", json={"type": 1}
        )

    assert resp.status_code == 400
    rel_stub.UpsertRelationship.assert_not_called()
