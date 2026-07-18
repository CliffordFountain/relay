use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::message_service_server::MessageService;
use crate::proto::{
    Attachment, CreateAttachmentRequest, CreateMessageRequest, DeleteMessageRequest,
    BulkDeleteMessagesRequest, Empty, GetMessageRequest, GetMessagesRequest,
    GetMessagesResponse, GetPinnedMessagesRequest, Message, PinMessageRequest,
    Reaction, ReactionEmoji,
    UnpinMessageRequest, UpdateMessageRequest,
    GetUserMentionsRequest, GetUserMentionsResponse, UserMention,
};

/// gRPC service implementation for message-related operations.
pub struct MessageServiceImpl {
    db: PgPool,
    _redis: redis::aio::ConnectionManager,
}

impl MessageServiceImpl {
    /// Create a new MessageServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, _redis: redis }
    }
}

struct MessageRow {
    id: i64,
    channel_id: i64,
    author_id: i64,
    content: Option<String>,
    r#type: i16,
    flags: i64,
    tts: bool,
    mention_everyone: bool,
    pinned: bool,
    edited_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    message_reference: Option<serde_json::Value>,
    nonce: Option<String>,
    embeds: serde_json::Value,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn row_to_message(r: &MessageRow) -> Message {
    let message_reference = r.message_reference.as_ref().and_then(|v| {
        Some(crate::proto::MessageReference {
            message_id: v.get("message_id")?.as_i64()?,
            channel_id: v.get("channel_id")?.as_i64().unwrap_or(r.channel_id),
            guild_id: v.get("guild_id").and_then(|g| g.as_i64()),
        })
    });

    let embeds = parse_embeds(&r.embeds);

    Message {
        id: r.id,
        channel_id: r.channel_id,
        author_id: r.author_id,
        content: r.content.clone().unwrap_or_default(),
        timestamp: r.created_at.to_rfc3339(),
        edited_timestamp: r.edited_timestamp.map(|t| t.to_rfc3339()),
        tts: r.tts,
        mention_everyone: r.mention_everyone,
        embeds,
        attachments: vec![], // Populated separately if needed
        reactions: vec![],   // Populated separately if needed
        pinned: r.pinned,
        r#type: r.r#type as i32,
        flags: r.flags,
        message_reference,
        referenced_message: None,
        nonce: r.nonce.clone(),
        mention_role_ids: vec![],
        guild_id: None,
    }
}

fn parse_embeds(val: &serde_json::Value) -> Vec<crate::proto::Embed> {
    let arr = match val.as_array() {
        Some(a) => a,
        None => return vec![],
    };
    arr.iter()
        .filter_map(|e| {
            Some(crate::proto::Embed {
                title: e.get("title").and_then(|v| v.as_str()).map(String::from),
                description: e.get("description").and_then(|v| v.as_str()).map(String::from),
                url: e.get("url").and_then(|v| v.as_str()).map(String::from),
                timestamp: e.get("timestamp").and_then(|v| v.as_str()).map(String::from),
                color: e.get("color").and_then(|v| v.as_i64()).map(|c| c as i32),
                author: None,
                fields: vec![],
                thumbnail: None,
                image: None,
                footer: None,
                r#type: e.get("type").and_then(|v| v.as_str()).map(String::from),
                site_name: e.get("site_name").and_then(|v| v.as_str()).map(String::from),
            })
        })
        .collect()
}

#[tonic::async_trait]
impl MessageService for MessageServiceImpl {
    async fn get_messages(
        &self,
        request: Request<GetMessagesRequest>,
    ) -> Result<Response<GetMessagesResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(100).max(1) as i64;

