from pydantic import BaseModel, Field
from typing import Optional


class GuildCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    icon: Optional[str] = None


class GuildUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    icon: Optional[str] = None
    description: Optional[str] = None
    owner_id: Optional[str] = None
    verification_level: Optional[int] = Field(default=None, ge=0, le=4)
    explicit_content_filter: Optional[int] = Field(default=None, ge=0, le=2)
    discoverable: Optional[bool] = None


class GuildResponse(BaseModel):
    id: str
    name: str
    icon: Optional[str] = None
    splash: Optional[str] = None
    discovery_splash: Optional[str] = None
    banner: Optional[str] = None
    owner_id: str
    description: Optional[str] = None
    member_count: int = 0
    afk_channel_id: Optional[str] = None
    afk_timeout: int = 300
    widget_enabled: bool = False
    widget_channel_id: Optional[str] = None
    verification_level: int = 0
    default_message_notifications: int = 0
    explicit_content_filter: int = 0
    roles: list = Field(default_factory=list)
    emojis: list = Field(default_factory=list)
    mfa_level: int = 0
    application_id: Optional[str] = None
    system_channel_id: Optional[str] = None
    system_channel_flags: int = 0
    rules_channel_id: Optional[str] = None
    max_members: int = 500000
    vanity_url_code: Optional[str] = None
    nsfw_level: int = 0
    stickers: list = Field(default_factory=list)
    premium_tier: int = 0
    premium_subscription_count: int = 0
    preferred_locale: str = "en-US"
    public_updates_channel_id: Optional[str] = None
    max_video_channel_users: int = 25
    features: list[str] = Field(default_factory=list)
    premium_progress_bar_enabled: bool = False
    safety_alerts_channel_id: Optional[str] = None
    discoverable: bool = False


class RoleResponse(BaseModel):
    id: str
    name: str
    color: int = 0
    hoist: bool = False
    icon: Optional[str] = None
    unicode_emoji: Optional[str] = None
    position: int = 0
    permissions: str  # bigint as string
    managed: bool = False
    mentionable: bool = False
    tags: Optional[dict] = None
    flags: int = 0


class MemberUserResponse(BaseModel):
    id: str
    username: str
    discriminator: str = "0"
    global_name: Optional[str] = None
    avatar: Optional[str] = None
    bot: bool = False
    flags: int = 0
    public_flags: int = 0


class MemberResponse(BaseModel):
    user: MemberUserResponse
    nick: Optional[str] = None
    avatar: Optional[str] = None  # guild-specific avatar hash
    roles: list[str] = []
    joined_at: str
    premium_since: Optional[str] = None
    deaf: bool = False
    mute: bool = False
    flags: int = 0
    pending: bool = False
    communication_disabled_until: Optional[str] = None


class RoleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    permissions: Optional[str] = "0"  # bigint as string
    color: int = 0
    hoist: bool = False
    mentionable: bool = False


class RoleUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    permissions: Optional[str] = None
    color: Optional[int] = None
    hoist: Optional[bool] = None
    mentionable: Optional[bool] = None
    position: Optional[int] = None


class InviteCreateRequest(BaseModel):
    max_age: int = 86400  # seconds, 0 = never expire
    max_uses: int = 0     # 0 = unlimited
    temporary: bool = False


class InviteResponse(BaseModel):
    code: str
    guild: Optional[dict] = None   # {id, name, icon}
    channel: Optional[dict] = None  # {id, name, type}
    inviter: Optional[dict] = None  # {id, username}
    max_age: int
    max_uses: int
    uses: int
    temporary: bool
    created_at: str
    expires_at: Optional[str] = None  # null when max_age=0 (never expires)
    approximate_member_count: Optional[int] = None  # present when with_counts=true
    approximate_presence_count: Optional[int] = None  # present when with_counts=true


class BanCreateRequest(BaseModel):
    delete_message_seconds: int = Field(default=0, ge=0, le=604800)
    reason: Optional[str] = None


class BanResponse(BaseModel):
    user: dict  # {id, username, avatar}
    reason: Optional[str] = None


class MemberUpdateRequest(BaseModel):
    nick: Optional[str] = None
    communication_disabled_until: Optional[str] = None


class PermissionOverwriteRequest(BaseModel):
    allow: str = "0"
    deny: str = "0"
    type: int  # 0 = role, 1 = member
