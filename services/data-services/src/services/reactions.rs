use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::reaction_service_server::ReactionService;
use crate::proto::{
    AddReactionRequest, Empty, GetReactionsRequest, GetReactionsResponse,
    RemoveAllReactionsRequest, RemoveEmojiReactionsRequest, RemoveReactionRequest, User,
};

/// gRPC service implementation for message reaction operations.
pub struct ReactionServiceImpl {
    db: PgPool,
}

impl ReactionServiceImpl {
    /// Create a new ReactionServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

#[tonic::async_trait]
impl ReactionService for ReactionServiceImpl {
    async fn add_reaction(
        &self,
        request: Request<AddReactionRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            r#"INSERT INTO message_reactions (message_id, user_id, emoji_name, emoji_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING"#,
            req.message_id,
            req.user_id,
            req.emoji_name,
            req.emoji_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn remove_reaction(
        &self,
        request: Request<RemoveReactionRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            r#"DELETE FROM message_reactions
               WHERE message_id = $1 AND user_id = $2 AND emoji_name = $3
                 AND COALESCE(emoji_id, 0) = COALESCE($4::BIGINT, 0)"#,
            req.message_id,
            req.user_id,
            req.emoji_name,
            req.emoji_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn remove_all_reactions(
        &self,
        request: Request<RemoveAllReactionsRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM message_reactions WHERE message_id = $1",
            req.message_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn remove_emoji_reactions(
        &self,
        request: Request<RemoveEmojiReactionsRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            r#"DELETE FROM message_reactions
               WHERE message_id = $1 AND emoji_name = $2
                 AND COALESCE(emoji_id, 0) = COALESCE($3::BIGINT, 0)"#,
            req.message_id,
            req.emoji_name,
            req.emoji_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn get_reactions(
        &self,
        request: Request<GetReactionsRequest>,
    ) -> Result<Response<GetReactionsResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(100).max(1) as i64;

        struct UserRow {
            id: i64,
            username: String,
            display_name: Option<String>,
            avatar: Option<String>,
            banner: Option<String>,
            bio: Option<String>,
            flags: i64,
            premium_type: i16,
        }

        let rows = sqlx::query_as!(
            UserRow,
            r#"SELECT u.id, u.username, u.display_name, u.avatar, u.banner, u.bio,
                      u.flags, u.premium_type
               FROM message_reactions mr
               INNER JOIN users u ON u.id = mr.user_id
               WHERE mr.message_id = $1 AND mr.emoji_name = $2
                 AND COALESCE(mr.emoji_id, 0) = COALESCE($3::BIGINT, 0)
                 AND ($4::BIGINT IS NULL OR u.id > $4)
               ORDER BY u.id
               LIMIT $5"#,
            req.message_id,
            req.emoji_name,
            req.emoji_id,
            req.after,
            limit,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let users = rows
            .into_iter()
            .map(|r| User {
                id: r.id,
                username: r.username,
                discriminator: String::new(),
                email: String::new(),
                avatar: r.avatar,
                banner: r.banner,
                bio: r.bio,
                accent_color: None,
                pronouns: None,
                display_name: r.display_name,
                flags: r.flags,
                premium_type: r.premium_type as i32,
                verified: false,
                mfa_enabled: false,
                locale: None,
                communication_disabled_until: None,
            })
            .collect();

        Ok(Response::new(GetReactionsResponse { users }))
    }
}
