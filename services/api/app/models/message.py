from pydantic import BaseModel, Field
from typing import Optional, Any


class AllowedMentions(BaseModel):
    """Controls who gets mentioned in a message (matching the API)."""
    parse: list[str] = []  # "roles", "users", "everyone"
    roles: list[str] = []  # Specific role IDs to mention
    users: list[str] = []  # Specific user IDs to mention
    replied_user: bool = False  # Whether to mention the replied-to user


class MessageCreateRequest(BaseModel):
    content: str = Field(default="", max_length=4000)
    tts: bool = False
    nonce: Optional[str] = None
    enforce_nonce: bool = False  # If true, dedup using nonce
    message_reference: Optional[dict[str, Any]] = None
    allowed_mentions: Optional[AllowedMentions] = None
    flags: Optional[int] = None  # Only SUPPRESS_EMBEDS (1 << 2) and SUPPRESS_NOTIFICATIONS (1 << 12) settable


class MessageUpdateRequest(BaseModel):
    content: Optional[str] = Field(default=None, max_length=4000)
    flags: Optional[int] = None


class BulkDeleteRequest(BaseModel):
    messages: list[str] = Field(min_length=2, max_length=100)


class MessageAuthor(BaseModel):
    id: str
    username: str
    discriminator: str = "0"
    global_name: Optional[str] = None
    avatar: Optional[str] = None


class ReactionEmoji(BaseModel):
    name: str
    id: Optional[str] = None


class ReactionCountDetails(BaseModel):
    burst: int = 0
    normal: int = 0


class Reaction(BaseModel):
    emoji: ReactionEmoji
    count: int
    me: bool = False
    burst_colors: list[str] = []
    count_details: ReactionCountDetails = ReactionCountDetails()
    me_burst: bool = False


class AttachmentResponse(BaseModel):
    id: str
    filename: str
    size: int
    url: str
    proxy_url: Optional[str] = None
    content_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class MessageResponse(BaseModel):
    id: str
    channel_id: str
    guild_id: Optional[str] = None
    author: MessageAuthor
    content: str
    timestamp: str
    edited_timestamp: Optional[str] = None
    tts: bool = False
    mention_everyone: bool = False
    mentions: list[Any] = []
    mention_roles: list[str] = []
    attachments: list[AttachmentResponse] = []
    embeds: list[Any] = []
    reactions: list[Reaction] = []
    pinned: bool = False
    type: int = 0
    flags: int = 0
    nonce: Optional[str] = None
    message_reference: Optional[dict[str, Any]] = None
    referenced_message: Optional["MessageResponse"] = None
    mention_channels: Optional[list[Any]] = []
    components: Optional[list[Any]] = []
    sticker_items: Optional[list[Any]] = []
    poll: Optional[dict[str, Any]] = None
    position: Optional[int] = None


MessageResponse.model_rebuild()
