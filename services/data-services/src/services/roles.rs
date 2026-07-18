use redis::AsyncCommands;
use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::role_service_server::RoleService;
use crate::proto::{
    CreateRoleRequest, DeleteRoleRequest, Empty, GetRoleRequest, GetRolesRequest,
    GetRolesResponse, Role, UpdateRolePositionsRequest, UpdateRoleRequest,
};

/// gRPC service implementation for role operations.
pub struct RoleServiceImpl {
    db: PgPool,
    redis: redis::aio::ConnectionManager,
}

impl RoleServiceImpl {
    /// Create a new RoleServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, redis }
    }
}

struct RoleRow {
    id: i64,
    guild_id: i64,
    name: String,
    color: i32,
    hoist: bool,
    position: i32,
    permissions: i64,
    managed: bool,
    mentionable: bool,
    icon: Option<String>,
}

fn row_to_role(r: RoleRow) -> Role {
    Role {
        id: r.id,
        guild_id: r.guild_id,
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        position: r.position,
        permissions: r.permissions,
        managed: r.managed,
        mentionable: r.mentionable,
        icon: r.icon,
        unicode_emoji: None,
    }
}

#[tonic::async_trait]
impl RoleService for RoleServiceImpl {
    async fn get_roles(
        &self,
        request: Request<GetRolesRequest>,
    ) -> Result<Response<GetRolesResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            RoleRow,
            r#"SELECT id, guild_id, name, color, hoist, position, permissions,
                      managed, mentionable, icon
               FROM roles WHERE guild_id = $1
               ORDER BY position"#,
            req.guild_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let roles = rows.into_iter().map(row_to_role).collect();
        Ok(Response::new(GetRolesResponse { roles }))
    }

    async fn get_role(
        &self,
        request: Request<GetRoleRequest>,
    ) -> Result<Response<Role>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            RoleRow,
            r#"SELECT id, guild_id, name, color, hoist, position, permissions,
                      managed, mentionable, icon
               FROM roles WHERE id = $1 AND guild_id = $2"#,
            req.role_id,
            req.guild_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("role not found"))?;

        Ok(Response::new(row_to_role(row)))
    }

    async fn create_role(
        &self,
        request: Request<CreateRoleRequest>,
    ) -> Result<Response<Role>, Status> {
        let req = request.into_inner();
        // Assign the next position (highest existing + 1) so roles form a real hierarchy.
        // The incoming req.position is ignored — a newly created role always appends above
        // @everyone (position 0). Without this every role sat at 0 and role hierarchy
        // (which needs strictly-higher positions) blocked all non-owners.
        let row = sqlx::query_as!(
            RoleRow,
            r#"INSERT INTO roles (guild_id, name, color, hoist, position, permissions, mentionable)
               VALUES ($1, $2, $3, $4,
                       (SELECT COALESCE(MAX(position), 0) + 1 FROM roles WHERE guild_id = $1),
                       $5, $6)
               RETURNING id, guild_id, name, color, hoist, position, permissions,
                         managed, mentionable, icon"#,
            req.guild_id,
            req.name,
            req.color,
            req.hoist,
            req.permissions,
            req.mentionable,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        Ok(Response::new(row_to_role(row)))
    }

    async fn update_role(
        &self,
        request: Request<UpdateRoleRequest>,
    ) -> Result<Response<Role>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            RoleRow,
            r#"UPDATE roles SET
                name = COALESCE($3, name),
                color = COALESCE($4, color),
                hoist = COALESCE($5, hoist),
                permissions = COALESCE($6, permissions),
                mentionable = COALESCE($7, mentionable),
                icon = COALESCE($8, icon)
               WHERE id = $2 AND guild_id = $1
               RETURNING id, guild_id, name, color, hoist, position, permissions,
                         managed, mentionable, icon"#,
            req.guild_id,
            req.role_id,
            req.name,
            req.color,
            req.hoist,
            req.permissions,
            req.mentionable,
            req.icon,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("role not found"))?;

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;
        // A role's permission change affects every member holding it; drop their cached
        // computed permissions so the change is enforced immediately (not up to 120s later).
        let perm_keys: Vec<String> = redis
            .keys(format!("perms:{}:*", req.guild_id))
            .await
            .unwrap_or_default();
        if !perm_keys.is_empty() {
            let _: Result<(), _> = redis.del(perm_keys).await;
        }

        Ok(Response::new(row_to_role(row)))
    }

    async fn delete_role(
        &self,
        request: Request<DeleteRoleRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM roles WHERE id = $1 AND guild_id = $2",
            req.role_id,
            req.guild_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("role not found"));
        }

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;
        // Deleting a role changes the computed permissions of everyone who held it.
        let perm_keys: Vec<String> = redis
            .keys(format!("perms:{}:*", req.guild_id))
            .await
            .unwrap_or_default();
        if !perm_keys.is_empty() {
            let _: Result<(), _> = redis.del(perm_keys).await;
        }

        Ok(Response::new(Empty {}))
    }

    async fn update_role_positions(
        &self,
        request: Request<UpdateRolePositionsRequest>,
    ) -> Result<Response<GetRolesResponse>, Status> {
        let req = request.into_inner();

        for pos in &req.positions {
            sqlx::query!(
                "UPDATE roles SET position = $2 WHERE id = $1 AND guild_id = $3",
                pos.id,
                pos.position,
                req.guild_id,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        self.get_roles(Request::new(GetRolesRequest {
            guild_id: req.guild_id,
        }))
        .await
    }
}
