use redis::AsyncCommands;
use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::member_service_server::MemberService;
use crate::proto::{
    AddMemberRequest, AddMemberRoleRequest, Empty, GetMemberCountRequest, GetMemberRequest,
    GetMemberRolesRequest, GetMemberRolesResponse, GetMembersRequest, GetMembersResponse,
    IsMemberRequest, IsMemberResponse, Member, MemberCountResponse, RemoveMemberRequest,
    RemoveMemberRoleRequest, UpdateMemberRequest, User,
};

/// gRPC service implementation for guild member operations.
pub struct MemberServiceImpl {
    db: PgPool,
    redis: redis::aio::ConnectionManager,
}

impl MemberServiceImpl {
    /// Create a new MemberServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, redis }
    }
}

struct MemberRow {
    guild_id: i64,
    user_id: i64,
    nick: Option<String>,
    avatar: Option<String>,
    joined_at: chrono::DateTime<chrono::Utc>,
    premium_since: Option<chrono::DateTime<chrono::Utc>>,
    deaf: bool,
    mute: bool,
    pending: bool,
    communication_disabled_until: Option<chrono::DateTime<chrono::Utc>>,
    // User fields
    username: String,
    display_name: Option<String>,
    user_avatar: Option<String>,
    user_banner: Option<String>,
    bio: Option<String>,
    flags: i64,
    premium_type: i16,
}

fn row_to_member(r: &MemberRow, role_ids: Vec<i64>) -> Member {
    Member {
        user: Some(User {
            id: r.user_id,
            username: r.username.clone(),
            discriminator: String::new(),
            email: String::new(),
            avatar: r.user_avatar.clone(),
            banner: r.user_banner.clone(),
            bio: r.bio.clone(),
            accent_color: None,
            pronouns: None,
            display_name: r.display_name.clone(),
            flags: r.flags,
            premium_type: r.premium_type as i32,
            verified: false,
            mfa_enabled: false,
            locale: None,
            communication_disabled_until: None,
        }),
        nick: r.nick.clone(),
        roles: role_ids,
        joined_at: r.joined_at.to_rfc3339(),
        premium_since: r.premium_since.map(|t| t.to_rfc3339()),
        deaf: r.deaf,
        mute: r.mute,
        pending: r.pending,
        communication_disabled_until: r.communication_disabled_until.map(|t| t.to_rfc3339()),
        avatar: r.avatar.clone(),
    }
}

#[tonic::async_trait]
impl MemberService for MemberServiceImpl {
    async fn get_members(
        &self,
        request: Request<GetMembersRequest>,
    ) -> Result<Response<GetMembersResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(1000).max(1) as i64;
        let after = req.after.unwrap_or(0);

        let rows = sqlx::query_as!(
            MemberRow,
            r#"SELECT gm.guild_id, gm.user_id, gm.nick, gm.avatar, gm.joined_at,
                      gm.premium_since, gm.deaf, gm.mute, gm.pending,
                      gm.communication_disabled_until,
                      u.username, u.display_name, u.avatar as user_avatar,
                      u.banner as user_banner, u.bio, u.flags, u.premium_type
               FROM guild_members gm
               INNER JOIN users u ON u.id = gm.user_id
               WHERE gm.guild_id = $1 AND gm.user_id > $2
               ORDER BY gm.user_id
               LIMIT $3"#,
            req.guild_id,
            after,
            limit,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let mut members = Vec::with_capacity(rows.len());
        for r in &rows {
            let role_ids = fetch_member_roles(&self.db, r.guild_id, r.user_id).await?;
            members.push(row_to_member(r, role_ids));
        }

        Ok(Response::new(GetMembersResponse { members }))
    }

