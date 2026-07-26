from pydantic import BaseModel, Field, field_validator
from typing import Optional


# Valid guild channel types
VALID_CHANNEL_TYPES = {0, 2, 4, 5, 13, 15, 16}


class PermissionOverwriteResponse(BaseModel):
    id: str
    type: int  # 0 = role, 1 = member
    allow: str  # bigint as string
    deny: str   # bigint as string


class ChannelCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: int = 0  # 0=text, 2=voice, 4=category, 5=announcement, 13=stage, 15=forum, 16=media
    parent_id: Optional[str] = None
    topic: Optional[str] = None
    nsfw: bool = False
    position: Optional[int] = None
    bitrate: Optional[int] = None  # Voice/stage channels
    user_limit: Optional[int] = None  # Voice channels max users
    rate_limit_per_user: Optional[int] = None  # Slowmode in seconds
    rtc_region: Optional[str] = None  # Voice region override
    video_quality_mode: Optional[int] = None  # 1=auto, 2=720p
    default_sort_order: Optional[int] = None  # Forum: 0=latest_activity, 1=creation_date
    default_forum_layout: Optional[int] = None  # Forum: 0=not_set, 1=list, 2=gallery
    permission_overwrites: list[PermissionOverwriteResponse] = []

    @field_validator("type")
    @classmethod
    def validate_channel_type(cls, v: int) -> int:
        if v not in VALID_CHANNEL_TYPES:
            raise ValueError(
                f"Invalid channel type {v}. Must be one of: {sorted(VALID_CHANNEL_TYPES)}"
            )
        return v


class ChannelUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    topic: Optional[str] = None
    nsfw: Optional[bool] = None
    position: Optional[int] = None
    parent_id: Optional[str] = None
    bitrate: Optional[int] = None
    user_limit: Optional[int] = None
    rate_limit_per_user: Optional[int] = None
    rtc_region: Optional[str] = None
    video_quality_mode: Optional[int] = None
    archived: Optional[bool] = None  # Thread: set archived state
    auto_archive_duration: Optional[int] = None  # Thread: 60, 1440, 4320, 10080
    locked: Optional[bool] = None  # Thread: set locked state
    default_sort_order: Optional[int] = None  # Forum channel
    default_forum_layout: Optional[int] = None  # Forum channel


class ChannelResponse(BaseModel):
    id: str
    guild_id: Optional[str] = None
    type: int
    name: Optional[str] = None
    topic: Optional[str] = None
    position: int = 0
    parent_id: Optional[str] = None
    nsfw: bool = False
    bitrate: Optional[int] = None
    user_limit: Optional[int] = None
    rate_limit_per_user: int = 0
    rtc_region: Optional[str] = None
    video_quality_mode: Optional[int] = None
    last_message_id: Optional[str] = None
    owner_id: Optional[str] = None  # Thread owner
    thread_metadata: Optional[dict] = None  # Thread metadata
    message_count: Optional[int] = None  # Thread message count
    member_count: Optional[int] = None  # Thread member count
    default_sort_order: Optional[int] = None  # Forum channel
    default_forum_layout: Optional[int] = None  # Forum channel
    available_tags: Optional[list[dict]] = None  # Forum channel tags
    last_pin_timestamp: Optional[str] = None
    default_auto_archive_duration: Optional[int] = None
    flags: int = 0
    permission_overwrites: list[PermissionOverwriteResponse] = []


class DMChannelResponse(BaseModel):
    id: str
    type: int  # 1=DM, 3=GroupDM
    recipients: list  # List of user objects
    last_message_id: Optional[str] = None


class DMCreateRequest(BaseModel):
    recipient_id: Optional[str] = None
    recipients: Optional[list[str]] = None
