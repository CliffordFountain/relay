#![deny(clippy::all)]

mod coalescer;
mod error;
mod services;

use std::net::SocketAddr;

use sqlx::postgres::PgPoolOptions;
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

use crate::services::bans::BanServiceImpl;
use crate::services::channels::ChannelServiceImpl;
use crate::services::guilds::GuildServiceImpl;
use crate::services::invites::InviteServiceImpl;
use crate::services::members::MemberServiceImpl;
use crate::services::messages::MessageServiceImpl;
use crate::services::notifications::NotificationServiceImpl;
use crate::services::permissions::PermissionServiceImpl;
use crate::services::reactions::ReactionServiceImpl;
use crate::services::read_states::ReadStateServiceImpl;
use crate::services::relationships::RelationshipServiceImpl;
use crate::services::roles::RoleServiceImpl;
use crate::services::threads::ThreadServiceImpl;
use crate::services::users::UserServiceImpl;
use crate::services::webhooks::WebhookServiceImpl;

pub mod proto {
    tonic::include_proto!("data_services");
}

use proto::ban_service_server::BanServiceServer;
use proto::channel_service_server::ChannelServiceServer;
use proto::guild_service_server::GuildServiceServer;
use proto::invite_service_server::InviteServiceServer;
use proto::member_service_server::MemberServiceServer;
use proto::message_service_server::MessageServiceServer;
use proto::notification_service_server::NotificationServiceServer;
use proto::permission_service_server::PermissionServiceServer;
use proto::reaction_service_server::ReactionServiceServer;
use proto::read_state_service_server::ReadStateServiceServer;
use proto::relationship_service_server::RelationshipServiceServer;
use proto::role_service_server::RoleServiceServer;
use proto::thread_service_server::ThreadServiceServer;
use proto::user_service_server::UserServiceServer;
use proto::webhook_service_server::WebhookServiceServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://relay:relay@localhost:5432/relay".to_string()
        });

    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/0".to_string());

    let grpc_port: u16 = std::env::var("GRPC_PORT")
        .unwrap_or_else(|_| "50051".to_string())
        .parse()
        .unwrap_or(50051);

    tracing::info!("Connecting to PostgreSQL at {}", database_url);
    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;

    tracing::info!("Connecting to Redis at {}", redis_url);
    let redis_client = redis::Client::open(redis_url)?;
    let redis = redis::aio::ConnectionManager::new(redis_client).await?;

    let addr: SocketAddr = format!("0.0.0.0:{grpc_port}").parse()?;
    tracing::info!("Relay Data Services starting on {}", addr);

    Server::builder()
        .add_service(UserServiceServer::new(UserServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(GuildServiceServer::new(GuildServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(ChannelServiceServer::new(ChannelServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(MessageServiceServer::new(MessageServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(ReactionServiceServer::new(ReactionServiceImpl::new(
            db.clone(),
        )))
        .add_service(MemberServiceServer::new(MemberServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(RoleServiceServer::new(RoleServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(PermissionServiceServer::new(PermissionServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(InviteServiceServer::new(InviteServiceImpl::new(
            db.clone(),
        )))
        .add_service(BanServiceServer::new(BanServiceImpl::new(db.clone())))
        .add_service(RelationshipServiceServer::new(
            RelationshipServiceImpl::new(db.clone()),
        ))
        .add_service(ReadStateServiceServer::new(ReadStateServiceImpl::new(
            db.clone(),
            redis.clone(),
        )))
        .add_service(ThreadServiceServer::new(ThreadServiceImpl::new(
            db.clone(),
        )))
        .add_service(WebhookServiceServer::new(WebhookServiceImpl::new(
            db.clone(),
        )))
        .add_service(NotificationServiceServer::new(
            NotificationServiceImpl::new(db.clone()),
        ))
        .serve(addr)
        .await?;

    Ok(())
}
