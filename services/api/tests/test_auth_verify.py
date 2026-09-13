"""
Tests for POST /api/v10/auth/verify (email verification).

Regression guard for the "verification is a no-op" bug: the endpoint used to
call UpdateUser with no fields (so users.verified was never written), swallow
any gRPC error, burn the one-time token, and always report success. These tests
assert the fixed behaviour:

  * the happy path forwards ``verified=True`` to UpdateUser and consumes the token,
  * an invalid/expired token is rejected without touching UpdateUser,
  * when the UpdateUser RPC fails, the endpoint surfaces the error AND keeps the
    token intact (so the still-valid link can be retried) instead of falsely
    reporting success.
"""

from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.grpc_stubs import relay_pb2 as pb2


USER_ID = 4242
TOKEN = "a" * 64


class MiddlewareRedis:
    """Minimal async Redis mock for the rate-limiter middleware."""

    async def get(self, key):
        return None

    async def incr(self, key):
        return 1  # always under the rate limit

    async def expire(self, key, ttl):
        return True

    async def pexpire(self, key, ttl):
        return True

    async def ttl(self, key):
        return 1

    async def pttl(self, key):
        return 1000


class RouterRedis:
    """Redis mock for the verify handler: resolves the verify token and records deletes."""

    def __init__(self, token_value: bytes | None):
        self._token_value = token_value
        self.deleted: list[str] = []

    async def get(self, key):
        if key == f"verify:{TOKEN}":
            return self._token_value
        return None

    async def delete(self, key):
        self.deleted.append(key)
        return 1


class _RpcErrorWithCode(grpc.RpcError):
    """grpc.RpcError carrying a code()/details() so handle_grpc_error can map it."""

    def code(self):
        return grpc.StatusCode.INTERNAL

    def details(self):
        return "boom"


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch(
            "app.middleware.rate_limit.get_redis",
            new=AsyncMock(return_value=MiddlewareRedis()),
        ):
            yield ac


@pytest.mark.asyncio
async def test_verify_marks_user_verified_and_consumes_token(client: AsyncClient):
    """A valid token flips verified=True via UpdateUser and burns the token."""
    router_redis = RouterRedis(str(USER_ID).encode())
    stub = MagicMock()
    stub.UpdateUser = AsyncMock(return_value=pb2.User(id=USER_ID, verified=True))

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=router_redis)),
    ):
        resp = await client.post("/api/v10/auth/verify", json={"token": TOKEN})

    assert resp.status_code == 200
    assert resp.json()["message"] == "Email verified successfully"

    # UpdateUser must actually be asked to set verified=True for this user.
    req_arg = stub.UpdateUser.call_args.args[0]
    assert req_arg.user_id == USER_ID
    assert req_arg.HasField("verified") is True
    assert req_arg.verified is True

    # The one-time token is consumed only after a successful update.
    assert f"verify:{TOKEN}" in router_redis.deleted


@pytest.mark.asyncio
async def test_verify_invalid_token_rejected(client: AsyncClient):
    """An unknown/expired token returns 400 and never calls UpdateUser."""
    router_redis = RouterRedis(None)
    stub = MagicMock()
    stub.UpdateUser = AsyncMock()

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=router_redis)),
    ):
        resp = await client.post("/api/v10/auth/verify", json={"token": TOKEN})

    assert resp.status_code == 400
    stub.UpdateUser.assert_not_called()
    assert router_redis.deleted == []


@pytest.mark.asyncio
async def test_verify_update_failure_keeps_token_and_fails(client: AsyncClient):
    """If UpdateUser fails, don't report success and don't burn the token."""
    router_redis = RouterRedis(str(USER_ID).encode())
    stub = MagicMock()
    stub.UpdateUser = AsyncMock(side_effect=_RpcErrorWithCode())

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=router_redis)),
    ):
        resp = await client.post("/api/v10/auth/verify", json={"token": TOKEN})

    assert resp.status_code == 500
    # Token must remain valid so the user can retry the link.
    assert router_redis.deleted == []
