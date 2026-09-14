import hashlib
import json
import secrets

import grpc
import pyotp
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

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


class MfaDisableRequest(BaseModel):
    # A current TOTP code OR an unused backup code — proves possession of the second
    # factor so a stolen session token alone can't turn MFA off.
    code: str


def _hash_backup_code(code: str) -> str:
    """Backup codes are stored hashed so a Redis dump doesn't reveal usable codes."""
    return hashlib.sha256(code.strip().encode()).hexdigest()


async def _consume_backup_code(redis, user_id: str, code: str) -> bool:
    """Return True and burn the code if it matches an unused (hashed) backup code."""
    raw = await redis.get(f"mfa:backup:{user_id}")
    if not raw:
        return False
    stored = json.loads(raw.decode() if isinstance(raw, bytes) else raw)
    h = _hash_backup_code(code)
    if h in stored:
        stored.remove(h)
        await redis.set(f"mfa:backup:{user_id}", json.dumps(stored))
        return True
    return False


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

    # Generate 10 backup codes (8-char hex each). Show them once (plaintext) but store only
    # their hashes, so a Redis/DB compromise doesn't hand an attacker working backup codes.
    backup_codes = [secrets.token_hex(4) for _ in range(10)]
    redis = await get_redis()
    await redis.set(f"mfa:backup:{user_id}", json.dumps([_hash_backup_code(c) for c in backup_codes]))

    return MfaVerifyResponse(backup_codes=backup_codes)


@router.post("/@me/mfa/totp/disable", status_code=204)
async def disable_totp(body: MfaDisableRequest, user_id: str = Depends(get_current_user_id)):
    """Disable MFA — requires a current TOTP or backup code (re-auth of the second factor),
    so a stolen session token alone cannot defeat MFA."""
    user_stub = await get_user_stub()
    try:
        mfa_resp = await user_stub.GetMfaSecret(pb2.GetMfaSecretRequest(user_id=int(user_id)))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    if not mfa_resp.enabled or not mfa_resp.secret:
        raise HTTPException(status_code=400, detail={"code": 60002, "message": "MFA is not enabled"})

    redis = await get_redis()
    verified = pyotp.TOTP(mfa_resp.secret).verify(body.code) or await _consume_backup_code(redis, user_id, body.code)
    if not verified:
        raise HTTPException(status_code=400, detail={"code": 60008, "message": "Invalid two-factor code"})

    try:
        await user_stub.DisableMfa(pb2.DisableMfaRequest(user_id=int(user_id)))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

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

    # Verify the TOTP code, or fall back to a one-time (hashed) backup code.
    totp = pyotp.TOTP(mfa_resp.secret)
    if not totp.verify(body.code):
        if not await _consume_backup_code(redis, user_id_str, body.code):
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
