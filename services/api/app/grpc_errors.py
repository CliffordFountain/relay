"""Map gRPC errors from data-services to FastAPI HTTPExceptions.

Usage in routers::

    from app.grpc_errors import handle_grpc_error

    try:
        result = await stub.GetUser(request)
    except grpc.RpcError as exc:
        handle_grpc_error(exc)
"""

from __future__ import annotations

import grpc
from fastapi import HTTPException


def handle_grpc_error(
    exc: grpc.RpcError,
    *,
    resource: str = "resource",
) -> None:
    """Translate a gRPC ``RpcError`` into an appropriate ``HTTPException``.

    The *resource* hint is used to produce more specific error codes
    (e.g. "guild" -> 10004 Unknown Guild, "channel" -> 10003 Unknown Channel).

    This function always raises and never returns.
    """
    code = exc.code()  # type: ignore[union-attr]
    details = exc.details() or ""  # type: ignore[union-attr]

    if code == grpc.StatusCode.NOT_FOUND:
        error_code = _not_found_code(resource)
        raise HTTPException(
            status_code=404,
            detail={"code": error_code, "message": details or f"Unknown {resource}", "errors": {}},
        )

    if code == grpc.StatusCode.PERMISSION_DENIED:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": details or "Missing Permissions", "errors": {}},
        )

    if code == grpc.StatusCode.INVALID_ARGUMENT:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": details or "Invalid Form Body", "errors": {}},
        )

    if code == grpc.StatusCode.ALREADY_EXISTS:
        raise HTTPException(
            status_code=409,
            detail={"code": 30001, "message": details or "Resource already exists", "errors": {}},
        )

    if code == grpc.StatusCode.UNAUTHENTICATED:
        raise HTTPException(
            status_code=401,
            detail={"code": 40001, "message": details or "Unauthorized", "errors": {}},
        )

    if code == grpc.StatusCode.RESOURCE_EXHAUSTED:
        raise HTTPException(
            status_code=429,
            detail={"code": 40005, "message": details or "Rate limited", "errors": {}},
        )

    if code == grpc.StatusCode.UNAVAILABLE:
        raise HTTPException(
            status_code=503,
            detail={"code": 0, "message": details or "Service temporarily unavailable", "errors": {}},
        )

    # INTERNAL or any other unexpected status
    raise HTTPException(
        status_code=500,
        detail={"code": 0, "message": details or "Internal server error", "errors": {}},
    )


# ---------------------------------------------------------------------------
# "Unknown X" error code mapping
# ---------------------------------------------------------------------------

_RESOURCE_NOT_FOUND_CODES: dict[str, int] = {
    "guild": 10004,
    "channel": 10003,
    "message": 10008,
    "user": 10013,
    "role": 10011,
    "invite": 10006,
    "ban": 10026,
    "emoji": 10014,
    "webhook": 10015,
    "member": 10007,
    "thread": 10003,  # threads reuse the channel error code
    "relationship": 10006,
    "automod_rule": 10069,
    "notification_settings": 10070,
}


def _not_found_code(resource: str) -> int:
    """Return the error code for an unknown *resource*."""
    return _RESOURCE_NOT_FOUND_CODES.get(resource, 10000)
