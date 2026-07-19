use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::webhook_service_server::WebhookService;
use crate::proto::{
    CreateWebhookRequest, DeleteWebhookRequest, Empty, GetChannelWebhooksRequest,
    GetGuildWebhooksRequest, GetWebhookRequest, GetWebhooksResponse, UpdateWebhookRequest,
    Webhook,
};

/// gRPC service implementation for webhook operations.
pub struct WebhookServiceImpl {
    db: PgPool,
}

impl WebhookServiceImpl {
    /// Create a new WebhookServiceImpl.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

struct WebhookRow {
    id: i64,
    r#type: i16,
    guild_id: i64,
    channel_id: i64,
    creator_id: Option<i64>,
    name: String,
    avatar: Option<String>,
    token: Option<String>,
}

fn row_to_webhook(r: WebhookRow) -> Webhook {
    let token_str = r.token.clone().unwrap_or_default();
    Webhook {
        id: r.id,
        r#type: r.r#type as i32,
        guild_id: r.guild_id,
        channel_id: r.channel_id,
        user_id: r.creator_id,
        name: r.name,
        avatar: r.avatar,
        token: token_str.clone(),
        url: if token_str.is_empty() {
            String::new()
        } else {
            format!("/api/v10/webhooks/{}/{}", r.id, token_str)
        },
    }
}

#[tonic::async_trait]
impl WebhookService for WebhookServiceImpl {
    async fn get_webhook(
        &self,
        request: Request<GetWebhookRequest>,
    ) -> Result<Response<Webhook>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            WebhookRow,
            r#"SELECT id, type, guild_id, channel_id, creator_id, name, avatar, token
               FROM webhooks WHERE id = $1"#,
            req.webhook_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("webhook not found"))?;

        Ok(Response::new(row_to_webhook(row)))
    }

    async fn get_channel_webhooks(
        &self,
        request: Request<GetChannelWebhooksRequest>,
    ) -> Result<Response<GetWebhooksResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            WebhookRow,
            r#"SELECT id, type, guild_id, channel_id, creator_id, name, avatar, token
               FROM webhooks WHERE channel_id = $1"#,
            req.channel_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let webhooks = rows.into_iter().map(row_to_webhook).collect();
        Ok(Response::new(GetWebhooksResponse { webhooks }))
    }

    async fn get_guild_webhooks(
        &self,
        request: Request<GetGuildWebhooksRequest>,
    ) -> Result<Response<GetWebhooksResponse>, Status> {
        let req = request.into_inner();
        let rows = sqlx::query_as!(
            WebhookRow,
            r#"SELECT id, type, guild_id, channel_id, creator_id, name, avatar, token
               FROM webhooks WHERE guild_id = $1"#,
            req.guild_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let webhooks = rows.into_iter().map(row_to_webhook).collect();
        Ok(Response::new(GetWebhooksResponse { webhooks }))
    }

    async fn create_webhook(
        &self,
        request: Request<CreateWebhookRequest>,
    ) -> Result<Response<Webhook>, Status> {
        let req = request.into_inner();
        let token = format!(
            "{}{}",
            hex::encode(rand::random::<[u8; 16]>()),
            hex::encode(rand::random::<[u8; 16]>()),
        );

        let row = sqlx::query_as!(
            WebhookRow,
            r#"INSERT INTO webhooks (guild_id, channel_id, creator_id, name, avatar, token, type)
               VALUES ($1, $2, $3, $4, $5, $6, 1)
               RETURNING id, type, guild_id, channel_id, creator_id, name, avatar, token"#,
            req.guild_id,
            req.channel_id,
            req.user_id,
            req.name,
            req.avatar,
            token,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        Ok(Response::new(row_to_webhook(row)))
    }

    async fn update_webhook(
        &self,
        request: Request<UpdateWebhookRequest>,
    ) -> Result<Response<Webhook>, Status> {
        let req = request.into_inner();
        let row = sqlx::query_as!(
            WebhookRow,
            r#"UPDATE webhooks SET
                name = COALESCE($2, name),
                avatar = COALESCE($3, avatar),
                channel_id = COALESCE($4, channel_id)
               WHERE id = $1
               RETURNING id, type, guild_id, channel_id, creator_id, name, avatar, token"#,
            req.webhook_id,
            req.name,
            req.avatar,
            req.channel_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("webhook not found"))?;

        Ok(Response::new(row_to_webhook(row)))
    }

    async fn delete_webhook(
        &self,
        request: Request<DeleteWebhookRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        let result = sqlx::query!("DELETE FROM webhooks WHERE id = $1", req.webhook_id)
            .execute(&self.db)
            .await
            .map_err(sqlx_to_status)?;

        if result.rows_affected() == 0 {
            return Err(Status::not_found("webhook not found"));
        }
        Ok(Response::new(Empty {}))
    }
}
