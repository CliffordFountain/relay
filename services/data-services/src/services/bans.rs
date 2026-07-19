use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::ban_service_server::BanService;
use crate::proto::{
    Ban, CreateBanRequest, DeleteBanRequest, Empty, GetBanRequest, GetBansRequest,
    GetBansResponse, User,
};

/// gRPC service implementation for guild ban operations.
pub struct BanServiceImpl {
    db: PgPool,
}

impl BanServiceImpl {
    /// Create a new BanServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

struct BanRow {
    guild_id: i64,
    user_id: i64,
    reason: Option<String>,
    username: String,
    display_name: Option<String>,
    avatar: Option<String>,
    banner: Option<String>,
    bio: Option<String>,
    flags: i64,
    premium_type: i16,
}

fn row_to_ban(r: BanRow) -> Ban {
    Ban {
        guild_id: r.guild_id,
        user: Some(User {
            id: r.user_id,
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
        }),
        reason: r.reason,
    }
}

#[tonic::async_trait]
impl BanService for BanServiceImpl {
    async fn get_ban(
        &self,
        request: Request<GetBanRequest>,
    ) -> Result<Response<Ban>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            BanRow,
            r#"SELECT b.guild_id, b.user_id, b.reason,
                      u.username, u.display_name, u.avatar, u.banner, u.bio,
                      u.flags, u.premium_type
               FROM bans b
               INNER JOIN users u ON u.id = b.user_id
               WHERE b.guild_id = $1 AND b.user_id = $2"#,
            req.guild_id,
            req.user_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("ban not found"))?;

        Ok(Response::new(row_to_ban(row)))
    }

    async fn get_bans(
        &self,
        request: Request<GetBansRequest>,
    ) -> Result<Response<GetBansResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(1000).max(1) as i64;

        let rows = sqlx::query_as!(
            BanRow,
            r#"SELECT b.guild_id, b.user_id, b.reason,
                      u.username, u.display_name, u.avatar, u.banner, u.bio,
                      u.flags, u.premium_type
               FROM bans b
               INNER JOIN users u ON u.id = b.user_id
               WHERE b.guild_id = $1
                 AND ($2::BIGINT IS NULL OR b.user_id < $2)
                 AND ($3::BIGINT IS NULL OR b.user_id > $3)
               ORDER BY b.user_id
               LIMIT $4"#,
            req.guild_id,
            req.before,
            req.after,
            limit,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let bans = rows.into_iter().map(row_to_ban).collect();
        Ok(Response::new(GetBansResponse { bans }))
    }

    async fn create_ban(
        &self,
        request: Request<CreateBanRequest>,
    ) -> Result<Response<Ban>, Status> {
        let req = request.into_inner();

        // Remove member from guild if they are a member
        sqlx::query!(
            "DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2",
            req.guild_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Create the ban
        sqlx::query!(
            "INSERT INTO bans (guild_id, user_id, reason) VALUES ($1, $2, $3) ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = $3",
            req.guild_id,
            req.user_id,
            req.reason,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Delete messages if requested
        if req.delete_message_days > 0 {
            let seconds = (req.delete_message_days as i64) * 86400;
            sqlx::query!(
                r#"DELETE FROM messages
                   WHERE author_id = $1 AND channel_id IN (
                       SELECT id FROM channels WHERE guild_id = $2
                   ) AND created_at > NOW() - ($3 || ' seconds')::INTERVAL"#,
                req.user_id,
                req.guild_id,
                seconds.to_string(),
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        self.get_ban(Request::new(GetBanRequest {
            guild_id: req.guild_id,
            user_id: req.user_id,
        }))
        .await
    }

    async fn delete_ban(
        &self,
        request: Request<DeleteBanRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM bans WHERE guild_id = $1 AND user_id = $2",
            req.guild_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("ban not found"));
        }
        Ok(Response::new(Empty {}))
    }
}
