from pydantic import BaseModel
from typing import Optional


class NotificationSettingsRequest(BaseModel):
    muted: Optional[bool] = None
    message_notifications: Optional[int] = None  # 0=all, 1=mentions, 2=nothing
    suppress_everyone: Optional[bool] = None
    suppress_roles: Optional[bool] = None


class NotificationSettingsResponse(BaseModel):
    guild_id: Optional[str] = None
    channel_id: Optional[str] = None
    muted: bool = False
    message_notifications: int = 0
    suppress_everyone: bool = False
    suppress_roles: bool = False
