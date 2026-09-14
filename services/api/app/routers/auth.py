import asyncio
import json as _json
import logging
import re
import secrets
from datetime import date, datetime, timezone

import grpc
from argon2 import PasswordHasher
from fastapi import APIRouter, Depends, HTTPException, Request

from app.models.user import (
    UserRegisterRequest, UserLoginRequest, TokenResponse, MfaChallengeResponse,
    ForgotPasswordRequest, ResetPasswordRequest, VerifyEmailRequest,
    UserSettings,
)
from app.middleware.auth import get_current_token
from app.config import settings
from app.db.connection import get_redis
from app.grpc_client import get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.services.email import (
    send_verification_email,
    send_password_reset_email,
    send_login_notification_email,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v10/auth", tags=["auth"])
ph = PasswordHasher()


def generate_token() -> str:
    """Generate a 64-char opaque hex token."""
    return secrets.token_hex(32)


def validate_username(username: str) -> bool:
    """Username rules: 2-32 chars, no @#:` characters."""
    if not 2 <= len(username) <= 32:
        return False
    if re.search(r'[@#:`]', username):
        return False
    if '..' in username:
        return False
    return True


def validate_email(email: str) -> bool:
    """Basic email validation."""
    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email))


def validate_date_of_birth(dob_str: str) -> date:
    """Parse and validate date of birth. Must be YYYY-MM-DD and user must be at least 13."""
    try:
        dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"date_of_birth": {"_errors": [{"code": "DATE_OF_BIRTH_INVALID", "message": "Date of birth must be in YYYY-MM-DD format"}]}}
        })

    today = date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if age < 13:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"date_of_birth": {"_errors": [{"code": "DATE_OF_BIRTH_UNDERAGE", "message": "You need to be 13 or older in order to use Relay"}]}}
        })

    return dob


# A tiny set of the most trivially-guessed passwords. Not a full breach list, but it blocks
# the worst offenders cheaply; the identifier checks below stop the other common weak choice.
_COMMON_PASSWORDS = {
    "password", "password1", "12345678", "123456789", "1234567890", "qwerty123",
    "11111111", "00000000", "iloveyou", "letmein1", "football", "baseball",
    "abcdefgh", "relay123", "changeme", "welcome1",
}


def _validate_password(password: str, username: str, email: str) -> str | None:
    """Return an error message for a weak password, or None if acceptable."""
    if not password or len(password) < 8:
        return "Password must be at least 8 characters"
    lowered = password.lower()
    if lowered in _COMMON_PASSWORDS:
        return "Password is too common — choose something harder to guess"
    if username and len(username) >= 3 and username.lower() in lowered:
        return "Password must not contain your username"
    local = (email.split("@")[0] if email else "").lower()
    if local and len(local) >= 3 and local in lowered:
        return "Password must not contain your email address"
    return None


@router.post("/register", status_code=201, response_model=TokenResponse)
async def register(body: UserRegisterRequest):
    if not body.consent:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"consent": {"_errors": [{"code": "CONSENT_REQUIRED", "message": "You must agree to Relay's Terms of Service and Privacy Policy"}]}}
        })

    if not validate_username(body.username):
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"username": {"_errors": [{"code": "USERNAME_INVALID", "message": "Username is invalid"}]}}
        })

    if not validate_email(body.email):
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"email": {"_errors": [{"code": "EMAIL_INVALID", "message": "Not a valid email address"}]}}
        })

    pw_error = _validate_password(body.password, body.username, body.email)
    if pw_error:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"password": {"_errors": [{"code": "PASSWORD_INVALID", "message": pw_error}]}}
        })

    dob = validate_date_of_birth(body.date_of_birth)

    password_hash = ph.hash(body.password)

    # Check email uniqueness via gRPC
    stub = await get_user_stub()
    try:
        await stub.GetUserByEmail(pb2.GetUserByEmailRequest(email=body.email))
        # If we get here, the email already exists
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"email": {"_errors": [{"code": "EMAIL_ALREADY_REGISTERED", "message": "Email is already registered"}]}}
        })
    except grpc.RpcError as exc:
        if exc.code() != grpc.StatusCode.NOT_FOUND:  # type: ignore[union-attr]
            handle_grpc_error(exc, resource="user")
        # NOT_FOUND means email is available -- continue

    # Create user via gRPC
    try:
        user = await stub.CreateUser(
            pb2.CreateUserRequest(
                username=body.username,
                email=body.email,
                password_hash=password_hash,
                date_of_birth=str(dob),
            )
        )
    except grpc.RpcError as exc:
        if exc.code() == grpc.StatusCode.ALREADY_EXISTS:  # type: ignore[union-attr]
            detail_msg = exc.details() or ""  # type: ignore[union-attr]
            if "username" in detail_msg.lower():
                raise HTTPException(status_code=400, detail={
                    "code": 50035,
                    "message": "Invalid Form Body",
                    "errors": {"username": {"_errors": [{"code": "USERNAME_ALREADY_TAKEN", "message": "Username is already taken"}]}}
                })
            raise HTTPException(status_code=400, detail={
                "code": 50035,
                "message": "Invalid Form Body",
                "errors": {"email": {"_errors": [{"code": "EMAIL_ALREADY_REGISTERED", "message": "Email is already registered"}]}}
            })
        handle_grpc_error(exc, resource="user")

    # Generate auth token and store in Redis
    token = generate_token()
    r = await get_redis()
    user_id_str = str(user.id)
    await r.setex(f"auth:token:{token}", settings.token_ttl_seconds, user_id_str)

    # Cache user data in Redis for gateway READY event
    await r.setex(
        f"auth:user:{user_id_str}:data",
        settings.token_ttl_seconds,
        _json.dumps({
            "id": user_id_str,
            "username": body.username,
            "global_name": body.global_name if hasattr(body, 'global_name') else None,
            "avatar": None,
            "discriminator": "0",
            "email": body.email,
            "verified": False,
            "mfa_enabled": False,
            "flags": 0,
            "public_flags": 0,
            "premium_type": 0,
            "locale": "en-US",
            "bio": None,
            "banner": None,
            "accent_color": None,
        }),
    )

    # Generate email verification token (24hr TTL)
    verify_token = secrets.token_hex(32)
    await r.setex(f"verify:{verify_token}", 86400, user_id_str)
    verify_url = f"{settings.public_base_url}/verify/{verify_token}"

    # Best-effort send -- registration must succeed regardless of email outcome.
    try:
        await send_verification_email(body.email, verify_url)
    except Exception:
        logger.exception("send_verification_email raised for user %s", body.username)

    return TokenResponse(token=token, user_id=user_id_str)


