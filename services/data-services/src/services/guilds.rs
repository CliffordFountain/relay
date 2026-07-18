use redis::AsyncCommands;
use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::guild_service_server::GuildService;
use crate::proto::{
    AutoModRule, AuditLogEntry, Channel, CreateAuditLogEntryRequest, CreateAutoModRuleRequest,
    CreateEmojiRequest, CreateGuildRequest, DeleteAutoModRuleRequest, DeleteEmojiRequest,
    DeleteGuildRequest, Emoji, Empty, GetAuditLogsRequest, GetAuditLogsResponse,
    GetAutoModRuleRequest, GetAutoModRulesRequest, GetAutoModRulesResponse, GetChannelsResponse,
    GetEmojisResponse, GetGuildByVanityRequest, GetGuildChannelsRequest, GetGuildEmojisRequest,
    GetGuildRequest, Guild,
    Role, TransferOwnershipRequest, UpdateAutoModRuleRequest, UpdateEmojiRequest,
    UpdateGuildRequest,
    ScheduledEvent, CreateScheduledEventRequest, GetScheduledEventsRequest,
    GetScheduledEventsResponse, GetScheduledEventRequest, UpdateScheduledEventRequest,
    DeleteScheduledEventRequest,
    DiscoverGuildsRequest, DiscoverGuildsResponse, DiscoverableGuild,
    ScheduledEventInterestRequest, GetScheduledEventInterestedRequest,
    GetScheduledEventInterestedResponse,
};

/// gRPC service implementation for guild-related operations.
pub struct GuildServiceImpl {
    db: PgPool,
    redis: redis::aio::ConnectionManager,
}

impl GuildServiceImpl {
    /// Create a new GuildServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, redis }
    }
}

