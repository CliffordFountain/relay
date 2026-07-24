from fastapi import Request, HTTPException

import redis.asyncio as redis
from app.config import settings

_redis: redis.Redis | None = None


async def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url)
    return _redis


async def get_current_token(request: Request) -> str:
    """Extract token from Authorization header."""
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"code": 40001, "message": "Unauthorized"})
    return auth[7:]


async def get_current_user_id(request: Request) -> str:
    """Validate token and return user_id."""
    token = await get_current_token(request)
    r = await _get_redis()
    user_id = await r.get(f"auth:token:{token}")
    if not user_id:
        raise HTTPException(status_code=401, detail={"code": 50014, "message": "Invalid Auth Token"})
    return user_id.decode() if isinstance(user_id, bytes) else user_id
