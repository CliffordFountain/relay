use redis::AsyncCommands;
use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::channel_service_server::ChannelService;
use crate::proto::{
    AddDmMemberRequest, Channel, CreateChannelRequest, CreateGroupDmRequest,
    DeleteChannelRequest, DeletePermissionOverwriteRequest, Empty, GetChannelOverwritesRequest,
    GetChannelRequest, GetChannelsResponse, GetDmChannelsRequest, GetDmMembersRequest,
    GetDmMembersResponse, GetOrCreateDmRequest, GetOverwritesResponse, PermissionOverwrite,
    RemoveDmMemberRequest, UpdateChannelPositionsRequest, UpdateChannelRequest,
    UpsertPermissionOverwriteRequest,
    FollowChannelRequest, FollowChannelResponse, ChannelFollower,
    GetChannelFollowersRequest, GetChannelFollowersResponse, UnfollowChannelRequest,
};

/// gRPC service implementation for channel-related operations.
pub struct ChannelServiceImpl {
    db: PgPool,
    redis: redis::aio::ConnectionManager,
}

impl ChannelServiceImpl {
    /// Create a new ChannelServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, redis }
    }
}

struct ChannelRow {
    id: i64,
    r#type: i16,
    guild_id: Option<i64>,
    name: Option<String>,
    topic: Option<String>,
    nsfw: bool,
    last_message_id: Option<i64>,
    position: i32,
    bitrate: Option<i32>,
    user_limit: Option<i32>,
    rate_limit_per_user: i32,
    parent_id: Option<i64>,
    rtc_region: Option<String>,
    video_quality_mode: i16,
    icon: Option<String>,
    owner_id: Option<i64>,
}

fn row_to_channel(r: ChannelRow) -> Channel {
    Channel {
        id: r.id,
        r#type: r.r#type as i32,
        guild_id: r.guild_id,
        name: r.name.unwrap_or_default(),
        topic: r.topic,
        nsfw: r.nsfw,
        last_message_id: r.last_message_id,
        position: r.position,
        bitrate: r.bitrate.unwrap_or(0),
        user_limit: r.user_limit.unwrap_or(0),
        rate_limit_per_user: r.rate_limit_per_user,
        parent_id: r.parent_id,
        permission_overwrites: vec![],
        rtc_region: r.rtc_region,
        video_quality_mode: Some(r.video_quality_mode as i32),
        icon: r.icon,
        owner_id: r.owner_id.map(|id| id.to_string()),
    }
}