async def _notify_login(email: str, when: str, ip: str | None) -> None:
    """Fire-and-forget login notification. Never raises into the caller."""
    try:
        await send_login_notification_email(email, when, ip)
    except Exception:
        logger.exception("send_login_notification_email raised for %s", email)


async def _refresh_user_guilds(r, stub, user_id: int) -> None:
    """Rebuild auth:user:{id}:guilds from the authoritative DB list.

    This set is consumed by the gateway — for guild event subscriptions and as the first gate
    on a voice-join (opcode 4 requires membership before it asks the API to authorize the
    specific channel and mints the voice grant). The per-action writes on join/leave/invite
    can leave it empty for members provisioned directly in the DB (e.g. the demo seed), so we
    resync it from source on every login. Best-effort: a failure here must not break sign-in.
    """
    key = f"auth:user:{user_id}:guilds"
    try:
        resp = await stub.GetUserGuilds(pb2.GetUserGuildsRequest(user_id=user_id))
        guild_ids = [str(g.id) for g in resp.guilds]
        async with r.pipeline(transaction=True) as pipe:
            pipe.delete(key)
            if guild_ids:
                pipe.sadd(key, *guild_ids)
            await pipe.execute()
    except grpc.RpcError:
        logger.warning("GetUserGuilds failed while refreshing guild set for user %s", user_id)
    except Exception:
        logger.exception("Failed to refresh guild set for user %s", user_id)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLoginRequest, request: Request):
    # The "login"/"email" field accepts EITHER an email address OR a username:
    # users may sign in with whichever they prefer. We forward the raw
    # identifier to data-services, which resolves it by email when it contains
    # '@' and by username otherwise (see AuthenticateUser), then verifies the
    # password. We intentionally do NOT require an '@' here so plain usernames
    # are accepted.
    login_value = (body.login or body.email or "").strip()
    if not login_value:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"login": {"_errors": [{"code": "LOGIN_REQUIRED", "message": "Login field is required"}]}}
        })

    stub = await get_user_stub()
    try:
        # AuthenticateUser resolves the identifier (email or username), verifies
        # the password hash in data-services, and returns the User.
        user = await stub.AuthenticateUser(
            pb2.AuthenticateUserRequest(email=login_value, password_hash=body.password)
        )
    except grpc.RpcError:
        raise HTTPException(status_code=401, detail={
            "code": 50014,
            "message": "Invalid credentials"
        })

    r = await get_redis()
    user_id_str = str(user.id)

    # If MFA is enabled, return a challenge ticket instead of a token
    if user.mfa_enabled:
        ticket = secrets.token_hex(32)
        await r.setex(f"mfa:ticket:{ticket}", 300, user_id_str)  # 5 min TTL
        return MfaChallengeResponse(
            user_id=user_id_str,
            mfa=True,
            ticket=ticket,
            totp=True,
            sms=False,
            backup=True,
        )

    # Generate token (no MFA)
    token = generate_token()
    await r.setex(f"auth:token:{token}", settings.token_ttl_seconds, user_id_str)

    # Rebuild the user's guild-membership set from the authoritative DB list. The gateway
    # scopes guild event subscriptions by this set, and the voice-server authorizes
    # voice-channel joins against it — but the incremental writes (on join/leave/invite)
    # leave it empty for seed / DB-provisioned members, so refresh it from source at login.
    await _refresh_user_guilds(r, stub, int(user.id))

    # Cache user data in Redis for gateway READY event
    await r.setex(
        f"auth:user:{user_id_str}:data",
        settings.token_ttl_seconds,
        _json.dumps({
            "id": user_id_str,
            "username": user.username,
            "global_name": user.display_name if user.HasField("display_name") else None,
            "avatar": user.avatar if user.avatar else None,
            "discriminator": "0",
            "email": user.email if user.email else None,
            "verified": user.verified if hasattr(user, 'verified') and user.verified else False,
            "mfa_enabled": user.mfa_enabled if hasattr(user, 'mfa_enabled') and user.mfa_enabled else False,
            "flags": user.flags if hasattr(user, 'flags') else 0,
            "public_flags": user.public_flags if hasattr(user, 'public_flags') else 0,
            "premium_type": 0,
            "locale": user.locale if user.locale else "en-US",
            "bio": user.bio if hasattr(user, 'bio') and user.bio else None,
            "banner": user.banner if hasattr(user, 'banner') and user.banner else None,
            "accent_color": None,
        }),
    )

    # Best-effort "you just logged in" notification -- only when SMTP is configured
    # AND the operator has opted in. Fire-and-forget so it never slows down login.
    if settings.smtp_login_notifications and user.email:
        when = datetime.now(timezone.utc).isoformat()
        ip = request.client.host if request.client else None
        asyncio.create_task(_notify_login(user.email, when, ip))

    return TokenResponse(
        token=token,
        user_id=user_id_str,
        user_settings=UserSettings(
            locale=user.locale or 'en-US',
            theme="dark",
        ),
    )


