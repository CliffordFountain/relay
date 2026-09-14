"""
Tests for the internal voice-join authorization endpoint used by the gateway to
mint channel-scoped voice grants (POST /internal/voice/authorize).

Data-services gRPC (GetChannel, IsMember) and the channel-permission computation
are mocked; we assert the endpoint's allow/deny decision for the security-relevant
cases: cross-guild spoofing, non-members, private channels, and non-voice channels.
"""

from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.config import settings
from app.grpc_stubs import relay_pb2 as pb2
from app.services.permissions import VIEW_CHANNEL, CONNECT

USER_ID = 1000
GUILD_ID = 5000
CHANNEL_ID = 7000
SECRET = settings.internal_service_secret
VOICE_TYPE = 2  # GuildVoice


class FakeRpcError(grpc.RpcError):
    def __init__(self, code=grpc.StatusCode.NOT_FOUND, details=""):
        self._code = code
        self._details = details

    def code(self):
        return self._code

    def details(self):
        return self._details


class FakeRedis:
    """Minimal async Redis for the rate limiter (internal paths skip it, but the
    middleware still runs the global counter for non-exempt paths in the app)."""

    async def get(self, key):
        return None

    async def incr(self, key):
        return 1

    async def expire(self, key, ttl):
        return True

    async def ttl(self, key):
        return 1


def _channel_stub(*, guild_id=GUILD_ID, ch_type=VOICE_TYPE, found=True) -> MagicMock:
    stub = MagicMock()

    async def _get_channel(req):
        if not found:
            raise FakeRpcError(grpc.StatusCode.NOT_FOUND)
        return pb2.Channel(id=req.channel_id, guild_id=guild_id, type=ch_type, name="voice")

    stub.GetChannel = AsyncMock(side_effect=_get_channel)
    return stub


def _member_stub(*, is_member=True) -> MagicMock:
    stub = MagicMock()
    stub.IsMember = AsyncMock(return_value=pb2.IsMemberResponse(is_member=is_member))
    return stub


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch(
            "app.middleware.rate_limit.get_redis",
            new=AsyncMock(return_value=FakeRedis()),
        ):
            yield ac


def _patches(channel_stub, member_stub, perms):
    return (
        patch("app.routers.internal.get_channel_stub", new=AsyncMock(return_value=channel_stub)),
        patch("app.routers.internal.get_member_stub", new=AsyncMock(return_value=member_stub)),
        patch("app.routers.internal.compute_channel_permissions", new=AsyncMock(return_value=perms)),
    )


async def _post(client, *, secret=SECRET, guild_id=GUILD_ID, channel_id=CHANNEL_ID):
    headers = {} if secret is None else {"X-Internal-Secret": secret}
    return await client.post(
        "/internal/voice/authorize",
        json={"user_id": USER_ID, "guild_id": guild_id, "channel_id": channel_id},
        headers=headers,
    )


@pytest.mark.asyncio
async def test_authorized_when_member_with_connect(client: AsyncClient):
    p1, p2, p3 = _patches(_channel_stub(), _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client)
    assert resp.status_code == 200
    assert resp.json()["authorized"] is True


@pytest.mark.asyncio
async def test_denied_cross_guild_channel(client: AsyncClient):
    """Channel really belongs to guild 9999; caller claims GUILD_ID -> denied."""
    stub = _channel_stub(guild_id=9999)
    p1, p2, p3 = _patches(stub, _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorized"] is False
    assert body["reason"] == "channel_guild_mismatch"


@pytest.mark.asyncio
async def test_denied_when_missing_connect(client: AsyncClient):
    """Member can VIEW but lacks CONNECT (private voice channel) -> denied."""
    p1, p2, p3 = _patches(_channel_stub(), _member_stub(), VIEW_CHANNEL)
    with p1, p2, p3:
        resp = await _post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorized"] is False
    assert body["reason"] == "missing_connect"


@pytest.mark.asyncio
async def test_denied_when_not_a_member(client: AsyncClient):
    p1, p2, p3 = _patches(_channel_stub(), _member_stub(is_member=False), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorized"] is False
    assert body["reason"] == "not_a_member"


@pytest.mark.asyncio
async def test_denied_for_non_voice_channel(client: AsyncClient):
    stub = _channel_stub(ch_type=0)  # GuildText
    p1, p2, p3 = _patches(stub, _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorized"] is False
    assert body["reason"] == "not_a_voice_channel"


@pytest.mark.asyncio
async def test_denied_channel_not_found(client: AsyncClient):
    stub = _channel_stub(found=False)
    p1, p2, p3 = _patches(stub, _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorized"] is False
    assert body["reason"] == "channel_not_found"


@pytest.mark.asyncio
async def test_rejected_without_secret(client: AsyncClient):
    p1, p2, p3 = _patches(_channel_stub(), _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client, secret=None)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_rejected_with_wrong_secret(client: AsyncClient):
    p1, p2, p3 = _patches(_channel_stub(), _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client, secret="nope")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_fails_closed_in_production_with_default_secret(client: AsyncClient, monkeypatch):
    """H4: outside development, the shipped dev-default secret must be refused even when it is
    presented correctly — so a prod deploy that forgot to set a strong secret exposes nothing."""
    from app.config import DEV_DEFAULT_INTERNAL_SECRET
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "internal_service_secret", DEV_DEFAULT_INTERNAL_SECRET)
    p1, p2, p3 = _patches(_channel_stub(), _member_stub(), VIEW_CHANNEL | CONNECT)
    with p1, p2, p3:
        resp = await _post(client, secret=DEV_DEFAULT_INTERNAL_SECRET)
    assert resp.status_code == 403
