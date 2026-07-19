use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::relationship_service_server::RelationshipService;
use crate::proto::{
    DeleteRelationshipRequest, Empty, GetMutualFriendsRequest, GetMutualGuildsRequest,
    GetMutualGuildsResponse, GetRelationshipRequest, GetRelationshipsRequest,
    GetRelationshipsResponse, GetUserByUsernameRequest, GuildSummary, Relationship,
    UpsertRelationshipRequest, User,
};

/// gRPC service implementation for user relationship operations.
pub struct RelationshipServiceImpl {
    db: PgPool,
}

impl RelationshipServiceImpl {
    /// Create a new RelationshipServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

struct RelRow {
    id: i64,
    user_id: i64,
    target_id: i64,
    r#type: i16,
    // target user info
    username: String,
    display_name: Option<String>,
    avatar: Option<String>,
    banner: Option<String>,
    bio: Option<String>,
    flags: i64,
    premium_type: i16,
}

fn row_to_relationship(r: RelRow) -> Relationship {
    Relationship {
        id: r.id,
        user_id: r.user_id,
        target_id: r.target_id,
        r#type: r.r#type as i32,
        user: Some(User {
            id: r.target_id,
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
    }
}

#[tonic::async_trait]
impl RelationshipService for RelationshipServiceImpl {
    async fn get_relationships(
        &self,
        request: Request<GetRelationshipsRequest>,
    ) -> Result<Response<GetRelationshipsResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            RelRow,
            r#"SELECT r.id, r.user_id, r.target_id, r.type,
                      u.username, u.display_name, u.avatar, u.banner, u.bio,
                      u.flags, u.premium_type
               FROM relationships r
               INNER JOIN users u ON u.id = r.target_id
               WHERE r.user_id = $1
               ORDER BY r.created_at DESC"#,
            req.user_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let relationships = rows.into_iter().map(row_to_relationship).collect();
        Ok(Response::new(GetRelationshipsResponse { relationships }))
    }

    async fn get_relationship(
        &self,
        request: Request<GetRelationshipRequest>,
    ) -> Result<Response<Relationship>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            RelRow,
            r#"SELECT r.id, r.user_id, r.target_id, r.type,
                      u.username, u.display_name, u.avatar, u.banner, u.bio,
                      u.flags, u.premium_type
               FROM relationships r
               INNER JOIN users u ON u.id = r.target_id
               WHERE r.user_id = $1 AND r.target_id = $2"#,
            req.user_id,
            req.target_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("relationship not found"))?;

        Ok(Response::new(row_to_relationship(row)))
    }

    async fn upsert_relationship(
        &self,
        request: Request<UpsertRelationshipRequest>,
    ) -> Result<Response<Relationship>, Status> {
        let req = request.into_inner();

        sqlx::query!(
            r#"INSERT INTO relationships (user_id, target_id, type)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id, target_id) DO UPDATE SET type = $3"#,
            req.user_id,
            req.target_id,
            req.r#type as i16,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        self.get_relationship(Request::new(GetRelationshipRequest {
            user_id: req.user_id,
            target_id: req.target_id,
        }))
        .await
    }

    async fn delete_relationship(
        &self,
        request: Request<DeleteRelationshipRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM relationships WHERE user_id = $1 AND target_id = $2",
            req.user_id,
            req.target_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("relationship not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn get_mutual_friends(
        &self,
        request: Request<GetMutualFriendsRequest>,
    ) -> Result<Response<GetRelationshipsResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            RelRow,
            r#"SELECT r1.id, r1.user_id, r1.target_id, r1.type,
                      u.username, u.display_name, u.avatar, u.banner, u.bio,
                      u.flags, u.premium_type
               FROM relationships r1
               INNER JOIN relationships r2 ON r2.user_id = $2 AND r2.target_id = r1.target_id
               INNER JOIN users u ON u.id = r1.target_id
               WHERE r1.user_id = $1 AND r1.type = 1 AND r2.type = 1"#,
            req.user_id,
            req.target_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let relationships = rows.into_iter().map(row_to_relationship).collect();
        Ok(Response::new(GetRelationshipsResponse { relationships }))
    }

    async fn get_user_by_username(
        &self,
        request: Request<GetUserByUsernameRequest>,
    ) -> Result<Response<User>, Status> {
        let req = request.into_inner();

        // Look the user up by username case-insensitively. Usernames are stored
        // case-preserving with a UNIQUE(username) constraint, but Relay treats
        // them case-insensitively for lookup (see the idx_users_lower_username
        // functional index), so a mismatched case must still resolve.
        struct UserLookupRow {
            id: i64,
            username: String,
            display_name: Option<String>,
            avatar: Option<String>,
            banner: Option<String>,
            bio: Option<String>,
            flags: i64,
            premium_type: i16,
        }

        let row = sqlx::query_as!(
            UserLookupRow,
            r#"SELECT id, username, display_name, avatar, banner, bio, flags, premium_type
               FROM users
               WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL"#,
            req.username,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("user not found"))?;

        Ok(Response::new(User {
            id: row.id,
            username: row.username,
            discriminator: String::new(),
            email: String::new(),
            avatar: row.avatar,
            banner: row.banner,
            bio: row.bio,
            accent_color: None,
            pronouns: None,
            display_name: row.display_name,
            flags: row.flags,
            premium_type: row.premium_type as i32,
            verified: false,
            mfa_enabled: false,
            locale: None,
            communication_disabled_until: None,
        }))
    }

    async fn get_mutual_guilds(
        &self,
        request: Request<GetMutualGuildsRequest>,
    ) -> Result<Response<GetMutualGuildsResponse>, Status> {
        let req = request.into_inner();

        struct GuildRow {
            id: i64,
            name: String,
            icon: Option<String>,
            owner_id: i64,
        }

        let rows = sqlx::query_as!(
            GuildRow,
            r#"SELECT g.id, g.name, g.icon, g.owner_id
               FROM guilds g
               INNER JOIN guild_members gm1 ON gm1.guild_id = g.id AND gm1.user_id = $1
               INNER JOIN guild_members gm2 ON gm2.guild_id = g.id AND gm2.user_id = $2"#,
            req.user_id,
            req.target_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let guilds = rows
            .into_iter()
            .map(|r| GuildSummary {
                id: r.id,
                name: r.name,
                icon: r.icon,
                owner_id: r.owner_id,
            })
            .collect();

        Ok(Response::new(GetMutualGuildsResponse { guilds }))
    }
}
