from pydantic import BaseModel, Field
from typing import Optional


class UserRegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    email: str  # Use str not EmailStr to avoid extra dependency
    password: str = Field(min_length=8, max_length=72)
    global_name: Optional[str] = Field(default=None, max_length=32)
    date_of_birth: str  # Format: YYYY-MM-DD
    consent: bool = True


class UserLoginRequest(BaseModel):
    login: Optional[str] = None  # "login" accepts either an email or a username
    email: Optional[str] = None  # Backwards compat - also accept "email"
    password: str


class UserResponse(BaseModel):
    id: str  # Snowflake as string
    username: str
    discriminator: str = "0"  # Legacy field, always "0" for new users
    global_name: Optional[str] = None
    email: str
    avatar: Optional[str] = None
    avatar_decoration_data: Optional[dict] = None
    banner: Optional[str] = None
    bio: Optional[str] = None
    accent_color: Optional[int] = None
    pronouns: str = ""
    bot: bool = False
    system: bool = False
    mfa_enabled: bool = False
    verified: bool = False
    locale: str = "en-US"
    flags: int = 0
    public_flags: int = 0
    premium_type: int = 0


class UserSettings(BaseModel):
    locale: str = "en-US"
    theme: str = "dark"


class TokenResponse(BaseModel):
    token: str
    user_id: Optional[str] = None
    user_settings: Optional[UserSettings] = None


class AuthResponse(BaseModel):
    token: str
    user: UserResponse


class MfaChallengeResponse(BaseModel):
    user_id: str
    mfa: bool = True
    ticket: str
    totp: bool = True
    sms: bool = False
    backup: bool = True
    webauthn: Optional[str] = None


class MfaEnableResponse(BaseModel):
    secret: str
    provisioning_uri: str


class MfaVerifyRequest(BaseModel):
    secret: str
    code: str


class MfaVerifyResponse(BaseModel):
    backup_codes: list[str]


class MfaTotpRequest(BaseModel):
    code: str
    ticket: str


class DeleteAccountRequest(BaseModel):
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=72)


class VerifyEmailRequest(BaseModel):
    token: str
