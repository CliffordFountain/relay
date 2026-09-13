use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::notification_service_server::NotificationService;
use crate::proto::{
    DeleteNotificationSettingsRequest, Empty, GetNotificationSettingsRequest,
    GetNotificationSettingsResponse, NotificationSettings, UpsertNotificationSettingsRequest,
};

/// gRPC service implementation for notification settings.
pub struct NotificationServiceImpl {
    db: PgPool,
}

impl NotificationServiceImpl {
    /// Create a new NotificationServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

struct NotifRow {
    user_id: i64,
    guild_id: Option<i64>,
    channel_id: Option<i64>,
    message_notifications: i16,
    muted: bool,
    suppress_everyone: bool,
    suppress_roles: bool,
}

fn row_to_settings(r: NotifRow) -> NotificationSettings {
    NotificationSettings {
        user_id: r.user_id,
        guild_id: r.guild_id,
        channel_id: r.channel_id,
        message_notifications: r.message_notifications as i32,
        muted: r.muted,
        suppress_everyone: r.suppress_everyone,
        suppress_roles: r.suppress_roles,
        mobile_push: true, // default, not in schema
    }
}

#[tonic::async_trait]
impl NotificationService for NotificationServiceImpl {
    async fn get_notification_settings(
        &self,
        request: Request<GetNotificationSettingsRequest>,
    ) -> Result<Response<GetNotificationSettingsResponse>, Status> {
        let req = request.into_inner();

        let rows = sqlx::query_as!(
            NotifRow,
            r#"SELECT user_id, guild_id, channel_id, message_notifications,
                      muted, suppress_everyone, suppress_roles
               FROM notification_settings
               WHERE user_id = $1
                 AND ($2::BIGINT IS NULL OR guild_id = $2)
                 AND ($3::BIGINT IS NULL OR channel_id = $3)"#,
            req.user_id,
            req.guild_id,
            req.channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let settings = rows.into_iter().map(row_to_settings).collect();
        Ok(Response::new(GetNotificationSettingsResponse { settings }))
    }

    async fn upsert_notification_settings(
        &self,
        request: Request<UpsertNotificationSettingsRequest>,
    ) -> Result<Response<NotificationSettings>, Status> {
        let req = request.into_inner();

        let notifs = req.message_notifications as i16;

        // The uniqueness of a settings row depends on which of guild_id/channel_id
        // are NULL, and each NULL-combination is deduped by its own partial unique
        // index. ON CONFLICT can only name one arbiter per statement, so pick the
        // index that matches this request's shape. (A single ON CONFLICT on all
        // three columns would never fire when guild_id/channel_id are NULL, which is
        // exactly how duplicate global/guild rows used to accumulate.)
        let row = match (req.guild_id, req.channel_id) {
            (None, None) => sqlx::query_as!(
                NotifRow,
                r#"INSERT INTO notification_settings (user_id, guild_id, channel_id,
                                                       message_notifications, muted,
                                                       suppress_everyone, suppress_roles)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (user_id) WHERE guild_id IS NULL AND channel_id IS NULL
                   DO UPDATE SET
                       message_notifications = $4,
                       muted = $5,
                       suppress_everyone = $6,
                       suppress_roles = $7
                   RETURNING user_id, guild_id, channel_id, message_notifications,
                             muted, suppress_everyone, suppress_roles"#,
                req.user_id,
                req.guild_id,
                req.channel_id,
                notifs,
                req.muted,
                req.suppress_everyone,
                req.suppress_roles,
            )
            .fetch_one(&self.db)
            .await,
            (Some(_), None) => sqlx::query_as!(
                NotifRow,
                r#"INSERT INTO notification_settings (user_id, guild_id, channel_id,
                                                       message_notifications, muted,
                                                       suppress_everyone, suppress_roles)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (user_id, guild_id) WHERE guild_id IS NOT NULL AND channel_id IS NULL
                   DO UPDATE SET
                       message_notifications = $4,
                       muted = $5,
                       suppress_everyone = $6,
                       suppress_roles = $7
                   RETURNING user_id, guild_id, channel_id, message_notifications,
                             muted, suppress_everyone, suppress_roles"#,
                req.user_id,
                req.guild_id,
                req.channel_id,
                notifs,
                req.muted,
                req.suppress_everyone,
                req.suppress_roles,
            )
            .fetch_one(&self.db)
            .await,
            (None, Some(_)) => sqlx::query_as!(
                NotifRow,
                r#"INSERT INTO notification_settings (user_id, guild_id, channel_id,
                                                       message_notifications, muted,
                                                       suppress_everyone, suppress_roles)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (user_id, channel_id) WHERE guild_id IS NULL AND channel_id IS NOT NULL
                   DO UPDATE SET
                       message_notifications = $4,
                       muted = $5,
                       suppress_everyone = $6,
                       suppress_roles = $7
                   RETURNING user_id, guild_id, channel_id, message_notifications,
                             muted, suppress_everyone, suppress_roles"#,
                req.user_id,
                req.guild_id,
                req.channel_id,
                notifs,
                req.muted,
                req.suppress_everyone,
                req.suppress_roles,
            )
            .fetch_one(&self.db)
            .await,
            (Some(_), Some(_)) => sqlx::query_as!(
                NotifRow,
                r#"INSERT INTO notification_settings (user_id, guild_id, channel_id,
                                                       message_notifications, muted,
                                                       suppress_everyone, suppress_roles)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (user_id, guild_id, channel_id) WHERE guild_id IS NOT NULL AND channel_id IS NOT NULL
                   DO UPDATE SET
                       message_notifications = $4,
                       muted = $5,
                       suppress_everyone = $6,
                       suppress_roles = $7
                   RETURNING user_id, guild_id, channel_id, message_notifications,
                             muted, suppress_everyone, suppress_roles"#,
                req.user_id,
                req.guild_id,
                req.channel_id,
                notifs,
                req.muted,
                req.suppress_everyone,
                req.suppress_roles,
            )
            .fetch_one(&self.db)
            .await,
        }
        .map_err(sqlx_to_status)?;

        Ok(Response::new(row_to_settings(row)))
    }

    async fn delete_notification_settings(
        &self,
        request: Request<DeleteNotificationSettingsRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();

        sqlx::query!(
            r#"DELETE FROM notification_settings
               WHERE user_id = $1
                 AND ($2::BIGINT IS NULL OR guild_id = $2)
                 AND ($3::BIGINT IS NULL OR channel_id = $3)"#,
            req.user_id,
            req.guild_id,
            req.channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(Empty {}))
    }
}
