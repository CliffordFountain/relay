from pydantic import BaseModel, Field
from typing import Optional


class ThreadMessageContent(BaseModel):
    content: str = ""


class ThreadCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    auto_archive_duration: Optional[int] = 1440  # minutes: 60, 1440, 4320, 10080
    type: Optional[int] = 11  # 11=public, 12=private
    message: Optional[ThreadMessageContent] = None  # For forum posts: {content: "..."}


class ThreadMetadata(BaseModel):
    archived: bool = False
    auto_archive_duration: int = 1440
    archive_timestamp: Optional[str] = None
    locked: bool = False
    create_timestamp: str


class ThreadChannelResponse(BaseModel):
    id: str
    guild_id: Optional[str] = None
    type: int
    name: Optional[str] = None
    parent_id: Optional[str] = None
    owner_id: Optional[str] = None
    last_message_id: Optional[str] = None
    thread_metadata: Optional[ThreadMetadata] = None
    message_count: int = 0
    member_count: int = 0
    total_message_sent: int = 0
    newly_created: Optional[bool] = None  # Included on THREAD_CREATE event (not GET)
    message: Optional[dict] = None  # Forum post starter message (only on forum thread creation)


class ArchivedThreadsResponse(BaseModel):
    threads: list[ThreadChannelResponse]
    has_more: bool = False


class FollowResponse(BaseModel):
    channel_id: str
    webhook_id: str