#[tonic::async_trait]
impl ChannelService for ChannelServiceImpl {
    async fn get_channel(
        &self,
        request: Request<GetChannelRequest>,
    ) -> Result<Response<Channel>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            ChannelRow,
            r#"SELECT id, type, guild_id, name, topic, nsfw, last_message_id,
                      position, bitrate, user_limit, rate_limit_per_user,
                      parent_id, rtc_region, video_quality_mode, icon, owner_id
               FROM channels WHERE id = $1"#,
            req.channel_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("channel not found"))?;

        let mut channel = row_to_channel(row);

        // Fetch permission overwrites
        channel.permission_overwrites = fetch_overwrites(&self.db, req.channel_id).await?;

        Ok(Response::new(channel))
    }

    async fn create_channel(
        &self,
        request: Request<CreateChannelRequest>,
    ) -> Result<Response<Channel>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            ChannelRow,
            r#"INSERT INTO channels (guild_id, name, type, topic, nsfw, bitrate, user_limit,
                                     rate_limit_per_user, parent_id, position)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING id, type, guild_id, name, topic, nsfw, last_message_id,
                         position, bitrate, user_limit, rate_limit_per_user,
                         parent_id, rtc_region, video_quality_mode, icon, owner_id"#,
            req.guild_id,
            req.name,
            req.r#type as i16,
            req.topic,
            req.nsfw,
            if req.bitrate > 0 { Some(req.bitrate) } else { None },
            if req.user_limit > 0 { Some(req.user_limit) } else { None },
            req.rate_limit_per_user,
            req.parent_id,
            req.position,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let channel_id = row.id;
        let mut channel = row_to_channel(row);

        // Insert permission overwrites
        for ow in &req.permission_overwrites {
            sqlx::query!(
                r#"INSERT INTO permission_overwrites (channel_id, type, target_id, allow, deny)
                   VALUES ($1, $2, $3, $4, $5)"#,
                channel_id,
                ow.r#type as i16,
                ow.id,
                ow.allow,
                ow.deny,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        channel.permission_overwrites = req.permission_overwrites;

        // Invalidate guild cache
        if let Some(guild_id) = channel.guild_id {
            let mut redis = self.redis.clone();
            let _: Result<(), _> = redis.del(format!("guild:{guild_id}")).await;
        }

        Ok(Response::new(channel))
    }

    async fn update_channel(
        &self,
        request: Request<UpdateChannelRequest>,
    ) -> Result<Response<Channel>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            ChannelRow,
            r#"UPDATE channels SET
                name = COALESCE($2, name),
                topic = COALESCE($3, topic),
                nsfw = COALESCE($4, nsfw),
                bitrate = COALESCE($5, bitrate),
                user_limit = COALESCE($6, user_limit),
                rate_limit_per_user = COALESCE($7, rate_limit_per_user),
                parent_id = COALESCE($8, parent_id),
                position = COALESCE($9, position),
                rtc_region = COALESCE($10, rtc_region),
                video_quality_mode = COALESCE($11, video_quality_mode)
               WHERE id = $1
               RETURNING id, type, guild_id, name, topic, nsfw, last_message_id,
                         position, bitrate, user_limit, rate_limit_per_user,
                         parent_id, rtc_region, video_quality_mode, icon, owner_id"#,
            req.channel_id,
            req.name,
            req.topic,
            req.nsfw,
            req.bitrate,
            req.user_limit,
            req.rate_limit_per_user,
            req.parent_id,
            req.position,
            req.rtc_region,
            req.video_quality_mode.map(|v| v as i16),
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("channel not found"))?;

        let mut channel = row_to_channel(row);
        channel.permission_overwrites = fetch_overwrites(&self.db, req.channel_id).await?;

        if let Some(guild_id) = channel.guild_id {
            let mut redis = self.redis.clone();
            let _: Result<(), _> = redis.del(format!("guild:{guild_id}")).await;
        }

        Ok(Response::new(channel))
    }

    async fn delete_channel(
        &self,
        request: Request<DeleteChannelRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();

        // Get guild_id before deleting for cache invalidation
        struct GuildIdRow {
            guild_id: Option<i64>,
        }
        let guild_row = sqlx::query_as!(
            GuildIdRow,
            "SELECT guild_id FROM channels WHERE id = $1",
            req.channel_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let result = sqlx::query!("DELETE FROM channels WHERE id = $1", req.channel_id)
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("channel not found"));
        }

        if let Some(row) = guild_row {
            if let Some(guild_id) = row.guild_id {
                let mut redis = self.redis.clone();
                let _: Result<(), _> = redis.del(format!("guild:{guild_id}")).await;
            }
        }

        Ok(Response::new(Empty {}))
    }

    async fn get_channel_overwrites(
        &self,
        request: Request<GetChannelOverwritesRequest>,
    ) -> Result<Response<GetOverwritesResponse>, Status> {
        let req = request.into_inner();
        let overwrites = fetch_overwrites(&self.db, req.channel_id).await?;
        Ok(Response::new(GetOverwritesResponse { overwrites }))
    }

    async fn upsert_permission_overwrite(
        &self,
        request: Request<UpsertPermissionOverwriteRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            r#"INSERT INTO permission_overwrites (channel_id, type, target_id, allow, deny)
               VALUES ($1, $3, $2, $4, $5)
               ON CONFLICT (channel_id, type, target_id) DO UPDATE SET allow = $4, deny = $5"#,
            req.channel_id,
            req.overwrite_id,
            req.r#type as i16,
            req.allow,
            req.deny,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn delete_permission_overwrite(
        &self,
        request: Request<DeletePermissionOverwriteRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM permission_overwrites WHERE channel_id = $1 AND target_id = $2",
            req.channel_id,
            req.overwrite_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("permission overwrite not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn get_dm_channels(
        &self,
        request: Request<GetDmChannelsRequest>,
    ) -> Result<Response<GetChannelsResponse>, Status> {
        let req = request.into_inner();

        let rows = sqlx::query_as!(
            ChannelRow,
            r#"SELECT c.id, c.type, c.guild_id, c.name, c.topic, c.nsfw,
                      c.last_message_id, c.position, c.bitrate, c.user_limit,
                      c.rate_limit_per_user, c.parent_id, c.rtc_region,
                      c.video_quality_mode, c.icon, c.owner_id
               FROM channels c
               INNER JOIN dm_channels dc ON dc.channel_id = c.id
               WHERE dc.user_id = $1
               ORDER BY c.last_message_id DESC NULLS LAST"#,
            req.user_id
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let channels = rows.into_iter().map(row_to_channel).collect();
        Ok(Response::new(GetChannelsResponse { channels }))
    }

    async fn get_or_create_dm(
        &self,
        request: Request<GetOrCreateDmRequest>,
    ) -> Result<Response<Channel>, Status> {
        let req = request.into_inner();

        // Check if DM channel already exists between these two users
        struct DmRow {
            channel_id: i64,
        }

        let existing = sqlx::query_as!(
            DmRow,
            r#"SELECT dc1.channel_id
               FROM dm_channels dc1
               INNER JOIN dm_channels dc2 ON dc1.channel_id = dc2.channel_id
               WHERE dc1.user_id = $1 AND dc2.user_id = $2
               AND (SELECT type FROM channels WHERE id = dc1.channel_id) = 1
               LIMIT 1"#,
            req.user_id,
            req.target_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if let Some(dm) = existing {
            return self
                .get_channel(Request::new(GetChannelRequest {
                    channel_id: dm.channel_id,
                }))
                .await;
        }

        // Create new DM channel (type = 1)
        struct IdRow {
            id: i64,
        }

        let channel_row = sqlx::query_as!(
            IdRow,
            "INSERT INTO channels (type) VALUES (1) RETURNING id"
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Add both users to dm_channels
        sqlx::query!(
            "INSERT INTO dm_channels (channel_id, user_id) VALUES ($1, $2), ($1, $3)",
            channel_row.id,
            req.user_id,
            req.target_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        self.get_channel(Request::new(GetChannelRequest {
            channel_id: channel_row.id,
        }))
        .await
    }

    async fn create_group_dm(
        &self,
        request: Request<CreateGroupDmRequest>,
    ) -> Result<Response<Channel>, Status> {
        let req = request.into_inner();

        struct IdRow {
            id: i64,
        }

        // type 3 = group_dm
        let channel_row = sqlx::query_as!(
            IdRow,
            "INSERT INTO channels (type, name, owner_id) VALUES (3, $1, $2) RETURNING id",
            req.name,
            req.owner_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Add owner
        sqlx::query!(
            "INSERT INTO dm_channels (channel_id, user_id) VALUES ($1, $2)",
            channel_row.id,
            req.owner_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Add other users
        for user_id in &req.user_ids {
            sqlx::query!(
                "INSERT INTO dm_channels (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                channel_row.id,
                user_id,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        self.get_channel(Request::new(GetChannelRequest {
            channel_id: channel_row.id,
        }))
        .await
    }

    async fn add_dm_member(
        &self,
        request: Request<AddDmMemberRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "INSERT INTO dm_channels (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            req.channel_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        Ok(Response::new(Empty {}))
    }

    async fn remove_dm_member(
        &self,
        request: Request<RemoveDmMemberRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM dm_channels WHERE channel_id = $1 AND user_id = $2",
            req.channel_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        Ok(Response::new(Empty {}))
    }

    async fn get_dm_members(
        &self,
        request: Request<GetDmMembersRequest>,
    ) -> Result<Response<GetDmMembersResponse>, Status> {
        let req = request.into_inner();

        struct UserIdRow {
            user_id: i64,
        }

        let rows = sqlx::query_as!(
            UserIdRow,
            "SELECT user_id FROM dm_channels WHERE channel_id = $1",
            req.channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let user_ids = rows.into_iter().map(|r| r.user_id).collect();
        Ok(Response::new(GetDmMembersResponse { user_ids }))
    }

    async fn update_channel_positions(
        &self,
        request: Request<UpdateChannelPositionsRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();

        for pos in &req.positions {
            sqlx::query!(
                r#"UPDATE channels SET position = $2, parent_id = COALESCE($3, parent_id)
                   WHERE id = $1 AND guild_id = $4"#,
                pos.id,
                pos.position,
                pos.parent_id,
                req.guild_id,
            )
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;
        }

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        Ok(Response::new(Empty {}))
    }

    async fn follow_channel(
        &self,
        request: Request<FollowChannelRequest>,
    ) -> Result<Response<FollowChannelResponse>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            r#"INSERT INTO channel_followers (source_channel_id, target_channel_id, webhook_id, created_by)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (source_channel_id, target_channel_id)
               DO UPDATE SET webhook_id = EXCLUDED.webhook_id, created_by = EXCLUDED.created_by"#,
            req.source_channel_id,
            req.target_channel_id,
            req.webhook_id,
            req.created_by,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(FollowChannelResponse {
            webhook_id: req.webhook_id,
        }))
    }

    async fn get_channel_followers(
        &self,
        request: Request<GetChannelFollowersRequest>,
    ) -> Result<Response<GetChannelFollowersResponse>, Status> {
        let req = request.into_inner();

        struct FollowerRow {
            source_channel_id: i64,
            target_channel_id: i64,
            webhook_id: i64,
        }

        let rows = sqlx::query_as!(
            FollowerRow,
            r#"SELECT source_channel_id, target_channel_id,
                      COALESCE(webhook_id, 0) AS "webhook_id!"
               FROM channel_followers WHERE source_channel_id = $1"#,
            req.source_channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let followers = rows
            .into_iter()
            .map(|r| ChannelFollower {
                source_channel_id: r.source_channel_id,
                target_channel_id: r.target_channel_id,
                webhook_id: r.webhook_id,
            })
            .collect();

        Ok(Response::new(GetChannelFollowersResponse { followers }))
    }

    async fn unfollow_channel(
        &self,
        request: Request<UnfollowChannelRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM channel_followers WHERE source_channel_id = $1 AND target_channel_id = $2",
            req.source_channel_id,
            req.target_channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        Ok(Response::new(Empty {}))
    }
}

async fn fetch_overwrites(db: &PgPool, channel_id: i64) -> Result<Vec<PermissionOverwrite>, Status> {
    struct OwRow {
        target_id: i64,
        r#type: i16,
        allow: i64,
        deny: i64,
    }

    let rows = sqlx::query_as!(
        OwRow,
        r#"SELECT target_id, type, allow, deny
           FROM permission_overwrites WHERE channel_id = $1"#,
        channel_id
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;

    Ok(rows
        .into_iter()
        .map(|r| PermissionOverwrite {
            id: r.target_id,
            r#type: r.r#type as i32,
            allow: r.allow,
            deny: r.deny,
        })
        .collect())
}
