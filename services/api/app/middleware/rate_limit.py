import time
import hashlib
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.db.connection import get_redis

GLOBAL_LIMIT = 50  # requests per second per user
GLOBAL_WINDOW = 1  # seconds

# Per-route rate limits: pattern -> (max_requests, window_seconds)
ROUTE_LIMITS = {
    "POST:/api/v10/auth/register": (5, 3600),      # 5 per hour
    "POST:/api/v10/auth/login": (5, 300),           # 5 per 5 min
    "POST:/api/v10/channels/*/messages": (5, 5),    # 5 per 5 sec
    "PUT:/api/v10/channels/*/messages/*/reactions/*": (1, 0.25),  # 1 per 250ms
    "PATCH:/api/v10/users/@me": (2, 600),           # 2 per 10 min
    "POST:/api/v10/guilds": (10, 86400),            # 10 per day
}


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip health check
        if request.url.path == "/api/v10/health":
            return await call_next(request)

        # Get user ID from auth header (if present)
        auth = request.headers.get("Authorization", "")
        token = auth.replace("Bearer ", "") if auth.startswith("Bearer ") else None

        if token:
            redis = await get_redis()
            user_id = await redis.get(f"auth:token:{token}")
            if user_id:
                user_key = user_id.decode() if isinstance(user_id, bytes) else user_id
            else:
                user_key = request.client.host if request.client else "anonymous"
        else:
            user_key = request.client.host if request.client else "anonymous"

        # Check global rate limit
        bucket = f"ratelimit:global:{user_key}"
        redis = await get_redis()

        current = await redis.incr(bucket)
        if current == 1:
            await redis.expire(bucket, GLOBAL_WINDOW)

        if current > GLOBAL_LIMIT:
            ttl = await redis.ttl(bucket)
            retry_after = max(ttl, 1)
            return Response(
                content='{"message": "You are being rate limited.", "retry_after": '
                + str(retry_after)
                + ', "global": true, "code": 0}',
                status_code=429,
                media_type="application/json",
                headers={
                    "X-RateLimit-Global": "true",
                    "X-RateLimit-Limit": str(GLOBAL_LIMIT),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset-After": str(retry_after),
                    "X-RateLimit-Scope": "global",
                    "Retry-After": str(retry_after),
                },
            )

        # Check per-route rate limit
        method = request.method
        path = request.url.path
        route_bucket = f"{method}:{path}"

        # Find matching route pattern
        limit, window = None, None
        for pattern, (l, w) in ROUTE_LIMITS.items():
            if _match_route(pattern, route_bucket):
                limit, window = l, w
                break

        if limit is not None and window is not None:
            route_key = f"ratelimit:route:{user_key}:{_bucket_hash(route_bucket)}"
            route_current = await redis.incr(route_key)
            if route_current == 1:
                # Use millisecond precision for sub-second windows
                if window < 1:
                    await redis.pexpire(route_key, int(window * 1000))
                else:
                    await redis.expire(route_key, int(window))

            if route_current > limit:
                if window < 1:
                    route_ttl_ms = await redis.pttl(route_key)
                    retry_after = max(route_ttl_ms / 1000, 0.1)
                else:
                    route_ttl = await redis.ttl(route_key)
                    retry_after = max(route_ttl, 1)

                return Response(
                    content='{"message": "You are being rate limited.", "retry_after": '
                    + str(retry_after)
                    + ', "global": false, "code": 0}',
                    status_code=429,
                    media_type="application/json",
                    headers={
                        "X-RateLimit-Limit": str(limit),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset-After": str(retry_after),
                        "X-RateLimit-Bucket": _bucket_hash(route_bucket),
                        "X-RateLimit-Scope": "user",
                        "Retry-After": str(int(retry_after) if retry_after >= 1 else 1),
                    },
                )

        response = await call_next(request)

        # Add rate limit headers to successful responses
        remaining = max(0, GLOBAL_LIMIT - current)
        reset_after = await redis.ttl(bucket)
        bucket_hash = _bucket_hash(route_bucket)

        import time
        reset_epoch = time.time() + max(reset_after, 0)

        response.headers["X-RateLimit-Limit"] = str(limit or GLOBAL_LIMIT)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = f"{reset_epoch:.3f}"
        response.headers["X-RateLimit-Reset-After"] = str(max(reset_after, 0))
        response.headers["X-RateLimit-Bucket"] = bucket_hash

        return response


def _bucket_hash(route_bucket: str) -> str:
    """Generate a short hash for the route bucket."""
    return hashlib.md5(route_bucket.encode()).hexdigest()[:8]


def _match_route(pattern: str, actual: str) -> bool:
    """Simple wildcard route matching."""
    parts_p = pattern.split("/")
    parts_a = actual.split("/")
    if len(parts_p) != len(parts_a):
        return False
    return all(p == "*" or p == a for p, a in zip(parts_p, parts_a))
