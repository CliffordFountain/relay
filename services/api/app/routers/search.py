import os
from datetime import datetime
from typing import Optional

import grpc
from fastapi import APIRouter, Depends, HTTPException, Query
from elasticsearch import AsyncElasticsearch

from app.models.message import MessageResponse
from app.middleware.auth import get_current_user_id
from app.grpc_client import get_member_stub, get_message_stub, get_user_stub, get_guild_stub
from app.grpc_stubs import relay_pb2 as pb2

router = APIRouter(prefix="/api/v10", tags=["search"])

# ---------------------------------------------------------------------------
# Elasticsearch client
# ---------------------------------------------------------------------------

es_client: AsyncElasticsearch | None = None


async def get_es() -> AsyncElasticsearch:
    global es_client
    if es_client is None:
        es_url = os.environ.get("ELASTICSEARCH_URL", "http://elasticsearch:9200")
        es_client = AsyncElasticsearch(es_url)
    return es_client


# ---------------------------------------------------------------------------
# Index helpers (called from messages.py)
# ---------------------------------------------------------------------------


async def index_message(
    message_id: int,
    channel_id: int,
    guild_id: int | None,
    author_id: int,
    content: str,
    has_attachment: bool = False,
    has_embed: bool = False,
):
    """Index a message into Elasticsearch. Safe to fire-and-forget."""
    if guild_id is None:
        return  # Only index guild messages
    try:
        es = await get_es()
        await es.index(
            index="messages",
            id=str(message_id),
            document={
                "id": message_id,
                "channel_id": channel_id,
                "guild_id": guild_id,
                "author_id": author_id,
                "content": content,
                "created_at": datetime.utcnow().isoformat(),
                "has_attachment": has_attachment,
                "has_embed": has_embed,
            },
        )
    except Exception:
        # Indexing failure should never break message creation
        pass


async def delete_message_index(message_id: int):
    """Remove a message from the Elasticsearch index."""
    try:
        es = await get_es()
        await es.delete(index="messages", id=str(message_id), ignore=[404])
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Search query builder
# ---------------------------------------------------------------------------


async def _search_messages(
    guild_id: int,
    content: str | None = None,
    author_id: int | None = None,
    channel_id: int | None = None,
    channel_ids: list[int] | None = None,
    has: str | None = None,
    before: str | None = None,
    after: str | None = None,
    sort_by: str = "timestamp",
    offset: int = 0,
    limit: int = 25,
):
    es = await get_es()
    query: dict = {"bool": {"must": [{"term": {"guild_id": guild_id}}]}}

    if content:
        query["bool"]["must"].append({"match": {"content": content}})
    if author_id:
        query["bool"]["must"].append({"term": {"author_id": author_id}})
    if channel_id:
        query["bool"]["must"].append({"term": {"channel_id": channel_id}})
    if channel_ids is not None:
        # Restrict the whole query (hits AND the total count) to channels the searcher can
        # VIEW, so the result never reveals how many messages exist in channels they can't see.
        query["bool"]["must"].append({"terms": {"channel_id": channel_ids}})
    if has == "file":
        query["bool"]["must"].append({"term": {"has_attachment": True}})
    if has == "embed":
        query["bool"]["must"].append({"term": {"has_embed": True}})
    if has == "link":
        query["bool"]["must"].append(
            {"match": {"content": {"query": "http:// OR https://", "operator": "or"}}}
        )
    if before:
        query["bool"]["must"].append({"range": {"created_at": {"lt": before}}})
    if after:
        query["bool"]["must"].append({"range": {"created_at": {"gt": after}}})

    # Determine sort
    if sort_by == "relevance" and content:
        sort = [{"_score": "desc"}, {"created_at": "desc"}]
    else:
        sort = [{"created_at": "desc"}]

    result = await es.search(
        index="messages",
        query=query,
        from_=offset,
        size=limit,
        sort=sort,
    )
    return result


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/guilds/{guild_id}/messages/search")
async def search_guild_messages(
    guild_id: int,
    content: Optional[str] = Query(None),
    author_id: Optional[int] = Query(None),
    channel_id: Optional[int] = Query(None),
    has: Optional[str] = Query(None, regex="^(file|embed|link)$"),
    before: Optional[str] = Query(None),
    after: Optional[str] = Query(None),
    sort_by: str = Query("timestamp", regex="^(timestamp|relevance)$"),
    offset: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=25),
    user_id: str = Depends(get_current_user_id),
):
    """Search messages within a guild. Requires guild membership."""
    # Verify guild membership via gRPC
    member_stub = await get_member_stub()
    try:
        resp = await member_stub.IsMember(
            pb2.IsMemberRequest(guild_id=guild_id, user_id=int(user_id))
        )
        if not resp.is_member:
            raise HTTPException(
                status_code=403,
                detail={"code": 50001, "message": "Missing Access"},
            )
    except grpc.RpcError:
        raise HTTPException(
            status_code=403,
            detail={"code": 50001, "message": "Missing Access"},
        )

    # Compute the channels the searcher can VIEW and scope the search to them, so the result
    # (content AND the total count) never reveals messages in channels they can't see. A
    # targeted channel_id must itself be viewable.
    from app.services.permissions import compute_channel_permissions, has_permission, VIEW_CHANNEL
    guild_stub = await get_guild_stub()
    try:
        chans = await guild_stub.GetGuildChannels(pb2.GetGuildChannelsRequest(guild_id=guild_id))
        all_channel_ids = [int(c.id) for c in chans.channels]
    except grpc.RpcError:
        all_channel_ids = []
    viewable: list[int] = []
    for cid in all_channel_ids:
        try:
            perms = await compute_channel_permissions(guild_id, cid, int(user_id))
            if has_permission(perms, VIEW_CHANNEL):
                viewable.append(cid)
        except Exception:
            pass
    if channel_id is not None:
        if channel_id not in viewable:
            return {"total_results": 0, "messages": []}
        channel_scope = [channel_id]
    else:
        channel_scope = viewable
    if not channel_scope:
        return {"total_results": 0, "messages": []}

    try:
        result = await _search_messages(
            guild_id=guild_id,
            content=content,
            author_id=author_id,
            channel_id=channel_id,
            channel_ids=channel_scope,
            has=has,
            before=before,
            after=after,
            sort_by=sort_by,
            offset=offset,
            limit=limit,
        )
    except Exception:
        # Return empty results when Elasticsearch is unavailable
        return {"total_results": 0, "messages": []}

    total_results = result["hits"]["total"]["value"]

    # Build message responses from ES hits by fetching full data from gRPC
    from app.routers.messages import _build_message_response_from_proto

    msg_stub = await get_message_stub()
    user_stub = await get_user_stub()

    # The query is already scoped to channel_scope; keep a cheap set-lookup guard against any
    # index skew (a message indexed under a channel no longer in the viewable set).
    viewable_set = set(channel_scope)

    messages: list[list] = []
    for hit in result["hits"]["hits"]:
        doc = hit["_source"]
        msg_id = doc["id"]
        ch_id = doc["channel_id"]

        if int(ch_id) not in viewable_set:
            continue

        try:
            msg = await msg_stub.GetMessage(
                pb2.GetMessageRequest(channel_id=ch_id, message_id=msg_id)
            )
            msg_resp = _build_message_response_from_proto(msg, guild_id=guild_id)
            # Each result is wrapped in an array (message + context)
            messages.append([msg_resp.model_dump()])
        except grpc.RpcError:
            pass

    return {"total_results": total_results, "messages": messages}
