from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings as app_settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.routers import auth, users, messages, guilds, channels, reactions, dms, relationships, roles, invites, moderation, audit_log, threads, notification_settings, search, emojis, mfa, webhooks, automod, scheduled_events
from app.routers import settings as settings_router
from app.db.connection import get_db, get_redis
from app.grpc_client import get_channel, close_channel


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    # Eagerly initialize the DB pool, Redis client, and gRPC channel so the
    # first request doesn't pay the connection-establishment cost.
    await get_db()
    await get_redis()
    await get_channel()
    yield
    await close_channel()


app = FastAPI(
    lifespan=lifespan,
    title="Relay API",
    version="0.0.1",
    docs_url="/api/v10/docs",
    openapi_url="/api/v10/openapi.json",
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Return the HTTPException detail directly, without FastAPI's default {'detail': ...} wrapper."""
    detail = exc.detail
    if isinstance(detail, dict):
        content = detail
    else:
        content = {"code": 0, "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content=content)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Convert FastAPI/Pydantic validation errors to our error format."""
    errors: dict[str, object] = {}
    for error in exc.errors():
        loc = error.get("loc", [])
        # Skip the "body" prefix from loc (e.g. ("body", "email") -> "email")
        field_parts = [str(p) for p in loc if p != "body"]
        field = ".".join(field_parts) if field_parts else "unknown"
        errors[field] = {
            "_errors": [
                {
                    "code": "BASE_TYPE_REQUIRED",
                    "message": error.get("msg", "Field required"),
                }
            ]
        }
    return JSONResponse(
        status_code=400,
        content={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": errors,
        },
    )

app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset-After",
        "X-RateLimit-Bucket",
        "Retry-After",
    ],
)


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(messages.router)
app.include_router(guilds.router)
app.include_router(channels.router)
app.include_router(reactions.router)
app.include_router(dms.router)
app.include_router(relationships.router)
app.include_router(relationships.mutual_router)
app.include_router(roles.router)
app.include_router(invites.router)
app.include_router(moderation.router)
app.include_router(audit_log.router)
app.include_router(threads.router)
app.include_router(notification_settings.router)
app.include_router(search.router)
app.include_router(settings_router.router)
app.include_router(emojis.router)
app.include_router(mfa.router)
if hasattr(mfa, 'mfa_router'):
    app.include_router(mfa.mfa_router)
app.include_router(webhooks.router)
app.include_router(automod.router)
app.include_router(scheduled_events.router)
app.include_router(guilds.discovery_router)


@app.get("/api/v10/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v10/gateway")
async def get_gateway() -> dict[str, str]:
    return {"url": "ws://localhost:4000"}
