"""
E2E tests for POST /channels/{channel_id}/messages/bulk-delete.

Exercises the bulk delete endpoint including:
- Permission checks (MANAGE_MESSAGES required)
- Validation constraints (2-100 messages, < 14 days old)
- Gateway event publication (MESSAGE_DELETE_BULK)
"""

import asyncio
import json
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

GUILD_ID = 1000
CHANNEL_ID = 2000
USER_ID = 3000
OTHER_USER_ID = 3001
ROLE_ID = GUILD_ID  # @everyone role id == guild id


def _make_message_row(msg_id: int, channel_id: int = CHANNEL_ID, days_ago: int = 0):
    """Build a fake DB row for a message."""
    created = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return {
        "id": msg_id,
        "channel_id": channel_id,
        "created_at": created,
    }


class FakePool:
    """Minimal asyncpg pool mock that supports our queries."""

    def __init__(
        self,
        *,
        is_member: bool = True,
        has_permission: bool = True,
        message_rows: list | None = None,
    ):
        self.is_member = is_member
        self.has_permission = has_permission
        self.message_rows = message_rows or []
        self.deleted_ids: list[int] = []
        self._calls: list[tuple[str, tuple]] = []

    async def fetchrow(self, query: str, *args):
        self._calls.append((query, args))

        # Channel lookup
        if "SELECT * FROM channels" in query:
            return {
                "id": CHANNEL_ID,
                "guild_id": GUILD_ID,
                "type": 0,
                "name": "general",
            }

        # Guild owner check
        if "SELECT owner_id FROM guilds" in query:
            return {"owner_id": USER_ID if self.has_permission else OTHER_USER_ID}

        # @everyone role permissions
        if "SELECT permissions FROM roles" in query:
            # MANAGE_MESSAGES = 1 << 13 = 8192
            perms = (1 << 13) if self.has_permission else 0
            return {"permissions": perms}

        return None

    async def fetchval(self, query: str, *args):
        self._calls.append((query, args))

        # Guild membership check
        if "guild_members" in query and "user_id" in query:
            return USER_ID if self.is_member else None

        # @everyone role perms
        if "SELECT permissions FROM roles" in query:
            return (1 << 13) if self.has_permission else 0

        # Owner check
        if "SELECT owner_id FROM guilds" in query:
            return USER_ID if self.has_permission else OTHER_USER_ID

        return None

    async def fetch(self, query: str, *args):
        self._calls.append((query, args))

        # Messages bulk lookup
        if "SELECT id, channel_id, created_at FROM messages" in query:
            return self.message_rows

        # Attachment lookup
        if "SELECT url FROM attachments" in query:
            return []

        # Role IDs
        if "member_roles" in query:
            return [{"role_id": ROLE_ID}]

        # Permission overwrites
        if "permission_overwrites" in query:
            return []

        # Roles
        if "SELECT permissions FROM roles" in query:
            perms = (1 << 13) if self.has_permission else 0
            return [{"permissions": perms}]

        return []

    async def execute(self, query: str, *args):
        self._calls.append((query, args))
        if "DELETE FROM messages" in query:
            if args:
                self.deleted_ids.extend(args[0])


class FakeRedis:
    """Minimal Redis mock."""

    def __init__(self):
        self.published: list[tuple[str, str]] = []

    async def get(self, key: str):
        if key.startswith("auth:token:"):
            return str(USER_ID).encode()
        return None

    async def publish(self, channel: str, message: str):
        self.published.append((channel, message))


@pytest_asyncio.fixture
async def fake_redis():
    return FakeRedis()