@router.post("/logout", status_code=204)
async def logout(token: str = Depends(get_current_token)):
    r = await get_redis()
    await r.delete(f"auth:token:{token}")


@router.post("/verify", status_code=200)
async def verify_email(body: VerifyEmailRequest):
    r = await get_redis()
    user_id_bytes = await r.get(f"verify:{body.token}")
    if not user_id_bytes:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid or expired verification token",
        })

    user_id = int(user_id_bytes)
    stub = await get_user_stub()
    try:
        await stub.UpdateUser(
            pb2.UpdateUserRequest(user_id=user_id, verified=True)
        )
    except grpc.RpcError as exc:
        # If we can't actually mark the account verified, don't consume the
        # one-time token or report success -- surface the error so the user
        # can retry with the still-valid link.
        handle_grpc_error(exc, resource="user")

    # Only burn the one-time token once verified=true has been persisted.
    await r.delete(f"verify:{body.token}")
    return {"message": "Email verified successfully"}


@router.post("/forgot-password", status_code=204)
async def forgot_password(body: ForgotPasswordRequest):
    stub = await get_user_stub()
    try:
        user = await stub.GetUserByEmail(pb2.GetUserByEmailRequest(email=body.email))
    except grpc.RpcError:
        # Always return 204 to avoid email enumeration
        return

    r = await get_redis()
    reset_token = secrets.token_hex(32)
    await r.setex(f"reset:{reset_token}", 3600, str(user.id))  # 1 hour TTL

    reset_url = f"{settings.public_base_url}/reset-password/{reset_token}"

    # Best-effort send -- always return the same (empty 204) response either way
    # to avoid leaking whether the email is registered.
    try:
        await send_password_reset_email(user.email, reset_url)
    except Exception:
        logger.exception("send_password_reset_email raised for user %s", user.id)


@router.post("/reset-password", status_code=200)
async def reset_password(body: ResetPasswordRequest):
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid Form Body",
            "errors": {"new_password": {"_errors": [{"code": "PASSWORD_TOO_SHORT", "message": "Password must be at least 8 characters"}]}}
        })

    r = await get_redis()
    user_id_bytes = await r.get(f"reset:{body.token}")
    if not user_id_bytes:
        raise HTTPException(status_code=400, detail={
            "code": 50035,
            "message": "Invalid or expired reset token",
        })

    user_id = int(user_id_bytes)

    # Update password via gRPC
    new_hash = ph.hash(body.new_password)
    stub = await get_user_stub()
    try:
        await stub.UpdatePassword(
            pb2.UpdatePasswordRequest(user_id=user_id, password_hash=new_hash)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="user")

    # Delete the reset token
    await r.delete(f"reset:{body.token}")

    # Invalidate all existing sessions for this user
    cursor: int | bytes = 0
    while True:
        cursor, keys = await r.scan(cursor=int(cursor), match="auth:token:*", count=100)
        for key in keys:
            stored_id = await r.get(key)
            if stored_id and int(stored_id) == user_id:
                await r.delete(key)
        if cursor == 0:
            break

    return {"message": "Password reset successfully"}
