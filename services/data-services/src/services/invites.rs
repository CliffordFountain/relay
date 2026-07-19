use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::invite_service_server::InviteService;
use crate::proto::{
    CreateInviteRequest, DeleteInviteRequest, Empty, GetChannelInvitesRequest,
    GetGuildInvitesRequest, GetInviteRequest, GetInvitesResponse, Invite, UseInviteRequest,
    UseInviteResponse,
};

/// gRPC service implementation for invite operations.
pub struct InviteServiceImpl {
    db: PgPool,
}

impl InviteServiceImpl {
    /// Create a new InviteServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

struct InviteRow {
    code: String,
    guild_id: i64,
    channel_id: i64,
    inviter_id: Option<i64>,
    uses: i32,
    max_uses: i32,
    max_age: i32,
    temporary: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn row_to_invite(r: InviteRow) -> Invite {
    let expires_at = if r.max_age > 0 {
        Some(
            (r.created_at + chrono::Duration::seconds(r.max_age as i64)).to_rfc3339(),
        )
    } else {
        None
    };

    Invite {
        code: r.code,
        guild_id: r.guild_id,
        channel_id: r.channel_id,
        inviter_id: r.inviter_id.unwrap_or(0),
        uses: r.uses,
        max_uses: r.max_uses,
        max_age: r.max_age,
        temporary: r.temporary,
        created_at: r.created_at.to_rfc3339(),
        expires_at,
    }
}

#[tonic::async_trait]
impl InviteService for InviteServiceImpl {
    async fn get_invite(
        &self,
        request: Request<GetInviteRequest>,
    ) -> Result<Response<Invite>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            InviteRow,
            r#"SELECT code, guild_id, channel_id, inviter_id, uses, max_uses,
                      max_age, temporary, created_at
               FROM invites WHERE code = $1"#,
            req.code,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("invite not found"))?;

        Ok(Response::new(row_to_invite(row)))
    }

    async fn get_guild_invites(
        &self,
        request: Request<GetGuildInvitesRequest>,
    ) -> Result<Response<GetInvitesResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            InviteRow,
            r#"SELECT code, guild_id, channel_id, inviter_id, uses, max_uses,
                      max_age, temporary, created_at
               FROM invites WHERE guild_id = $1
               ORDER BY created_at DESC"#,
            req.guild_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let invites = rows.into_iter().map(row_to_invite).collect();
        Ok(Response::new(GetInvitesResponse { invites }))
    }

    async fn get_channel_invites(
        &self,
        request: Request<GetChannelInvitesRequest>,
    ) -> Result<Response<GetInvitesResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            InviteRow,
            r#"SELECT code, guild_id, channel_id, inviter_id, uses, max_uses,
                      max_age, temporary, created_at
               FROM invites WHERE channel_id = $1
               ORDER BY created_at DESC"#,
            req.channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let invites = rows.into_iter().map(row_to_invite).collect();
        Ok(Response::new(GetInvitesResponse { invites }))
    }

    async fn create_invite(
        &self,
        request: Request<CreateInviteRequest>,
    ) -> Result<Response<Invite>, Status> {
        let req = request.into_inner();

        // Generate a random invite code
        let code = hex::encode(rand::random::<[u8; 4]>());

        let row = sqlx::query_as!(
            InviteRow,
            r#"INSERT INTO invites (code, guild_id, channel_id, inviter_id, max_uses, max_age, temporary)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING code, guild_id, channel_id, inviter_id, uses, max_uses,
                         max_age, temporary, created_at"#,
            code,
            req.guild_id,
            req.channel_id,
            req.inviter_id,
            req.max_uses,
            req.max_age,
            req.temporary,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(row_to_invite(row)))
    }

    async fn delete_invite(
        &self,
        request: Request<DeleteInviteRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!("DELETE FROM invites WHERE code = $1", req.code)
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("invite not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn use_invite(
        &self,
        request: Request<UseInviteRequest>,
    ) -> Result<Response<UseInviteResponse>, Status> {
        let req = request.into_inner();

        struct InviteInfo {
            guild_id: i64,
            channel_id: i64,
            max_uses: i32,
            uses: i32,
        }

        let invite = sqlx::query_as!(
            InviteInfo,
            "SELECT guild_id, channel_id, max_uses, uses FROM invites WHERE code = $1",
            req.code,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("invite not found"))?;

        // Check if invite has been used up
        if invite.max_uses > 0 && invite.uses >= invite.max_uses {
            return Err(Status::permission_denied("invite has reached max uses"));
        }

        // Increment uses
        sqlx::query!(
            "UPDATE invites SET uses = uses + 1 WHERE code = $1",
            req.code,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Add user as guild member (if not already)
        sqlx::query!(
            "INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            invite.guild_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(UseInviteResponse {
            guild_id: invite.guild_id,
            channel_id: invite.channel_id,
        }))
    }
}