@pytest_asyncio.fixture
async def client(fake_redis: FakeRedis) -> AsyncGenerator[AsyncClient, None]:
    """Create an httpx AsyncClient with patched DB and Redis."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with (
            patch("app.middleware.auth._get_redis", return_value=fake_redis),
            patch("app.middleware.rate_limit.RateLimitMiddleware._get_redis", return_value=fake_redis),
        ):
            yield ac


HEADERS = {"Authorization": "Bearer test-token"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_delete_success(client: AsyncClient, fake_redis: FakeRedis):
    """Happy path: bulk delete with MANAGE_MESSAGES permission removes messages and publishes event."""
    message_rows = [_make_message_row(5001), _make_message_row(5002), _make_message_row(5003)]
    pool = FakePool(is_member=True, has_permission=True, message_rows=message_rows)

    with (
        patch("app.routers.messages.get_db", return_value=pool),
        patch("app.routers.messages.get_redis", return_value=fake_redis),
        patch("app.services.permissions.compute_base_permissions", return_value=(1 << 13)),
        patch("app.services.permissions.compute_channel_permissions", return_value=(1 << 13)),
        patch("app.routers.search.delete_message_index", new_callable=AsyncMock),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001", "5002", "5003"]},
        )

    assert resp.status_code == 204

    # Verify messages were deleted
    assert sorted(pool.deleted_ids) == [5001, 5002, 5003]

    # Verify MESSAGE_DELETE_BULK event was published
    assert len(fake_redis.published) >= 1
    last_event = json.loads(fake_redis.published[-1][1])
    assert last_event["t"] == "MESSAGE_DELETE_BULK"
    assert set(last_event["d"]["ids"]) == {"5001", "5002", "5003"}
    assert last_event["d"]["channel_id"] == str(CHANNEL_ID)


@pytest.mark.asyncio
async def test_bulk_delete_no_permission(client: AsyncClient, fake_redis: FakeRedis):
    """Bulk delete without MANAGE_MESSAGES returns 403."""
    pool = FakePool(is_member=True, has_permission=False, message_rows=[])

    with (
        patch("app.routers.messages.get_db", return_value=pool),
        patch("app.routers.messages.get_redis", return_value=fake_redis),
        patch("app.services.permissions.compute_channel_permissions", return_value=0),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001", "5002"]},
        )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_bulk_delete_too_old_messages(client: AsyncClient, fake_redis: FakeRedis):
    """Bulk delete with messages older than 14 days returns 400."""
    message_rows = [_make_message_row(5001, days_ago=15)]
    pool = FakePool(is_member=True, has_permission=True, message_rows=message_rows)

    with (
        patch("app.routers.messages.get_db", return_value=pool),
        patch("app.routers.messages.get_redis", return_value=fake_redis),
        patch("app.services.permissions.compute_channel_permissions", return_value=(1 << 13)),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001", "5002"]},
        )

    assert resp.status_code == 400
    body = resp.json()
    assert body["detail"]["code"] == 50034


@pytest.mark.asyncio
async def test_bulk_delete_max_100_validation(client: AsyncClient, fake_redis: FakeRedis):
    """Bulk delete with more than 100 messages returns 422 (validation error)."""
    pool = FakePool(is_member=True, has_permission=True)

    with (
        patch("app.routers.messages.get_db", return_value=pool),
        patch("app.routers.messages.get_redis", return_value=fake_redis),
    ):
        ids = [str(i) for i in range(6000, 6101)]  # 101 messages
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ids},
        )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_delete_min_2_validation(client: AsyncClient, fake_redis: FakeRedis):
    """Bulk delete with fewer than 2 messages returns 422 (validation error)."""
    pool = FakePool(is_member=True, has_permission=True)

    with (
        patch("app.routers.messages.get_db", return_value=pool),
        patch("app.routers.messages.get_redis", return_value=fake_redis),
    ):
        resp = await client.post(
            f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
            headers=HEADERS,
            json={"messages": ["5001"]},
        )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_bulk_delete_unauthenticated(client: AsyncClient, fake_redis: FakeRedis):
    """Bulk delete without auth token returns 401."""
    resp = await client.post(
        f"/api/v10/channels/{CHANNEL_ID}/messages/bulk-delete",
        json={"messages": ["5001", "5002"]},
    )
    assert resp.status_code == 401
