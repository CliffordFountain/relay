import asyncpg
import redis.asyncio as redis

from app.config import settings

_db_pool: asyncpg.Pool | None = None
_redis: redis.Redis | None = None


async def get_db() -> asyncpg.Pool:
    global _db_pool
    if _db_pool is None:
        db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        _db_pool = await asyncpg.create_pool(
            db_url,
            min_size=5,
            max_size=20,
            command_timeout=30,
        )
    return _db_pool


async def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url)
    return _redis
