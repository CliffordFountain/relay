"""
E2E tests for POST /channels/{channel_id}/messages/bulk-delete.

The endpoint is gRPC-backed. It resolves the channel via get_channel_with_access,
enforces MANAGE_MESSAGES through app.services.permissions, forwards the delete to
the MessageService (BulkDeleteMessages), drops each message from the search index,
and publishes a MESSAGE_DELETE_BULK gateway event. Data-services gRPC, the search
index, and Redis are all mocked here.

Notes on error shapes:
- The API's custom HTTPException handler (app/main.py) returns the detail body
  WITHOUT the {"detail": ...} wrapper, so assertions read resp.json()["code"].
- Body validation (the 2..100 constraint) is turned into a 400 code 50035
  "Invalid Form Body" by the RequestValidationError handler, not a raw 422.
- "Too old to bulk delete" is now enforced by data-services, which returns
  INVALID_ARGUMENT; handle_grpc_error maps that to 400 code 50035.
"""

import json
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.permissions import MANAGE_MESSAGES
from app.grpc_stubs import relay_pb2 as pb2


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

GUILD_ID = 1000
CHANNEL_ID = 2000
USER_ID = 3000


class FakeRpcError(grpc.RpcError):
    """grpc.RpcError with a usable code()/details() for handle_grpc_error."""

    def __init__(self, code=grpc.StatusCode.INVALID_ARGUMENT, details=""):
        self._code = code
        self._details = details

    def code(self):
        return self._code

    def details(self):
        return self._details


class FakeRedis:
    """Async Redis stub covering auth token lookup, the rate limiter, and publishing."""

    def __init__(self):
        self.published: list[tuple[str, str]] = []
        self._counters: dict[str, int] = {}

    async def get(self, key: str):
        # Both the auth dependency and the rate limiter resolve the token this way.
        if key.startswith("auth:token:"):
            return str(USER_ID).encode()
        return None

    async def incr(self, key: str) -> int:
        self._counters[key] = self._counters.get(key, 0) + 1
        return self._counters[key]

    async def expire(self, key: str, ttl) -> bool:
        return True

    async def pexpire(self, key: str, ttl) -> bool:
        return True

    async def ttl(self, key: str) -> int:
        return 1

    async def pttl(self, key: str) -> int:
        return 1000

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1


def _make_channel():
    """A guild-channel object shaped like what get_channel_with_access returns."""
    return MagicMock(id=CHANNEL_ID, guild_id=GUILD_ID, type=0)


def _make_message_stub() -> MagicMock:
    """A MessageService stub whose BulkDeleteMessages succeeds (returns Empty)."""
    stub = MagicMock()
    stub.BulkDeleteMessages = AsyncMock(return_value=pb2.Empty())
    return stub


@pytest_asyncio.fixture
async def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest_asyncio.fixture
async def client(fake_redis: FakeRedis) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient with auth + rate-limit Redis mocked so requests reach the handler."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with (
            patch("app.middleware.auth._get_redis", new=AsyncMock(return_value=fake_redis)),
            patch("app.middleware.rate_limit.get_redis", new=AsyncMock(return_value=fake_redis)),
        ):
            yield ac


HEADERS = {"Authorization": "Bearer test-token"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_delete_success(client: AsyncClient, fake_redis: FakeRedis):
    """Happy path: with MANAGE_MESSAGES the delete is forwarded and the event published."""
    stub = _make_message_stub()

    with (
        patch("app.routers.messages.get_channel_with_access", new=AsyncMock(return_value=_make_channel())),
        patch("app.services.permissions.compute_channel_permissions", new=AsyncMock(return_value=MANAGE_MESSAGES)),
        patch("app.routers.messages.get_message_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.messages.get_redis", new=AsyncMock(return_value=fake_redis)),
        patch("app.routers.search.delete_message_index", new=AsyncMock()),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001", "5002", "5003"]},
        )

    assert resp.status_code == 204

    # The delete was forwarded to data-services with the parsed ids on the right channel.
    stub.BulkDeleteMessages.assert_awaited_once()
    sent = stub.BulkDeleteMessages.call_args.args[0]
    assert sent.channel_id == CHANNEL_ID
    assert list(sent.message_ids) == [5001, 5002, 5003]

    # A MESSAGE_DELETE_BULK event was published to the guild channel.
    assert len(fake_redis.published) >= 1
    topic, payload = fake_redis.published[-1]
    assert topic == f"guild:{GUILD_ID}"
    event = json.loads(payload)
    assert event["t"] == "MESSAGE_DELETE_BULK"
    assert set(event["d"]["ids"]) == {"5001", "5002", "5003"}
    assert event["d"]["channel_id"] == str(CHANNEL_ID)
    assert event["d"]["guild_id"] == str(GUILD_ID)


@pytest.mark.asyncio
async def test_bulk_delete_no_permission(client: AsyncClient, fake_redis: FakeRedis):
    """Without MANAGE_MESSAGES the request is rejected 403 before any delete is forwarded."""
    stub = _make_message_stub()

    with (
        patch("app.routers.messages.get_channel_with_access", new=AsyncMock(return_value=_make_channel())),
        patch("app.services.permissions.compute_channel_permissions", new=AsyncMock(return_value=0)),
        patch("app.routers.messages.get_message_stub", new=AsyncMock(return_value=stub)),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001", "5002"]},
        )

    assert resp.status_code == 403
    assert resp.json()["code"] == 50013
    stub.BulkDeleteMessages.assert_not_awaited()


@pytest.mark.asyncio
async def test_bulk_delete_too_old_messages(client: AsyncClient, fake_redis: FakeRedis):
    """Messages older than 14 days are rejected by data-services (INVALID_ARGUMENT -> 400)."""
    stub = _make_message_stub()
    stub.BulkDeleteMessages = AsyncMock(
        side_effect=FakeRpcError(
            grpc.StatusCode.INVALID_ARGUMENT,
            "You can only bulk delete messages that are under 14 days old",
        )
    )

    with (
        patch("app.routers.messages.get_channel_with_access", new=AsyncMock(return_value=_make_channel())),
        patch("app.services.permissions.compute_channel_permissions", new=AsyncMock(return_value=MANAGE_MESSAGES)),
        patch("app.routers.messages.get_message_stub", new=AsyncMock(return_value=stub)),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001", "5002"]},
        )

    assert resp.status_code == 400
    assert resp.json()["code"] == 50035


@pytest.mark.asyncio
async def test_bulk_delete_max_100_validation(client: AsyncClient, fake_redis: FakeRedis):
    """More than 100 messages fails body validation (400 Invalid Form Body)."""
    ids = [str(i) for i in range(6000, 6101)]  # 101 messages
    resp = await client.post(
        f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
        headers=HEADERS,
        json={"messages": ids},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == 50035


@pytest.mark.asyncio
async def test_bulk_delete_min_2_validation(client: AsyncClient, fake_redis: FakeRedis):
    """Fewer than 2 messages fails body validation (400 Invalid Form Body)."""
    resp = await client.post(
        f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
        headers=HEADERS,
        json={"messages": ["5001"]},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == 50035


@pytest.mark.asyncio
async def test_bulk_delete_unauthenticated(client: AsyncClient, fake_redis: FakeRedis):
    """Without an auth token the request is rejected 401."""
    resp = await client.post(
        f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
        json={"messages": ["5001", "5002"]},
    )
    assert resp.status_code == 401
