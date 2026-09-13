from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://relay:relay@postgres:5432/relay"
    redis_url: str = "redis://redis:6379/0"
    data_services_url: str = "data-services:50051"

    @field_validator("data_services_url", mode="before")
    @classmethod
    def strip_grpc_scheme(cls, v: str) -> str:
        """gRPC channel target must not have http:// or https:// prefix."""
        for prefix in ("https://", "http://"):
            if v.startswith(prefix):
                return v[len(prefix):]
        return v
    gateway_url: str = "ws://gateway:4000"
    token_ttl_seconds: int = 604800  # 7 days
    cors_origins: str = "http://localhost:5173"

    # Shared secret authenticating service-to-service calls to the /internal/* API
    # (currently the gateway's voice-join authorization check). The default is a
    # dev-only value; set INTERNAL_SERVICE_SECRET to a strong random string for any
    # real deployment (see .env.example / docs/DEPLOYMENT.md). Must match the value
    # the gateway is given.
    internal_service_secret: str = "relay-internal-dev-secret"

    # S3 / MinIO settings for file uploads
    s3_endpoint: str = "http://minio:9000"
    s3_bucket: str = "relay-attachments"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    # Same-origin path the client proxies to MinIO (see the /cdn proxy in vite.config.ts).
    # Stored attachment URLs become /cdn/<bucket>/<key>, which the browser resolves against
    # the page origin — so they work over HTTPS and for remote viewers, instead of a
    # hard-coded http://localhost:9000 (blocked as mixed content / points at the wrong host).
    s3_public_url: str = "/cdn"

    # Public origin used to build links sent to users (email verification, password
    # reset). Defaults to the local Vite dev server so out-of-the-box dev is unchanged.
    public_base_url: str = "http://localhost:5173"

    # SMTP / transactional email. Left empty by default -- when smtp_host is unset,
    # the email service no-ops (logs the link, sends nothing) so the out-of-the-box
    # dev experience is unchanged. Set these to enable real verification / reset /
    # login-notification emails.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "Relay <no-reply@relay.local>"
    smtp_use_tls: bool = False  # implicit TLS (SMTPS), typically port 465
    smtp_starttls: bool = True  # opportunistic STARTTLS, typically port 587
    smtp_login_notifications: bool = False

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
