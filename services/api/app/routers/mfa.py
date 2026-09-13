import json
import secrets

import grpc
import pyotp
from fastapi import APIRouter, HTTPException, Depends

from app.models.user import (
    MfaEnableResponse,
    MfaVerifyRequest,
    MfaVerifyResponse,
    MfaTotpRequest,
    TokenResponse,
)
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.routers.auth import generate_token, _refresh_user_guilds
from app.config import settings

router = APIRouter(prefix="/api/v10/users", tags=["mfa"])
mfa_router = APIRouter(prefix="/api/v10/auth/mfa", tags=["mfa"])


@router.post("/@me/mfa/totp/enable", response_model=MfaEnableResponse)
async def enable_totp(user_id: str = Depends(get_current_user_id)):
    """Generate a TOTP secret and provisioning URI. Does NOT enable MFA yet."""
    secret = pyotp.random_base32()
    user_stub = await get_user_stub()
    try:
        user = await user_stub.GetUser(pb2.GetUserRequest(user_id=int(user_id)))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    if not user:
        raise HTTPException(
            status_code=404,
            detail={"code": 10013, "message": "Unknown User"},
        )

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=user.email or user.username, issuer_name="Relay"
    )

    return MfaEnableResponse(secret=secret, provisioning_uri=provisioning_uri)


@router.post("/@me/mfa/totp/verify", response_model=MfaVerifyResponse)
async def verify_totp(
    body: MfaVerifyRequest, user_id: str = Depends(get_current_user_id)
):
    """Verify TOTP code and enable MFA for the user."""
    totp = pyotp.TOTP(body.secret)
    if not totp.verify(body.code):
        raise HTTPException(
            status_code=400,
            detail={"code": 60008, "message": "Invalid two-factor code"},
        )

    uid = int(user_id)

    # Check user isn't already MFA-enabled
    user_stub = await get_user_stub()
    try:
        mfa_resp = await user_stub.GetMfaSecret(pb2.GetMfaSecretRequest(user_id=uid))
        if mfa_resp.enabled:
            raise HTTPException(
                status_code=400,
                detail={"code": 60001, "message": "MFA is already enabled"},
            )
    except grpc.RpcError:
        pass  # No MFA yet, that's fine

    # Enable MFA and store the secret
    try:
        await user_stub.SetMfaSecret(
            pb2.SetMfaSecretRequest(user_id=uid, secret=body.secret)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    # Generate 10 backup codes (8-char hex each)
    backup_codes = [secrets.token_hex(4) for _ in range(10)]

    # Store backup codes in Redis (hashed in production, simplified here)
    redis = await get_redis()
    await redis.set(f"mfa:backup:{user_id}", json.dumps(backup_codes))

    return MfaVerifyResponse(backup_codes=backup_codes)


@router.post("/@me/mfa/totp/disable", status_code=204)
async def disable_totp(user_id: str = Depends(get_current_user_id)):
    """Disable MFA for the user."""
    user_stub = await get_user_stub()
    try:
        await user_stub.DisableMfa(pb2.DisableMfaRequest(user_id=int(user_id)))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    redis = await get_redis()
    await redis.delete(f"mfa:backup:{user_id}")


@mfa_router.post("/totp", response_model=TokenResponse)
async def verify_mfa_login(body: MfaTotpRequest):
    """Verify MFA TOTP code during login. Requires a ticket from the login endpoint."""
    redis = await get_redis()

    # Look up the ticket
    user_id = await redis.get(f"mfa:ticket:{body.ticket}")
    if not user_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 50014, "message": "Invalid or expired MFA ticket"},
        )
    user_id_str = user_id.decode() if isinstance(user_id, bytes) else user_id

    # Get the user's MFA secret via gRPC
    user_stub = await get_user_stub()
    try:
        mfa_resp = await user_stub.GetMfaSecret(
            pb2.GetMfaSecretRequest(user_id=int(user_id_str))
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    if not mfa_resp.enabled or not mfa_resp.secret:
        raise HTTPException(
            status_code=400,
            detail={"code": 60002, "message": "MFA is not enabled for this user"},
        )

    # Per-ticket brute-force guard: a 6-digit TOTP has only 1e6 possibilities, so cap the
    # guesses allowed against a single ticket and burn it once exceeded (forcing the attacker
    # back through username/password). Reserve the attempt BEFORE verifying, so concurrent
    # guesses reusing one ticket can't each verify before the counter catches up (a
    # count-then-act TOCTOU). Independent of IP, so it holds even against a distributed burst.
    MAX_MFA_ATTEMPTS = 5
    attempts_key = f"mfa:attempts:{body.ticket}"
    attempts = await redis.incr(attempts_key)
    if attempts == 1:
        await redis.expire(attempts_key, 300)
    if attempts > MAX_MFA_ATTEMPTS:
        await redis.delete(f"mfa:ticket:{body.ticket}")
        raise HTTPException(
            status_code=429,
            detail={"code": 60008, "message": "Too many invalid codes; please sign in again"},
        )

    def _invalid_code() -> HTTPException:
        return HTTPException(
            status_code=400,
            detail={"code": 60008, "message": "Invalid two-factor code"},
        )

    # Verify the TOTP code
    totp = pyotp.TOTP(mfa_resp.secret)
    if not totp.verify(body.code):
        # Also check backup codes
        backup_raw = await redis.get(f"mfa:backup:{user_id_str}")
        if backup_raw:
            backup_codes = json.loads(
                backup_raw.decode() if isinstance(backup_raw, bytes) else backup_raw
            )
            if body.code in backup_codes:
                # Consume the backup code
                backup_codes.remove(body.code)
                await redis.set(
                    f"mfa:backup:{user_id_str}", json.dumps(backup_codes)
                )
            else:
                raise _invalid_code()
        else:
            raise _invalid_code()

    # Success -- clear the attempt counter and consume the one-time ticket.
    await redis.delete(attempts_key)
    await redis.delete(f"mfa:ticket:{body.ticket}")

    # Generate auth token
    token = generate_token()
    await redis.setex(
        f"auth:token:{token}", settings.token_ttl_seconds, user_id_str
    )

    # Resync the guild-membership set from the DB (see _refresh_user_guilds), so the
    # gateway and voice-server see this session as a member of the right guilds.
    await _refresh_user_guilds(redis, await get_user_stub(), int(user_id_str))

    return TokenResponse(token=token)