    async fn get_member(
        &self,
        request: Request<GetMemberRequest>,
    ) -> Result<Response<Member>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            MemberRow,
            r#"SELECT gm.guild_id, gm.user_id, gm.nick, gm.avatar, gm.joined_at,
                      gm.premium_since, gm.deaf, gm.mute, gm.pending,
                      gm.communication_disabled_until,
                      u.username, u.display_name, u.avatar as user_avatar,
                      u.banner as user_banner, u.bio, u.flags, u.premium_type
               FROM guild_members gm
               INNER JOIN users u ON u.id = gm.user_id
               WHERE gm.guild_id = $1 AND gm.user_id = $2"#,
            req.guild_id,
            req.user_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("member not found"))?;

        let role_ids = fetch_member_roles(&self.db, req.guild_id, req.user_id).await?;

        Ok(Response::new(row_to_member(&row, role_ids)))
    }

    async fn get_member_count(
        &self,
        request: Request<GetMemberCountRequest>,
    ) -> Result<Response<MemberCountResponse>, Status> {
        let req = request.into_inner();

        struct CountRow {
            count: Option<i64>,
        }

        let row = sqlx::query_as!(
            CountRow,
            "SELECT COUNT(*) as count FROM guild_members WHERE guild_id = $1",
            req.guild_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(MemberCountResponse {
            count: row.count.unwrap_or(0) as i32,
        }))
    }

    async fn add_member(
        &self,
        request: Request<AddMemberRequest>,
    ) -> Result<Response<Member>, Status> {
        let req = request.into_inner();

        sqlx::query!(
            "INSERT INTO guild_members (guild_id, user_id, nick) VALUES ($1, $2, $3)",
            req.guild_id,
            req.user_id,
            req.nick,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        self.get_member(Request::new(GetMemberRequest {
            guild_id: req.guild_id,
            user_id: req.user_id,
        }))
        .await
    }

    async fn update_member(
        &self,
        request: Request<UpdateMemberRequest>,
    ) -> Result<Response<Member>, Status> {
        let req = request.into_inner();

        // Three states for the timeout: field absent (don't touch), empty string (explicit
        // clear -> NULL), or a timestamp (set). COALESCE cannot express "clear", so use a
        // touch flag + CASE instead.
        let (cdu_touch, cdu_val): (bool, Option<chrono::DateTime<chrono::Utc>>) =
            match &req.communication_disabled_until {
                None => (false, None),
                Some(s) if s.is_empty() => (true, None),
                Some(s) => (
                    true,
                    Some(
                        s.parse::<chrono::DateTime<chrono::Utc>>()
                            .map_err(|e| Status::invalid_argument(format!("invalid datetime: {e}")))?,
                    ),
                ),
            };

        let result = sqlx::query!(
            r#"UPDATE guild_members SET
                nick = COALESCE($3, nick),
                deaf = COALESCE($4, deaf),
                mute = COALESCE($5, mute),
                communication_disabled_until = CASE WHEN $7
                    THEN $6 ELSE communication_disabled_until END
               WHERE guild_id = $1 AND user_id = $2"#,
            req.guild_id,
            req.user_id,
            req.nick,
            req.deaf,
            req.mute,
            cdu_val,
            cdu_touch,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("member not found"));
        }

        self.get_member(Request::new(GetMemberRequest {
            guild_id: req.guild_id,
            user_id: req.user_id,
        }))
        .await
    }

    async fn remove_member(
        &self,
        request: Request<RemoveMemberRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2",
            req.guild_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("member not found"));
        }

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        Ok(Response::new(Empty {}))
    }

    async fn add_member_role(
        &self,
        request: Request<AddMemberRoleRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "INSERT INTO member_roles (guild_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            req.guild_id,
            req.user_id,
            req.role_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // A member's role set changed — drop cached guild + computed-permission entries so
        // the new permissions take effect immediately.
        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;
        let _: Result<(), _> = redis.del(format!("perms:{}:{}", req.guild_id, req.user_id)).await;

        Ok(Response::new(Empty {}))
    }

    async fn remove_member_role(
        &self,
        request: Request<RemoveMemberRoleRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM member_roles WHERE guild_id = $1 AND user_id = $2 AND role_id = $3",
            req.guild_id,
            req.user_id,
            req.role_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Revoking a role changes computed permissions — drop the caches immediately so the
        // revocation is enforced now, not up to 120s later.
        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;
        let _: Result<(), _> = redis.del(format!("perms:{}:{}", req.guild_id, req.user_id)).await;

        Ok(Response::new(Empty {}))
    }

    async fn get_member_roles(
        &self,
        request: Request<GetMemberRolesRequest>,
    ) -> Result<Response<GetMemberRolesResponse>, Status> {
        let req = request.into_inner();
        let role_ids = fetch_member_roles(&self.db, req.guild_id, req.user_id).await?;
        Ok(Response::new(GetMemberRolesResponse { role_ids }))
    }

    async fn is_member(
        &self,
        request: Request<IsMemberRequest>,
    ) -> Result<Response<IsMemberResponse>, Status> {
        let req = request.into_inner();

        struct ExistsRow {
            exists: Option<bool>,
        }

        let row = sqlx::query_as!(
            ExistsRow,
            "SELECT EXISTS(SELECT 1 FROM guild_members WHERE guild_id = $1 AND user_id = $2) as exists",
            req.guild_id,
            req.user_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(IsMemberResponse {
            is_member: row.exists.unwrap_or(false),
        }))
    }
}

async fn fetch_member_roles(db: &PgPool, guild_id: i64, user_id: i64) -> Result<Vec<i64>, Status> {
    struct RoleIdRow {
        role_id: i64,
    }

    let rows = sqlx::query_as!(
        RoleIdRow,
        "SELECT role_id FROM member_roles WHERE guild_id = $1 AND user_id = $2",
        guild_id,
        user_id,
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;

    Ok(rows.into_iter().map(|r| r.role_id).collect())
}
