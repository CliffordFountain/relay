from pydantic import BaseModel
from typing import Optional


class RelationshipResponse(BaseModel):
    id: str
    type: int  # 1=friend, 2=blocked, 3=pending_incoming, 4=pending_outgoing
    user: dict  # UserResponse-like object


class RelationshipCreateRequest(BaseModel):
    username: str  # Send friend request by username


class RelationshipPutRequest(BaseModel):
    type: Optional[int] = None  # 1 to send friend request