        let rows = if let Some(before) = req.before {
            sqlx::query_as!(
                MessageRow,
                r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                          mention_everyone, pinned, edited_timestamp, message_reference,
                          nonce, embeds, created_at
                   FROM messages
                   WHERE channel_id = $1 AND id < $2
                   ORDER BY id DESC LIMIT $3"#,
                req.channel_id,
                before,
                limit,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        } else if let Some(after) = req.after {
            sqlx::query_as!(
                MessageRow,
                r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                          mention_everyone, pinned, edited_timestamp, message_reference,
                          nonce, embeds, created_at
                   FROM messages
                   WHERE channel_id = $1 AND id > $2
                   ORDER BY id ASC LIMIT $3"#,
                req.channel_id,
                after,
                limit,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        } else if let Some(around) = req.around {
            // Fetch messages around a given ID using two queries
            let half = limit / 2;
            let mut before_rows = sqlx::query_as!(
                MessageRow,
                r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                          mention_everyone, pinned, edited_timestamp, message_reference,
                          nonce, embeds, created_at
                   FROM messages
                   WHERE channel_id = $1 AND id <= $2
                   ORDER BY id DESC LIMIT $3"#,
                req.channel_id,
                around,
                half + 1,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?;

            let after_rows = sqlx::query_as!(
                MessageRow,
                r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                          mention_everyone, pinned, edited_timestamp, message_reference,
                          nonce, embeds, created_at
                   FROM messages
                   WHERE channel_id = $1 AND id > $2
                   ORDER BY id ASC LIMIT $3"#,
                req.channel_id,
                around,
                half,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?;

            before_rows.extend(after_rows);
            before_rows
        } else {
            sqlx::query_as!(
                MessageRow,
                r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                          mention_everyone, pinned, edited_timestamp, message_reference,
                          nonce, embeds, created_at
                   FROM messages
                   WHERE channel_id = $1
                   ORDER BY id DESC LIMIT $2"#,
                req.channel_id,
                limit,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        };

        // Fetch attachments and reactions for all messages
        let message_ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        let attachments = fetch_attachments(&self.db, &message_ids).await?;
        let reactions = fetch_reactions(&self.db, &message_ids).await?;

        // Collect referenced message IDs for reply previews
        let ref_ids: Vec<i64> = rows
            .iter()
            .filter_map(|r| {
                r.message_reference
                    .as_ref()
                    .and_then(|v| v.get("message_id"))
                    .and_then(|v| v.as_i64())
            })
            .collect();
        let referenced_messages = fetch_referenced_messages(&self.db, &ref_ids).await?;

        let messages = rows
            .iter()
            .map(|r| {
                let mut msg = row_to_message(r);
                msg.attachments = attachments
                    .iter()
                    .filter(|a| a.message_id == r.id)
                    .map(|a| attachment_row_to_proto(a))
                    .collect();
                msg.reactions = reactions
                    .iter()
                    .filter(|rx| rx.message_id == r.id)
                    .map(reaction_row_to_proto)
                    .collect();
                // Attach referenced message for reply preview
                if let Some(ref_id) = r
                    .message_reference
                    .as_ref()
                    .and_then(|v| v.get("message_id"))
                    .and_then(|v| v.as_i64())
                {
                    if let Some(ref_msg) = referenced_messages.get(&ref_id) {
                        msg.referenced_message = Some(Box::new(ref_msg.clone()));
                    }
                }
                msg
            })
            .collect();

        Ok(Response::new(GetMessagesResponse { messages }))
    }

    async fn get_message(
        &self,
        request: Request<GetMessageRequest>,
    ) -> Result<Response<Message>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            MessageRow,
            r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                      mention_everyone, pinned, edited_timestamp, message_reference,
                      nonce, embeds, created_at
               FROM messages
               WHERE id = $1 AND channel_id = $2"#,
            req.message_id,
            req.channel_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("message not found"))?;

        let mut msg = row_to_message(&row);

        // Fetch attachments
        let att_rows = fetch_attachments(&self.db, &[row.id]).await?;
        msg.attachments = att_rows.iter().map(attachment_row_to_proto).collect();

        Ok(Response::new(msg))
    }

    async fn create_message(
        &self,
        request: Request<CreateMessageRequest>,
    ) -> Result<Response<Message>, Status> {
        let req = request.into_inner();

        let embeds_json = if req.embeds.is_empty() {
            serde_json::json!([])
        } else {
            serde_json::json!(req.embeds.iter().map(|e| {
                serde_json::json!({
                    "title": e.title,
                    "description": e.description,
                    "url": e.url,
                    "color": e.color,
                })
            }).collect::<Vec<_>>())
        };

        let message_ref = req.message_reference.as_ref().map(|r| {
            serde_json::json!({
                "message_id": r.message_id,
                "channel_id": r.channel_id,
                "guild_id": r.guild_id,
            })
        });

        let row = sqlx::query_as!(
            MessageRow,
            r#"INSERT INTO messages (channel_id, author_id, content, type, flags, tts,
                                     mention_everyone, embeds, message_reference, nonce)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING id, channel_id, author_id, content, type, flags, tts,
                         mention_everyone, pinned, edited_timestamp, message_reference,
                         nonce, embeds, created_at"#,
            req.channel_id,
            req.author_id,
            req.content,
            req.r#type.unwrap_or(0) as i16,
            req.flags.unwrap_or(0),
            req.tts,
            req.mention_everyone,
            embeds_json,
            message_ref,
            req.nonce,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let msg_id = row.id;

        // Insert attachments
        let mut proto_attachments = Vec::new();
        for att in &req.attachments {
            let att_row = sqlx::query!(
                r#"INSERT INTO attachments (message_id, filename, content_type, size, url, width, height)
                   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"#,
                msg_id,
                att.filename,
                att.content_type,
                att.size,
                att.url,
                att.width,
                att.height,
            )
            .fetch_one(&self.db)
            .await
            .map_err(sqlx_to_status)?;

            proto_attachments.push(Attachment {
                id: att_row.id,
                filename: att.filename.clone(),
                content_type: att.content_type.clone(),
                size: att.size,
                url: att.url.clone(),
                proxy_url: None,
                width: att.width,
                height: att.height,
            });
        }

        // Update channel's last_message_id
        sqlx::query!(
            "UPDATE channels SET last_message_id = $2 WHERE id = $1",
            req.channel_id,
            msg_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Insert message mentions
        for user_id in &req.mention_user_ids {
            let _ = sqlx::query!(
                "INSERT INTO message_mentions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                msg_id,
                user_id,
            )
            .execute(&self.db)
            .await;
        }

        let mut msg = row_to_message(&row);
        msg.attachments = proto_attachments;
        msg.guild_id = req.guild_id;

        Ok(Response::new(msg))
    }

    async fn update_message(
        &self,
        request: Request<UpdateMessageRequest>,
    ) -> Result<Response<Message>, Status> {
        let req = request.into_inner();

        let embeds_json = if req.embeds.is_empty() {
            None
        } else {
            Some(serde_json::json!(req.embeds.iter().map(|e| {
                serde_json::json!({
                    "title": e.title,
                    "description": e.description,
                    "url": e.url,
                    "color": e.color,
                })
            }).collect::<Vec<_>>()))
        };

        let row = sqlx::query_as!(
            MessageRow,
            r#"UPDATE messages SET
                content = COALESCE($3, content),
                embeds = COALESCE($4, embeds),
                flags = COALESCE($5, flags),
                edited_timestamp = NOW()
               WHERE id = $2 AND channel_id = $1
               RETURNING id, channel_id, author_id, content, type, flags, tts,
                         mention_everyone, pinned, edited_timestamp, message_reference,
                         nonce, embeds, created_at"#,
            req.channel_id,
            req.message_id,
            req.content,
            embeds_json,
            req.flags,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("message not found"))?;

        let mut msg = row_to_message(&row);
        let att_rows = fetch_attachments(&self.db, &[row.id]).await?;
        msg.attachments = att_rows.iter().map(attachment_row_to_proto).collect();

        Ok(Response::new(msg))
    }

    async fn delete_message(
        &self,
        request: Request<DeleteMessageRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM messages WHERE id = $1 AND channel_id = $2",
            req.message_id,
            req.channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("message not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn bulk_delete_messages(
        &self,
        request: Request<BulkDeleteMessagesRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM messages WHERE id = ANY($1) AND channel_id = $2",
            &req.message_ids,
            req.channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        Ok(Response::new(Empty {}))
    }

    async fn get_pinned_messages(
        &self,
        request: Request<GetPinnedMessagesRequest>,
    ) -> Result<Response<GetMessagesResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            MessageRow,
            r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                      mention_everyone, pinned, edited_timestamp, message_reference,
                      nonce, embeds, created_at
               FROM messages
               WHERE channel_id = $1 AND pinned = TRUE
               ORDER BY id DESC"#,
            req.channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let message_ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        let attachments = fetch_attachments(&self.db, &message_ids).await?;

        let messages = rows
            .iter()
            .map(|r| {
                let mut msg = row_to_message(r);
                msg.attachments = attachments
                    .iter()
                    .filter(|a| a.message_id == r.id)
                    .map(attachment_row_to_proto)
                    .collect();
                msg
            })
            .collect();

        Ok(Response::new(GetMessagesResponse { messages }))
    }

    async fn pin_message(
        &self,
        request: Request<PinMessageRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "UPDATE messages SET pinned = TRUE WHERE id = $1 AND channel_id = $2",
            req.message_id,
            req.channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("message not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn unpin_message(
        &self,
        request: Request<UnpinMessageRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "UPDATE messages SET pinned = FALSE WHERE id = $1 AND channel_id = $2",
            req.message_id,
            req.channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("message not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn create_attachment(
        &self,
        request: Request<CreateAttachmentRequest>,
    ) -> Result<Response<Attachment>, Status> {
        let req = request.into_inner();

        struct IdRow {
            id: i64,
        }

        let row = sqlx::query_as!(
            IdRow,
            r#"INSERT INTO attachments (message_id, filename, content_type, size, url, width, height)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"#,
            req.message_id,
            req.filename,
            req.content_type,
            req.size,
            req.url,
            req.width,
            req.height,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Attachment {
            id: row.id,
            filename: req.filename,
            content_type: req.content_type,
            size: req.size,
            url: req.url,
            proxy_url: None,
            width: req.width,
            height: req.height,
        }))
    }

    async fn get_user_mentions(
        &self,
        request: Request<GetUserMentionsRequest>,
    ) -> Result<Response<GetUserMentionsResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(100).max(1) as i64;

        let rows = sqlx::query!(
            r#"SELECT m.id, m.channel_id, m.author_id, m.content, m.type, m.flags, m.tts,
                      m.mention_everyone, m.pinned, m.edited_timestamp, m.message_reference,
                      m.nonce, m.embeds, m.created_at,
                      c.guild_id AS channel_guild_id
               FROM message_mentions mm
               JOIN messages m ON m.id = mm.message_id
               JOIN channels c ON c.id = m.channel_id
               WHERE mm.user_id = $1
               ORDER BY m.id DESC
               LIMIT $2"#,
            req.user_id,
            limit,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let mentions = rows
            .into_iter()
            .map(|r| {
                let mr = MessageRow {
                    id: r.id,
                    channel_id: r.channel_id,
                    author_id: r.author_id,
                    content: r.content,
                    r#type: r.r#type,
                    flags: r.flags,
                    tts: r.tts,
                    mention_everyone: r.mention_everyone,
                    pinned: r.pinned,
                    edited_timestamp: r.edited_timestamp,
                    message_reference: r.message_reference,
                    nonce: r.nonce,
                    embeds: r.embeds,
                    created_at: r.created_at,
                };
                let guild_id = r.channel_guild_id.unwrap_or(0);
                let mut msg = row_to_message(&mr);
                msg.guild_id = Some(guild_id);
                UserMention {
                    message: Some(msg),
                    guild_id,
                }
            })
            .collect();

        Ok(Response::new(GetUserMentionsResponse { mentions }))
    }
}

struct AttachmentRow {
    id: i64,
    message_id: i64,
    filename: String,
    content_type: Option<String>,
    size: i32,
    url: String,
    proxy_url: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
}

fn attachment_row_to_proto(r: &AttachmentRow) -> Attachment {
    Attachment {
        id: r.id,
        filename: r.filename.clone(),
        content_type: r.content_type.clone().unwrap_or_default(),
        size: r.size,
        url: r.url.clone(),
        proxy_url: r.proxy_url.clone(),
        width: r.width,
        height: r.height,
    }
}

/// Fetch referenced messages (for reply preview) keyed by message ID.
async fn fetch_referenced_messages(
    db: &PgPool,
    ref_ids: &[i64],
) -> Result<std::collections::HashMap<i64, Message>, Status> {
    if ref_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let rows = sqlx::query_as!(
        MessageRow,
        r#"SELECT id, channel_id, author_id, content, type, flags, tts,
                  mention_everyone, pinned, edited_timestamp, message_reference,
                  nonce, embeds, created_at
           FROM messages WHERE id = ANY($1)"#,
        ref_ids,
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;

    let mut map = std::collections::HashMap::new();
    for row in &rows {
        map.insert(row.id, row_to_message(row));
    }
    Ok(map)
}

async fn fetch_attachments(db: &PgPool, message_ids: &[i64]) -> Result<Vec<AttachmentRow>, Status> {
    if message_ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = sqlx::query_as!(
        AttachmentRow,
        r#"SELECT id, message_id, filename, content_type, size, url, proxy_url, width, height
           FROM attachments WHERE message_id = ANY($1)"#,
        message_ids,
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;
    Ok(rows)
}

struct ReactionRow {
    message_id: i64,
    emoji_name: String,
    emoji_id: Option<i64>,
    count: Option<i64>,
}

/// Fetch aggregated reaction counts for a batch of message IDs.
async fn fetch_reactions(db: &PgPool, message_ids: &[i64]) -> Result<Vec<ReactionRow>, Status> {
    if message_ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = sqlx::query_as!(
        ReactionRow,
        r#"SELECT message_id, emoji_name, emoji_id, COUNT(*) as count
           FROM message_reactions
           WHERE message_id = ANY($1)
           GROUP BY message_id, emoji_name, emoji_id
           ORDER BY message_id, MIN(id)"#,
        message_ids,
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;
    Ok(rows)
}

fn reaction_row_to_proto(r: &ReactionRow) -> Reaction {
    Reaction {
        count: r.count.unwrap_or(0) as i32,
        me: false, // Would need user_id context to determine this
        emoji: Some(ReactionEmoji {
            id: r.emoji_id,
            name: r.emoji_name.clone(),
        }),
    }
}
