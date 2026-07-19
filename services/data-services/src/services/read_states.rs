use redis::AsyncCommands;
use sqlx::PgPool;
use tonic::{Request, Response, Status};

use crate::error::sqlx_to_status;
use crate::proto::read_state_service_server::ReadStateService;
use crate::proto::{
    AckMessageRequest, DeleteReadStateRequest, Empty, GetReadStateRequest, GetReadStatesRequest,
    GetReadStatesResponse, ReadState,
};

/// gRPC service implementation for read state tracking.
pub struct ReadStateServiceImpl {
    db: PgPool,
    redis: redis::aio::ConnectionManager,
}

impl ReadStateServiceImpl {
    /// Create a new ReadStateServiceImpl.
    pub fn new(db: PgPool, redis: redis::aio::ConnectionManager) -> Self {
        Self { db, redis }
    }
}

struct ReadStateRow {
    user_id: i64,
    channel_id: i64,
    last_message_id: i64,
    mention_count: i32,
}

fn row_to_read_state(r: ReadStateRow) -> ReadState {
    ReadState {
        user_id: r.user_id,
        channel_id: r.channel_id,
        last_message_id: r.last_message_id,
        mention_count: r.mention_count,
    }
}

#[tonic::async_trait]
impl ReadStateService for ReadStateServiceImpl {
    async fn get_read_states(
        &self,
        request: Request<GetReadStatesRequest>,
    ) -> Result<Response<GetReadStatesResponse>, Status> {
        let req = request.into_inner();

        let rows = sqlx::query_as!(
            ReadStateRow,
            "SELECT user_id, channel_id, last_message_id, mention_count FROM read_states WHERE user_id = $1",
            req.user_id,
        )
        .fetch_all(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let read_states = rows.into_iter().map(row_to_read_state).collect();
        Ok(Response::new(GetReadStatesResponse { read_states }))
    }

    async fn get_read_state(
        &self,
        request: Request<GetReadStateRequest>,
    ) -> Result<Response<ReadState>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            ReadStateRow,
            "SELECT user_id, channel_id, last_message_id, mention_count FROM read_states WHERE user_id = $1 AND channel_id = $2",
            req.user_id,
            req.channel_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(sqlx_to_status)?
        .ok_or_else(|| Status::not_found("read state not found"))?;

        Ok(Response::new(row_to_read_state(row)))
    }

    async fn ack_message(
        &self,
        request: Request<AckMessageRequest>,
    ) -> Result<Response<ReadState>, Status> {
        let req = request.into_inner();

        let row = sqlx::query_as!(
            ReadStateRow,
            r#"INSERT INTO read_states (user_id, channel_id, last_message_id, mention_count)
               VALUES ($1, $2, $3, 0)
               ON CONFLICT (user_id, channel_id) DO UPDATE SET
                   last_message_id = GREATEST(read_states.last_message_id, $3),
                   mention_count = 0
               RETURNING user_id, channel_id, last_message_id, mention_count"#,
            req.user_id,
            req.channel_id,
            req.message_id,
        )
        .fetch_one(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        // Invalidate cache
        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis
            .del(format!("readstate:{}:{}", req.user_id, req.channel_id))
            .await;

        Ok(Response::new(row_to_read_state(row)))
    }

    async fn delete_read_state(
        &self,
        request: Request<DeleteReadStateRequest>,
    ) -> Result<Response<Empty>, Status> {
        let req = request.into_inner();
        sqlx::query!(
            "DELETE FROM read_states WHERE user_id = $1 AND channel_id = $2",
            req.user_id,
            req.channel_id,
        )
        .execute(&self.db)
        .await
        .map_err(sqlx_to_status)?;

        let mut redis = self.redis.clone();
        let _: Result<(), _> = redis
            .del(format!("readstate:{}:{}", req.user_id, req.channel_id))
            .await;

        Ok(Response::new(Empty {}))
    }
}
