use redis::AsyncCommands;
use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::permission_service_server::PermissionService;
use crate::proto::{
    ComputeChannelPermissionsRequest, ComputePermissionsRequest, GetGuildOwnerRequest,
    GetGuildOwnerResponse, PermissionsResponse,
};

/// Permission bit constants.
const ADMINISTRATOR: i64 = 0x0000_0000_0000_0008;

/// gRPC service implementation for permission computation.
pub struct PermissionServiceImpl {
    db: PgPool,
    redis: redis::aio::ConnectionManager,
}

impl PermissionServiceImpl {
    /// Create a new PermissionServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, redis }
    }
}

#[tonic::async_trait]
impl PermissionService for PermissionServiceImpl {
    async fn compute_permissions(
        &self,
        request: Request<ComputePermissionsRequest>,
    ) -> Result<Response<PermissionsResponse>, Status> {
        let req = request.into_inner();

        // Check cache
        let cache_key = format!("perms:{}:{}", req.guild_id, req.user_id);
        let mut redis = self.redis.clone();
        if let Ok(cached) = redis.get::<_, i64>(&cache_key).await {
            return Ok(Response::new(PermissionsResponse {
                permissions: cached,
            }));
        }

        // Check if user is owner -- owner has all permissions
        struct OwnerRow {
            owner_id: i64,
        }
        let guild = sqlx::query_as!(
            OwnerRow,
            "SELECT owner_id FROM guilds WHERE id = $1",
            req.guild_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("guild not found"))?;

        if guild.owner_id == req.user_id {
            let all_perms = i64::MAX;
            let _: Result<(), _> = redis.set_ex(&cache_key, all_perms, 120).await;
            return Ok(Response::new(PermissionsResponse {
                permissions: all_perms,
            }));
        }

        // Get @everyone role permissions (role with id == guild_id)
        struct PermRow {
            permissions: i64,
        }
        let everyone = sqlx::query_as!(
            PermRow,
            "SELECT permissions FROM roles WHERE id = $1 AND guild_id = $1",
            req.guild_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let mut permissions = everyone.map(|r| r.permissions).unwrap_or(0);

        // Get member's role permissions
        let role_perms = sqlx::query_as!(
            PermRow,
            r#"SELECT r.permissions FROM roles r
               INNER JOIN member_roles mr ON mr.role_id = r.id
               WHERE mr.guild_id = $1 AND mr.user_id = $2"#,
            req.guild_id,
            req.user_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        for rp in &role_perms {
            permissions |= rp.permissions;
        }

        // If administrator, grant all
        if permissions & ADMINISTRATOR != 0 {
            permissions = i64::MAX;
        }

        let _: Result<(), _> = redis.set_ex(&cache_key, permissions, 120).await;

        Ok(Response::new(PermissionsResponse { permissions }))
    }

    async fn compute_channel_permissions(
        &self,
        request: Request<ComputeChannelPermissionsRequest>,
    ) -> Result<Response<PermissionsResponse>, Status> {
        let req = request.into_inner();

        // First compute base guild permissions
        let base_resp = self
            .compute_permissions(Request::new(ComputePermissionsRequest {
                guild_id: req.guild_id,
                user_id: req.user_id,
            }))
            .await?;
        let mut permissions = base_resp.into_inner().permissions;

        // If administrator, all permissions
        if permissions & ADMINISTRATOR != 0 {
            return Ok(Response::new(PermissionsResponse { permissions }));
        }

        // Threads (types 10, 11, 12) inherit permissions from their parent
        // channel. Look up the channel type and parent_id to determine which
        // channel's permission overwrites to use.
        struct ChannelTypeRow {
            r#type: i16,
            parent_id: Option<i64>,
        }
        let channel_info = sqlx::query_as!(
            ChannelTypeRow,
            r#"SELECT type, parent_id FROM channels WHERE id = $1"#,
            req.channel_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("channel not found"))?;

        // For threads, use the parent channel's overwrites; otherwise use the
        // channel's own overwrites.
        let overwrite_channel_id = match channel_info.r#type {
            10 | 11 | 12 => channel_info
                .parent_id
                .unwrap_or(req.channel_id),
            _ => req.channel_id,
        };

        // Get channel permission overwrites
        struct OverwriteRow {
            target_id: i64,
            r#type: i16,
            allow: i64,
            deny: i64,
        }

        let overwrites = sqlx::query_as!(
            OverwriteRow,
            r#"SELECT target_id, type, allow, deny
               FROM permission_overwrites WHERE channel_id = $1"#,
            overwrite_channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Get member's role IDs
        struct RoleIdRow {
            role_id: i64,
        }
        let member_roles = sqlx::query_as!(
            RoleIdRow,
            "SELECT role_id FROM member_roles WHERE guild_id = $1 AND user_id = $2",
            req.guild_id,
            req.user_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        let role_ids: Vec<i64> = member_roles.into_iter().map(|r| r.role_id).collect();

        // Apply @everyone overwrite (type 0, target_id == guild_id)
        for ow in &overwrites {
            if ow.r#type == 0 && ow.target_id == req.guild_id {
                permissions &= !ow.deny;
                permissions |= ow.allow;
            }
        }

        // Apply role overwrites
        let mut role_allow: i64 = 0;
        let mut role_deny: i64 = 0;
        for ow in &overwrites {
            if ow.r#type == 0 && role_ids.contains(&ow.target_id) {
                role_allow |= ow.allow;
                role_deny |= ow.deny;
            }
        }
        permissions &= !role_deny;
        permissions |= role_allow;

        // Apply member-specific overwrite
        for ow in &overwrites {
            if ow.r#type == 1 && ow.target_id == req.user_id {
                permissions &= !ow.deny;
                permissions |= ow.allow;
            }
        }

        Ok(Response::new(PermissionsResponse { permissions }))
    }

    async fn get_guild_owner(
        &self,
        request: Request<GetGuildOwnerRequest>,
    ) -> Result<Response<GetGuildOwnerResponse>, Status> {
        let req = request.into_inner();

        struct OwnerRow {
            owner_id: i64,
        }

        let row = sqlx::query_as!(
            OwnerRow,
            "SELECT owner_id FROM guilds WHERE id = $1",
            req.guild_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("guild not found"))?;

        Ok(Response::new(GetGuildOwnerResponse {
            owner_id: row.owner_id,
        }))
    }
}
