use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::thread_service_server::ThreadService;
use crate::proto::{
    AddThreadMemberRequest, ArchiveThreadRequest, CreateThreadRequest, Empty,
    GetChannelThreadsRequest, GetForumPostsRequest, GetGuildThreadsRequest, GetThreadRequest,
    GetThreadsResponse, RemoveThreadMemberRequest, Thread, UpdateThreadRequest,
};

/// gRPC service implementation for thread operations.
///
/// Threads are stored as channels with thread_metadata JSONB.
pub struct ThreadServiceImpl {
    db: PgPool,
}

impl ThreadServiceImpl {
    /// Create a new ThreadServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

struct ThreadRow {
    id: i64,
    guild_id: Option<i64>,
    parent_id: Option<i64>,
    owner_id: Option<i64>,
    name: Option<String>,
    r#type: i16,
    rate_limit_per_user: i32,
    last_message_id: Option<i64>,
    thread_metadata: Option<serde_json::Value>,
}

fn row_to_thread(r: &ThreadRow) -> Thread {
    let meta = r.thread_metadata.as_ref();
    Thread {
        id: r.id,
        guild_id: r.guild_id.unwrap_or(0),
        parent_id: r.parent_id.unwrap_or(0),
        owner_id: r.owner_id.unwrap_or(0),
        name: r.name.clone().unwrap_or_default(),
        r#type: r.r#type as i32,
        archived: meta
            .and_then(|m| m.get("archived"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        auto_archive_duration: meta
            .and_then(|m| m.get("auto_archive_duration"))
            .and_then(|v| v.as_i64())
            .unwrap_or(1440) as i32,
        archive_timestamp: meta
            .and_then(|m| m.get("archive_timestamp"))
            .and_then(|v| v.as_str())
            .map(String::from),
        locked: meta
            .and_then(|m| m.get("locked"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        message_count: meta
            .and_then(|m| m.get("message_count"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
        member_count: meta
            .and_then(|m| m.get("member_count"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as i32,
        last_message_id: r.last_message_id,
        rate_limit_per_user: r.rate_limit_per_user,
    }
}

#[tonic::async_trait]
impl ThreadService for ThreadServiceImpl {
    async fn get_thread(
        &self,
        request: Request<GetThreadRequest>,
    ) -> Result<Response<Thread>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            ThreadRow,
            r#"SELECT id, guild_id, parent_id, owner_id, name, type,
                      rate_limit_per_user, last_message_id, thread_metadata
               FROM channels WHERE id = $1 AND type IN (11, 12)"#,
            req.thread_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("thread not found"))?;

        Ok(Response::new(row_to_thread(&row)))
    }

    async fn create_thread(
        &self,
        request: Request<CreateThreadRequest>,
    ) -> Result<Response<Thread>, Status> {
        let req = request.into_inner();

        let metadata = serde_json::json!({
            "archived": false,
            "auto_archive_duration": req.auto_archive_duration,
            "locked": false,
            "message_count": 0,
            "member_count": 1,
        });

        struct IdRow {
            id: i64,
        }

        let row = sqlx::query_as!(
            IdRow,
            r#"INSERT INTO channels (guild_id, parent_id, owner_id, name, type, thread_metadata)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id"#,
            req.guild_id,
            req.channel_id,
            req.owner_id,
            req.name,
            req.r#type as i16,
            metadata,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Add creator as thread member
        sqlx::query!(
            "INSERT INTO thread_members (channel_id, user_id) VALUES ($1, $2)",
            row.id,
            req.owner_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        self.get_thread(Request::new(GetThreadRequest {
            thread_id: row.id,
        }))
        .await
    }

    async fn update_thread(
        &self,
        request: Request<UpdateThreadRequest>,
    ) -> Result<Response<Thread>, Status> {
        let req = request.into_inner();

        // Update name if provided
        if let Some(name) = &req.name {
            sqlx::query!(
                "UPDATE channels SET name = $2 WHERE id = $1",
                req.thread_id,
                name,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        if let Some(rlpu) = req.rate_limit_per_user {
            sqlx::query!(
                "UPDATE channels SET rate_limit_per_user = $2 WHERE id = $1",
                req.thread_id,
                rlpu,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        // Update thread_metadata fields
        if req.archived.is_some() || req.auto_archive_duration.is_some() || req.locked.is_some() {
            // Read existing metadata
            struct MetaRow {
                thread_metadata: Option<serde_json::Value>,
            }

            let existing = sqlx::query_as!(
                MetaRow,
                "SELECT thread_metadata FROM channels WHERE id = $1",
                req.thread_id,
            )
            .fetch_optional(&self.db)
            .await
            .map_err(sqlx_to_status)?
            .ok_or_else(|| Status::not_found("thread not found"))?;

            let mut meta = existing
                .thread_metadata
                .unwrap_or_else(|| serde_json::json!({}));

            if let Some(archived) = req.archived {
                meta["archived"] = serde_json::json!(archived);
                if archived {
                    meta["archive_timestamp"] =
                        serde_json::json!(chrono::Utc::now().to_rfc3339());
                }
            }
            if let Some(duration) = req.auto_archive_duration {
                meta["auto_archive_duration"] = serde_json::json!(duration);
            }
            if let Some(locked) = req.locked {
                meta["locked"] = serde_json::json!(locked);
            }

            sqlx::query!(
                "UPDATE channels SET thread_metadata = $2 WHERE id = $1",
                req.thread_id,
                meta,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        self.get_thread(Request::new(GetThreadRequest {
            thread_id: req.thread_id,
        }))
        .await
    }

    async fn archive_thread(
        &self,
        request: Request<ArchiveThreadRequest>,
    ) -> Result<Response<Thread>, Status> {
        let req = request.into_inner();

        self.update_thread(Request::new(UpdateThreadRequest {
            thread_id: req.thread_id,
            name: None,
            archived: Some(true),
            auto_archive_duration: None,
            locked: Some(req.locked),
            rate_limit_per_user: None,
        }))
        .await
    }

    async fn get_channel_threads(
        &self,
        request: Request<GetChannelThreadsRequest>,
    ) -> Result<Response<GetThreadsResponse>, Status> {
        let req = request.into_inner();

        let rows = if req.archived {
            sqlx::query_as!(
                ThreadRow,
                r#"SELECT id, guild_id, parent_id, owner_id, name, type,
                          rate_limit_per_user, last_message_id, thread_metadata
                   FROM channels
                   WHERE parent_id = $1 AND type IN (11, 12)
                     AND thread_metadata->>'archived' = 'true'
                   ORDER BY id DESC"#,
                req.channel_id,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        } else {
            sqlx::query_as!(
                ThreadRow,
                r#"SELECT id, guild_id, parent_id, owner_id, name, type,
                          rate_limit_per_user, last_message_id, thread_metadata
                   FROM channels
                   WHERE parent_id = $1 AND type IN (11, 12)
                     AND (thread_metadata->>'archived' IS NULL OR thread_metadata->>'archived' = 'false')
                   ORDER BY id DESC"#,
                req.channel_id,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        };

        let threads = rows.iter().map(row_to_thread).collect();
        Ok(Response::new(GetThreadsResponse { threads }))
    }

    async fn get_guild_threads(
        &self,
        request: Request<GetGuildThreadsRequest>,
    ) -> Result<Response<GetThreadsResponse>, Status> {
        let req = request.into_inner();

        let rows = if req.archived {
            sqlx::query_as!(
                ThreadRow,
                r#"SELECT id, guild_id, parent_id, owner_id, name, type,
                          rate_limit_per_user, last_message_id, thread_metadata
                   FROM channels
                   WHERE guild_id = $1 AND type IN (11, 12)
                     AND thread_metadata->>'archived' = 'true'
                   ORDER BY id DESC"#,
                req.guild_id,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        } else {
            sqlx::query_as!(
                ThreadRow,
                r#"SELECT id, guild_id, parent_id, owner_id, name, type,
                          rate_limit_per_user, last_message_id, thread_metadata
                   FROM channels
                   WHERE guild_id = $1 AND type IN (11, 12)
                     AND (thread_metadata->>'archived' IS NULL OR thread_metadata->>'archived' = 'false')
                   ORDER BY id DESC"#,
                req.guild_id,
            )
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?
        };

        let threads = rows.iter().map(row_to_thread).collect();
        Ok(Response::new(GetThreadsResponse { threads }))
    }

    async fn add_thread_member(
        &self,
        request: Request<AddThreadMemberRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "INSERT INTO thread_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            req.thread_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Update member_count in metadata
        struct CountRow {
            count: Option<i64>,
        }
        let count = sqlx::query_as!(
            CountRow,
            "SELECT COUNT(*) as count FROM thread_members WHERE channel_id = $1",
            req.thread_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        sqlx::query!(
            r#"UPDATE channels SET thread_metadata = jsonb_set(
                   COALESCE(thread_metadata, '{}'), '{member_count}', $2::text::jsonb
               ) WHERE id = $1"#,
            req.thread_id,
            count.count.unwrap_or(0).to_string(),
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn remove_thread_member(
        &self,
        request: Request<RemoveThreadMemberRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM thread_members WHERE channel_id = $1 AND user_id = $2",
            req.thread_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn get_forum_posts(
        &self,
        request: Request<GetForumPostsRequest>,
    ) -> Result<Response<GetThreadsResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(50).max(1) as i64;

        let order_clause = if req.sort_order == "creation_date" {
            "id DESC"
        } else {
            "last_message_id DESC NULLS LAST"
        };

        // type 15 = guild_forum child threads are type 11 under a forum channel
        let query = format!(
            r#"SELECT id, guild_id, parent_id, owner_id, name, type,
                      rate_limit_per_user, last_message_id, thread_metadata
               FROM channels
               WHERE parent_id = $1 AND type = 11
                 AND (thread_metadata->>'archived' IS NULL OR thread_metadata->>'archived' = 'false')
               ORDER BY {order_clause}
               LIMIT $2"#
        );

        let rows = sqlx::query_as::<_, ThreadRow>(&query)
            .bind(req.channel_id)
            .bind(limit)
            .fetch_all(&self.db)
            .await
            .map_err(sqlx_to_status)?;

        let threads = rows.iter().map(row_to_thread).collect();
        Ok(Response::new(GetThreadsResponse { threads }))
    }
}

// Need to implement FromRow manually for ThreadRow since we use sqlx::query_as with a dynamic query
impl<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> for ThreadRow {
    fn from_row(row: &'r sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(ThreadRow {
            id: row.try_get("id")?,
            guild_id: row.try_get("guild_id")?,
            parent_id: row.try_get("parent_id")?,
            owner_id: row.try_get("owner_id")?,
            name: row.try_get("name")?,
            r#type: row.try_get("type")?,
            rate_limit_per_user: row.try_get("rate_limit_per_user")?,
            last_message_id: row.try_get("last_message_id")?,
            thread_metadata: row.try_get("thread_metadata")?,
        })
    }
}
