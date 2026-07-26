"""
Tests for POST /api/v10/auth/login identifier resolution (Bug 1).

Users must be able to sign in with EITHER their email OR their username.
The router forwards the raw identifier to data-services' AuthenticateUser,
which resolves email-vs-username and verifies the password. These tests assert
that a plain username (no '@') is accepted and forwarded unchanged, that an
email is forwarded unchanged, and that a failed authentication returns 401.
"""

from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.grpc_stubs import relay_pb2 as pb2


USER_ID = 3000


class FakeRedis:
    """Minimal async Redis mock covering the rate-limiter and the login path."""

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

    async def setex(self, key, ttl, value):
        return True


def _make_user() -> pb2.User:
    return pb2.User(
        id=USER_ID,
        username="alice",
        email="alice@example.com",
        verified=True,
        mfa_enabled=False,
        flags=0,
        locale="en-US",
    )


@pytest_asyncio.fixture
async def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest_asyncio.fixture
async def client(fake_redis: FakeRedis) -> AsyncGenerator[AsyncClient, None]:
    """httpx AsyncClient with the rate-limiter's Redis patched out."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch(
            "app.middleware.rate_limit.get_redis",
            new=AsyncMock(return_value=fake_redis),
        ):
            yield ac


def _stub_returning(user: pb2.User) -> MagicMock:
    stub = MagicMock()
    stub.AuthenticateUser = AsyncMock(return_value=user)
    return stub


@pytest.mark.asyncio
async def test_login_with_plain_username_no_at(client: AsyncClient, fake_redis: FakeRedis):
    """A username (no '@') is accepted and forwarded to AuthenticateUser as-is."""
    stub = _stub_returning(_make_user())

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=fake_redis)),
    ):
        resp = await client.post(
            "/api/v10/auth/login",
            json={"email": "alice", "password": "TestPass123!"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["token"]
    assert body["user_id"] == str(USER_ID)

    # The identifier is forwarded verbatim (no '@' required, not rejected).
    req_arg = stub.AuthenticateUser.call_args.args[0]
    assert req_arg.email == "alice"
    assert req_arg.password_hash == "TestPass123!"


@pytest.mark.asyncio
async def test_login_with_email(client: AsyncClient, fake_redis: FakeRedis):
    """An email identifier is likewise forwarded verbatim."""
    stub = _stub_returning(_make_user())

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=fake_redis)),
    ):
        resp = await client.post(
            "/api/v10/auth/login",
            json={"email": "alice@example.com", "password": "TestPass123!"},
        )

    assert resp.status_code == 200
    req_arg = stub.AuthenticateUser.call_args.args[0]
    assert req_arg.email == "alice@example.com"


@pytest.mark.asyncio
async def test_login_via_login_field_username(client: AsyncClient, fake_redis: FakeRedis):
    """The protocol "login" field also accepts a plain username."""
    stub = _stub_returning(_make_user())

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=fake_redis)),
    ):
        resp = await client.post(
            "/api/v10/auth/login",
            json={"login": "alice", "password": "TestPass123!"},
        )

    assert resp.status_code == 200
    assert stub.AuthenticateUser.call_args.args[0].email == "alice"


@pytest.mark.asyncio
async def test_login_invalid_credentials_returns_401(client: AsyncClient, fake_redis: FakeRedis):
    """When data-services rejects the credentials, the API returns 401."""
    stub = MagicMock()
    stub.AuthenticateUser = AsyncMock(side_effect=grpc.RpcError())

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=fake_redis)),
    ):
        resp = await client.post(
            "/api/v10/auth/login",
            json={"email": "alice", "password": "wrong"},
        )

    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == 50014


@pytest.mark.asyncio
async def test_login_missing_identifier_returns_400(client: AsyncClient, fake_redis: FakeRedis):
    """An empty identifier is a form-body error before any RPC is attempted."""
    stub = _stub_returning(_make_user())

    with (
        patch("app.routers.auth.get_user_stub", new=AsyncMock(return_value=stub)),
        patch("app.routers.auth.get_redis", new=AsyncMock(return_value=fake_redis)),
    ):
        resp = await client.post(
            "/api/v10/auth/login",
            json={"email": "   ", "password": "TestPass123!"},
        )

    assert resp.status_code == 400
    stub.AuthenticateUser.assert_not_called()