#[tonic::async_trait]
impl GuildService for GuildServiceImpl {
    async fn get_guild(
        &self,
        request: Request<GetGuildRequest>,
    ) -> Result<Response<Guild>, Status> {
        let req = request.into_inner();

        struct GuildRow {
            id: i64,
            name: String,
            icon: Option<String>,
            banner: Option<String>,
            description: Option<String>,
            owner_id: i64,
            verification_level: i16,
            default_notifications: i16,
            explicit_content_filter: i16,
            preferred_locale: String,
            vanity_url_code: Option<String>,
            discoverable: bool,
        }

        let row = sqlx::query_as!(
            GuildRow,
            r#"SELECT id, name, icon, banner, description, owner_id,
                      verification_level, default_notifications, explicit_content_filter,
                      preferred_locale, vanity_url_code, discoverable
               FROM guilds WHERE id = $1"#,
            req.guild_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("guild not found"))?;

        // Fetch channels
        let channels = fetch_guild_channels(&self.db, req.guild_id).await?;

        // Fetch roles
        let roles = fetch_guild_roles(&self.db, req.guild_id).await?;

        // Count members
        struct CountRow {
            count: Option<i64>,
        }
        let count_row = sqlx::query_as!(
            CountRow,
            "SELECT COUNT(*) as count FROM guild_members WHERE guild_id = $1",
            req.guild_id
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let guild = Guild {
            id: row.id,
            name: row.name,
            icon: row.icon,
            banner: row.banner,
            description: row.description,
            owner_id: row.owner_id,
            verification_level: row.verification_level as i32,
            default_message_notifications: row.default_notifications as i32,
            explicit_content_filter: row.explicit_content_filter as i32,
            nsfw_level: false,
            preferred_locale: Some(row.preferred_locale),
            vanity_url_code: row.vanity_url_code,
            member_count: count_row.count.unwrap_or(0) as i32,
            channels,
            roles,
            discoverable: row.discoverable,
        };

        Ok(Response::new(guild))
    }

    async fn get_guild_by_vanity(
        &self,
        request: Request<GetGuildByVanityRequest>,
    ) -> Result<Response<Guild>, Status> {
        let req = request.into_inner();
        struct IdRow {
            id: i64,
        }
        let row = sqlx::query_as!(
            IdRow,
            "SELECT id FROM guilds WHERE vanity_url_code = $1",
            req.code
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("guild not found"))?;
        // Reuse get_guild to hydrate channels/roles/member_count.
        self.get_guild(Request::new(GetGuildRequest { guild_id: row.id }))
            .await
    }

    async fn create_guild(
        &self,
        request: Request<CreateGuildRequest>,
    ) -> Result<Response<Guild>, Status> {
        let req = request.into_inner();

        struct IdRow {
            id: i64,
        }

        let guild_row = sqlx::query_as!(
            IdRow,
            r#"INSERT INTO guilds (name, owner_id, icon)
               VALUES ($1, $2, $3)
               RETURNING id"#,
            req.name,
            req.owner_id,
            req.icon,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Create @everyone role with guild_id == role_id
        sqlx::query!(
            r#"INSERT INTO roles (id, guild_id, name, position, permissions)
               VALUES ($1, $1, '@everyone', 0, 104324673)"#,
            guild_row.id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Add owner as member
        sqlx::query!(
            "INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2)",
            guild_row.id,
            req.owner_id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Create "TEXT CHANNELS" category (type=4, position=0)
        let text_cat_row = sqlx::query_as!(
            IdRow,
            "INSERT INTO channels (guild_id, name, type, position) VALUES ($1, 'TEXT CHANNELS', 4, 0) RETURNING id",
            guild_row.id
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Create default #general text channel under TEXT CHANNELS category
        sqlx::query!(
            "INSERT INTO channels (guild_id, name, type, position, parent_id) VALUES ($1, 'general', 0, 0, $2)",
            guild_row.id,
            text_cat_row.id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Create "VOICE CHANNELS" category (type=4, position=1)
        let voice_cat_row = sqlx::query_as!(
            IdRow,
            "INSERT INTO channels (guild_id, name, type, position) VALUES ($1, 'VOICE CHANNELS', 4, 1) RETURNING id",
            guild_row.id
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Create default "General" voice channel under VOICE CHANNELS category
        sqlx::query!(
            "INSERT INTO channels (guild_id, name, type, position, parent_id) VALUES ($1, 'General', 2, 0, $2)",
            guild_row.id,
            voice_cat_row.id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        self.get_guild(Request::new(GetGuildRequest {
            guild_id: guild_row.id,
        }))
        .await
    }

    async fn update_guild(
        &self,
        request: Request<UpdateGuildRequest>,
    ) -> Result<Response<Guild>, Status> {
        let req = request.into_inner();

        let result = sqlx::query!(
            r#"UPDATE guilds SET
                name = COALESCE($2, name),
                icon = COALESCE($3, icon),
                banner = COALESCE($4, banner),
                description = COALESCE($5, description),
                verification_level = COALESCE($6, verification_level),
                default_notifications = COALESCE($7, default_notifications),
                explicit_content_filter = COALESCE($8, explicit_content_filter),
                preferred_locale = COALESCE($9, preferred_locale),
                vanity_url_code = COALESCE($10, vanity_url_code),
                system_channel_id = COALESCE($11, system_channel_id),
                rules_channel_id = COALESCE($12, rules_channel_id),
                discoverable = COALESCE($13, discoverable)
               WHERE id = $1"#,
            req.guild_id,
            req.name,
            req.icon,
            req.banner,
            req.description,
            req.verification_level.map(|v| v as i16),
            req.default_message_notifications.map(|v| v as i16),
            req.explicit_content_filter.map(|v| v as i16),
            req.preferred_locale,
            req.vanity_url_code,
            req.system_channel_id,
            req.rules_channel_id,
            req.discoverable,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("guild not found"));
        }

        // Invalidate cache
        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        self.get_guild(Request::new(GetGuildRequest {
            guild_id: req.guild_id,
        }))
        .await
    }

    async fn delete_guild(
        &self,
        request: Request<DeleteGuildRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!("DELETE FROM guilds WHERE id = $1", req.guild_id)
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("guild not found"));
        }

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        Ok(Response::new(Empty {}))
    }

    async fn get_guild_channels(
        &self,
        request: Request<GetGuildChannelsRequest>,
    ) -> Result<Response<GetChannelsResponse>, Status> {
        let req = request.into_inner();
        let channels = fetch_guild_channels(&self.db, req.guild_id).await?;
        Ok(Response::new(GetChannelsResponse { channels }))
    }

    async fn transfer_ownership(
        &self,
        request: Request<TransferOwnershipRequest>,
    ) -> Result<Response<Guild>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "UPDATE guilds SET owner_id = $2 WHERE id = $1",
            req.guild_id,
            req.new_owner_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("guild not found"));
        }

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis.del(format!("guild:{}", req.guild_id)).await;

        self.get_guild(Request::new(GetGuildRequest {
            guild_id: req.guild_id,
        }))
        .await
    }

    async fn get_guild_emojis(
        &self,
        request: Request<GetGuildEmojisRequest>,
    ) -> Result<Response<GetEmojisResponse>, Status> {
        let req = request.into_inner();

        struct EmojiRow {
            id: i64,
            guild_id: i64,
            name: String,
            creator_id: Option<i64>,
            animated: bool,
            managed: bool,
            available: bool,
        }

        let rows = sqlx::query_as!(
            EmojiRow,
            "SELECT id, guild_id, name, creator_id, animated, managed, available FROM emojis WHERE guild_id = $1",
            req.guild_id
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let emojis = rows
            .into_iter()
            .map(|r| Emoji {
                id: r.id,
                guild_id: r.guild_id,
                name: r.name,
                user_id: r.creator_id,
                require_colons: true,
                managed: r.managed,
                animated: r.animated,
                available: r.available,
            })
            .collect();

        Ok(Response::new(GetEmojisResponse { emojis }))
    }

    async fn create_emoji(
        &self,
        request: Request<CreateEmojiRequest>,
    ) -> Result<Response<Emoji>, Status> {
        let req = request.into_inner();

        struct EmojiRow {
            id: i64,
        }

        let row = sqlx::query_as!(
            EmojiRow,
            "INSERT INTO emojis (guild_id, name, creator_id) VALUES ($1, $2, $3) RETURNING id",
            req.guild_id,
            req.name,
            req.user_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Emoji {
            id: row.id,
            guild_id: req.guild_id,
            name: req.name,
            user_id: Some(req.user_id),
            require_colons: true,
            managed: false,
            animated: false,
            available: true,
        }))
    }

    async fn update_emoji(
        &self,
        request: Request<UpdateEmojiRequest>,
    ) -> Result<Response<Emoji>, Status> {
        let req = request.into_inner();

        struct EmojiRow {
            id: i64,
            guild_id: i64,
            name: String,
            creator_id: Option<i64>,
            animated: bool,
            managed: bool,
            available: bool,
        }

        let row = sqlx::query_as!(
            EmojiRow,
            r#"UPDATE emojis SET name = $3 WHERE id = $1 AND guild_id = $2
               RETURNING id, guild_id, name, creator_id, animated, managed, available"#,
            req.emoji_id,
            req.guild_id,
            req.name,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("emoji not found"))?;

        Ok(Response::new(Emoji {
            id: row.id,
            guild_id: row.guild_id,
            name: row.name,
            user_id: row.creator_id,
            require_colons: true,
            managed: row.managed,
            animated: row.animated,
            available: row.available,
        }))
    }

    async fn delete_emoji(
        &self,
        request: Request<DeleteEmojiRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM emojis WHERE id = $1 AND guild_id = $2",
            req.emoji_id,
            req.guild_id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("emoji not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn get_auto_mod_rules(
        &self,
        request: Request<GetAutoModRulesRequest>,
    ) -> Result<Response<GetAutoModRulesResponse>, Status> {
        let req = request.into_inner();

        struct RuleRow {
            id: i64,
            guild_id: i64,
            name: String,
            creator_id: i64,
            event_type: i16,
            trigger_type: i16,
            trigger_metadata: serde_json::Value,
            actions: serde_json::Value,
            enabled: bool,
            exempt_roles: Vec<i64>,
            exempt_channels: Vec<i64>,
        }

        let rows = sqlx::query_as!(
            RuleRow,
            r#"SELECT id, guild_id, name, creator_id, event_type, trigger_type,
                      trigger_metadata, actions, enabled, exempt_roles, exempt_channels
               FROM automod_rules WHERE guild_id = $1"#,
            req.guild_id
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let rules = rows
            .into_iter()
            .map(|r| AutoModRule {
                id: r.id,
                guild_id: r.guild_id,
                name: r.name,
                creator_id: r.creator_id,
                event_type: r.event_type as i32,
                trigger_type: r.trigger_type as i32,
                trigger_metadata: r.trigger_metadata.to_string(),
                actions: r.actions.to_string(),
                enabled: r.enabled,
                exempt_roles: r.exempt_roles,
                exempt_channels: r.exempt_channels,
            })
            .collect();

        Ok(Response::new(GetAutoModRulesResponse { rules }))
    }

    async fn get_auto_mod_rule(
        &self,
        request: Request<GetAutoModRuleRequest>,
    ) -> Result<Response<AutoModRule>, Status> {
        let req = request.into_inner();

        struct RuleRow {
            id: i64,
            guild_id: i64,
            name: String,
            creator_id: i64,
            event_type: i16,
            trigger_type: i16,
            trigger_metadata: serde_json::Value,
            actions: serde_json::Value,
            enabled: bool,
            exempt_roles: Vec<i64>,
            exempt_channels: Vec<i64>,
        }

        let row = sqlx::query_as!(
            RuleRow,
            r#"SELECT id, guild_id, name, creator_id, event_type, trigger_type,
                      trigger_metadata, actions, enabled, exempt_roles, exempt_channels
               FROM automod_rules WHERE id = $1 AND guild_id = $2"#,
            req.rule_id,
            req.guild_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("automod rule not found"))?;

        Ok(Response::new(AutoModRule {
            id: row.id,
            guild_id: row.guild_id,
            name: row.name,
            creator_id: row.creator_id,
            event_type: row.event_type as i32,
            trigger_type: row.trigger_type as i32,
            trigger_metadata: row.trigger_metadata.to_string(),
            actions: row.actions.to_string(),
            enabled: row.enabled,
            exempt_roles: row.exempt_roles,
            exempt_channels: row.exempt_channels,
        }))
    }

    async fn create_auto_mod_rule(
        &self,
        request: Request<CreateAutoModRuleRequest>,
    ) -> Result<Response<AutoModRule>, Status> {
        let req = request.into_inner();

        let trigger_metadata: serde_json::Value =
            serde_json::from_str(&req.trigger_metadata)
                .map_err(|e| Status::invalid_argument(format!("invalid trigger_metadata JSON: {e}")))?;
        let actions: serde_json::Value =
            serde_json::from_str(&req.actions)
                .map_err(|e| Status::invalid_argument(format!("invalid actions JSON: {e}")))?;

        struct IdRow {
            id: i64,
        }

        let row = sqlx::query_as!(
            IdRow,
            r#"INSERT INTO automod_rules (guild_id, name, creator_id, event_type, trigger_type,
                                          trigger_metadata, actions, enabled, exempt_roles, exempt_channels)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING id"#,
            req.guild_id,
            req.name,
            req.creator_id,
            req.event_type as i16,
            req.trigger_type as i16,
            trigger_metadata,
            actions,
            req.enabled,
            &req.exempt_roles,
            &req.exempt_channels,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(AutoModRule {
            id: row.id,
            guild_id: req.guild_id,
            name: req.name,
            creator_id: req.creator_id,
            event_type: req.event_type,
            trigger_type: req.trigger_type,
            trigger_metadata: req.trigger_metadata,
            actions: req.actions,
            enabled: req.enabled,
            exempt_roles: req.exempt_roles,
            exempt_channels: req.exempt_channels,
        }))
    }

    async fn update_auto_mod_rule(
        &self,
        request: Request<UpdateAutoModRuleRequest>,
    ) -> Result<Response<AutoModRule>, Status> {
        let req = request.into_inner();

        let trigger_metadata = match &req.trigger_metadata {
            Some(s) => Some(
                serde_json::from_str::<serde_json::Value>(s)
                    .map_err(|e| Status::invalid_argument(format!("invalid trigger_metadata: {e}")))?,
            ),
            None => None,
        };

        let actions = match &req.actions {
            Some(s) => Some(
                serde_json::from_str::<serde_json::Value>(s)
                    .map_err(|e| Status::invalid_argument(format!("invalid actions: {e}")))?,
            ),
            None => None,
        };

        let result = sqlx::query!(
            r#"UPDATE automod_rules SET
                name = COALESCE($3, name),
                trigger_metadata = COALESCE($4, trigger_metadata),
                actions = COALESCE($5, actions),
                enabled = COALESCE($6, enabled)
               WHERE id = $1 AND guild_id = $2"#,
            req.rule_id,
            req.guild_id,
            req.name,
            trigger_metadata,
            actions,
            req.enabled,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("automod rule not found"));
        }

        self.get_auto_mod_rule(Request::new(GetAutoModRuleRequest {
            rule_id: req.rule_id,
            guild_id: req.guild_id,
        }))
        .await
    }

    async fn delete_auto_mod_rule(
        &self,
        request: Request<DeleteAutoModRuleRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM automod_rules WHERE id = $1 AND guild_id = $2",
            req.rule_id,
            req.guild_id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("automod rule not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn create_scheduled_event(
        &self,
        request: Request<CreateScheduledEventRequest>,
    ) -> Result<Response<ScheduledEvent>, Status> {
        let req = request.into_inner();
        let start = req
            .scheduled_start_time
            .parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|e| Status::invalid_argument(format!("invalid scheduled_start_time: {e}")))?;
        let end = match &req.scheduled_end_time {
            Some(s) if !s.is_empty() => Some(
                s.parse::<chrono::DateTime<chrono::Utc>>()
                    .map_err(|e| Status::invalid_argument(format!("invalid scheduled_end_time: {e}")))?,
            ),
            _ => None,
        };
        let metadata: serde_json::Value = serde_json::from_str(
            if req.entity_metadata.is_empty() { "{}" } else { &req.entity_metadata },
        )
        .map_err(|e| Status::invalid_argument(format!("invalid entity_metadata: {e}")))?;

        struct IdRow {
            id: i64,
        }
        let row = sqlx::query_as!(
            IdRow,
            r#"INSERT INTO scheduled_events (guild_id, channel_id, creator_id, name, description,
                    scheduled_start_time, scheduled_end_time, entity_type, entity_metadata, privacy_level)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id"#,
            req.guild_id,
            req.channel_id,
            req.creator_id,
            req.name,
            req.description,
            start,
            end,
            req.entity_type as i16,
            metadata,
            req.privacy_level as i16,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        self.get_scheduled_event(Request::new(GetScheduledEventRequest {
            event_id: row.id,
            guild_id: req.guild_id,
        }))
        .await
    }

    async fn get_scheduled_events(
        &self,
        request: Request<GetScheduledEventsRequest>,
    ) -> Result<Response<GetScheduledEventsResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query!(
            r#"SELECT id, guild_id, channel_id, creator_id, name, description,
                      scheduled_start_time, scheduled_end_time, entity_type,
                      entity_metadata, status, privacy_level,
                      (SELECT COUNT(*) FROM scheduled_event_users
                       WHERE event_id = scheduled_events.id) AS "interested_count!"
               FROM scheduled_events WHERE guild_id = $1 ORDER BY scheduled_start_time"#,
            req.guild_id
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        let events = rows
            .into_iter()
            .map(|row| ScheduledEvent {
                id: row.id,
                guild_id: row.guild_id,
                channel_id: row.channel_id,
                creator_id: row.creator_id,
                name: row.name,
                description: row.description,
                scheduled_start_time: row.scheduled_start_time.to_rfc3339(),
                scheduled_end_time: row.scheduled_end_time.map(|t| t.to_rfc3339()),
                entity_type: row.entity_type as i32,
                entity_metadata: row.entity_metadata.to_string(),
                status: row.status as i32,
                privacy_level: row.privacy_level as i32,
                interested_count: row.interested_count as i32,
            })
            .collect();
        Ok(Response::new(GetScheduledEventsResponse { events }))
    }

    async fn get_scheduled_event(
        &self,
        request: Request<GetScheduledEventRequest>,
    ) -> Result<Response<ScheduledEvent>, Status> {
        let req = request.into_inner();
        let row = sqlx::query!(
            r#"SELECT id, guild_id, channel_id, creator_id, name, description,
                      scheduled_start_time, scheduled_end_time, entity_type,
                      entity_metadata, status, privacy_level,
                      (SELECT COUNT(*) FROM scheduled_event_users
                       WHERE event_id = scheduled_events.id) AS "interested_count!"
               FROM scheduled_events WHERE id = $1 AND guild_id = $2"#,
            req.event_id,
            req.guild_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("scheduled event not found"))?;
        Ok(Response::new(ScheduledEvent {
            id: row.id,
            guild_id: row.guild_id,
            channel_id: row.channel_id,
            creator_id: row.creator_id,
            name: row.name,
            description: row.description,
            scheduled_start_time: row.scheduled_start_time.to_rfc3339(),
            scheduled_end_time: row.scheduled_end_time.map(|t| t.to_rfc3339()),
            entity_type: row.entity_type as i32,
            entity_metadata: row.entity_metadata.to_string(),
            status: row.status as i32,
            privacy_level: row.privacy_level as i32,
            interested_count: row.interested_count as i32,
        }))
    }

    async fn update_scheduled_event(
        &self,
        request: Request<UpdateScheduledEventRequest>,
    ) -> Result<Response<ScheduledEvent>, Status> {
        let req = request.into_inner();
        let start = match &req.scheduled_start_time {
            Some(s) => Some(
                s.parse::<chrono::DateTime<chrono::Utc>>()
                    .map_err(|e| Status::invalid_argument(format!("invalid start: {e}")))?,
            ),
            None => None,
        };
        let end = match &req.scheduled_end_time {
            Some(s) if !s.is_empty() => Some(
                s.parse::<chrono::DateTime<chrono::Utc>>()
                    .map_err(|e| Status::invalid_argument(format!("invalid end: {e}")))?,
            ),
            _ => None,
        };
        let result = sqlx::query!(
            r#"UPDATE scheduled_events SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                scheduled_start_time = COALESCE($5, scheduled_start_time),
                scheduled_end_time = COALESCE($6, scheduled_end_time),
                entity_type = COALESCE($7, entity_type),
                status = COALESCE($8, status),
                updated_at = NOW()
               WHERE id = $1 AND guild_id = $2"#,
            req.event_id,
            req.guild_id,
            req.name,
            req.description,
            start,
            end,
            req.entity_type.map(|v| v as i16),
            req.status.map(|v| v as i16),
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        if result.rows_affected() == 0 {
            return Err(Status::not_found("scheduled event not found"));
        }
        self.get_scheduled_event(Request::new(GetScheduledEventRequest {
            event_id: req.event_id,
            guild_id: req.guild_id,
        }))
        .await
    }

    async fn delete_scheduled_event(
        &self,
        request: Request<DeleteScheduledEventRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!(
            "DELETE FROM scheduled_events WHERE id = $1 AND guild_id = $2",
            req.event_id,
            req.guild_id
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        if result.rows_affected() == 0 {
            return Err(Status::not_found("scheduled event not found"));
        }
        Ok(Response::new(Empty {}))
    }

    async fn get_audit_logs(
        &self,
        request: Request<GetAuditLogsRequest>,
    ) -> Result<Response<GetAuditLogsResponse>, Status> {
        let req = request.into_inner();
        let limit = req.limit.min(100).max(1) as i64;

        struct LogRow {
            id: i64,
            guild_id: i64,
            user_id: Option<i64>,
            target_id: Option<i64>,
            action_type: i16,
            changes: Option<serde_json::Value>,
            reason: Option<String>,
            created_at: chrono::DateTime<chrono::Utc>,
        }

        let rows = sqlx::query_as!(
            LogRow,
            r#"SELECT id, guild_id, user_id, target_id, action_type,
                      changes, reason, created_at
               FROM audit_log_entries
               WHERE guild_id = $1
                 AND ($2::BIGINT IS NULL OR user_id = $2)
                 AND ($3::SMALLINT IS NULL OR action_type = $3)
                 AND ($4::BIGINT IS NULL OR id < $4)
               ORDER BY id DESC
               LIMIT $5"#,
            req.guild_id,
            req.user_id,
            req.action_type.map(|v| v as i16),
            req.before,
            limit,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let entries = rows
            .into_iter()
            .map(|r| AuditLogEntry {
                id: r.id,
                guild_id: r.guild_id,
                user_id: r.user_id.unwrap_or(0),
                target_id: r.target_id,
                action_type: r.action_type as i32,
                changes: r.changes.map(|v| v.to_string()),
                options: None,
                reason: r.reason,
                created_at: r.created_at.to_rfc3339(),
            })
            .collect();

        Ok(Response::new(GetAuditLogsResponse { entries }))
    }

    async fn create_audit_log_entry(
        &self,
        request: Request<CreateAuditLogEntryRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();

        let changes = match &req.changes {
            Some(s) => Some(
                serde_json::from_str::<serde_json::Value>(s)
                    .map_err(|e| Status::invalid_argument(format!("invalid changes JSON: {e}")))?,
            ),
            None => None,
        };

        sqlx::query!(
            r#"INSERT INTO audit_log_entries (guild_id, user_id, target_id, action_type, changes, reason)
               VALUES ($1, $2, $3, $4, $5, $6)"#,
            req.guild_id,
            req.user_id,
            req.target_id,
            req.action_type as i16,
            changes,
            req.reason,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }

    async fn discover_guilds(
        &self,
        request: Request<DiscoverGuildsRequest>,
    ) -> Result<Response<DiscoverGuildsResponse>, Status> {
        let req = request.into_inner();
        let limit = if req.limit <= 0 { 50 } else { req.limit.min(100) } as i64;
        let query = req.query.filter(|q| !q.is_empty());

        let rows = sqlx::query!(
            r#"SELECT id, name, icon, description,
                      (SELECT COUNT(*) FROM guild_members gm
                       WHERE gm.guild_id = guilds.id) AS "member_count!"
               FROM guilds
               WHERE discoverable = true
                 AND ($1::TEXT IS NULL OR name ILIKE '%' || $1 || '%')
               ORDER BY (SELECT COUNT(*) FROM guild_members gm
                         WHERE gm.guild_id = guilds.id) DESC
               LIMIT $2"#,
            query,
            limit,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let guilds = rows
            .into_iter()
            .map(|r| DiscoverableGuild {
                id: r.id,
                name: r.name,
                icon: r.icon,
                description: r.description,
                member_count: r.member_count as i32,
            })
            .collect();

        Ok(Response::new(DiscoverGuildsResponse { guilds }))
    }

    async fn add_scheduled_event_interest(
        &self,
        request: Request<ScheduledEventInterestRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            r#"INSERT INTO scheduled_event_users (event_id, user_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            req.event_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        Ok(Response::new(Empty {}))
    }

    async fn remove_scheduled_event_interest(
        &self,
        request: Request<ScheduledEventInterestRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM scheduled_event_users WHERE event_id = $1 AND user_id = $2",
            req.event_id,
            req.user_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;
        Ok(Response::new(Empty {}))
    }

    async fn get_scheduled_event_interested(
        &self,
        request: Request<GetScheduledEventInterestedRequest>,
    ) -> Result<Response<GetScheduledEventInterestedResponse>, Status> {
        let req = request.into_inner();
        struct UserIdRow {
            user_id: i64,
        }
        let rows = sqlx::query_as!(
            UserIdRow,
            "SELECT user_id FROM scheduled_event_users WHERE event_id = $1 ORDER BY created_at",
            req.event_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let user_ids: Vec<i64> = rows.into_iter().map(|r| r.user_id).collect();
        let count = user_ids.len() as i32;
        Ok(Response::new(GetScheduledEventInterestedResponse { user_ids, count }))
    }
}

/// Fetch all channels for a guild.
async fn fetch_guild_channels(db: &PgPool, guild_id: i64) -> Result<Vec<Channel>, Status> {
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

    let rows = sqlx::query_as!(
        ChannelRow,
        r#"SELECT id, type, guild_id, name, topic, nsfw, last_message_id,
                  position, bitrate, user_limit, rate_limit_per_user,
                  parent_id, rtc_region, video_quality_mode, icon, owner_id
           FROM channels WHERE guild_id = $1
           ORDER BY position"#,
        guild_id
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;

    Ok(rows
        .into_iter()
        .map(|r| Channel {
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
        })
        .collect())
}

/// Fetch all roles for a guild.
async fn fetch_guild_roles(db: &PgPool, guild_id: i64) -> Result<Vec<Role>, Status> {
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

    let rows = sqlx::query_as!(
        RoleRow,
        r#"SELECT id, guild_id, name, color, hoist, position, permissions,
                  managed, mentionable, icon
           FROM roles WHERE guild_id = $1
           ORDER BY position"#,
        guild_id
    )
    .fetch_all(db)
    .await
    .map_err(sqlx_to_status)?;

    Ok(rows
        .into_iter()
        .map(|r| Role {
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
        })
        .collect())
}
