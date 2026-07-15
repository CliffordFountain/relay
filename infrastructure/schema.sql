-- ============================================================================
-- Relay - PostgreSQL Schema
-- Mounted into Postgres container via docker-compose for initial setup.
-- ============================================================================

-- ============================================================================
-- 1. Snowflake ID Generation
-- ============================================================================

-- The Snowflake epoch: 2015-01-01T00:00:00.000Z = 1420070400000 ms
-- Layout: 42 bits timestamp | 5 bits worker | 5 bits process | 12 bits sequence

CREATE SEQUENCE IF NOT EXISTS snowflake_seq
    INCREMENT BY 1
    MINVALUE 0
    MAXVALUE 4095
    CYCLE;

CREATE OR REPLACE FUNCTION generate_snowflake(
    worker_id INTEGER DEFAULT 1,
    process_id INTEGER DEFAULT 0
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    relay_epoch BIGINT := 1420070400000;
    now_ms        BIGINT;
    seq_val       BIGINT;
    result        BIGINT;
BEGIN
    now_ms  := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT - relay_epoch;
    seq_val := nextval('snowflake_seq');

    -- 42 bits timestamp | 5 bits worker_id | 5 bits process_id | 12 bits sequence
    result := (now_ms << 22)
            | ((worker_id & 31) << 17)
            | ((process_id & 31) << 12)
            | (seq_val & 4095);

    RETURN result;
END;
$$;

-- Helper: extract timestamp from a snowflake ID
CREATE OR REPLACE FUNCTION snowflake_timestamp(snowflake_id BIGINT)
RETURNS TIMESTAMPTZ
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT to_timestamp(((snowflake_id >> 22) + 1420070400000)::DOUBLE PRECISION / 1000);
$$;

-- ============================================================================
-- 2. Updated-at trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. Core Tables (in dependency order)
-- ============================================================================

-- --------------------------------------------------------------------------
-- users
-- --------------------------------------------------------------------------
CREATE TABLE users (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    username        VARCHAR(32) NOT NULL,
    display_name    VARCHAR(32),
    email           VARCHAR(254) NOT NULL,
    password_hash   VARCHAR(128) NOT NULL,
    avatar          TEXT,
    banner          TEXT,
    bio             VARCHAR(190),
    banner_color    VARCHAR(7),
    accent_color    INTEGER,
    pronouns        VARCHAR(40) NOT NULL DEFAULT '',
    date_of_birth   DATE,
    deleted_at      TIMESTAMPTZ,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret      VARCHAR(64),
    locale          VARCHAR(10) NOT NULL DEFAULT 'en-US',
    flags           BIGINT NOT NULL DEFAULT 0,
    premium_type    SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_username_length CHECK (char_length(username) >= 2)
);

CREATE INDEX idx_users_lower_username ON users (LOWER(username));
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_created_at ON users (created_at);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- guilds
-- --------------------------------------------------------------------------
CREATE TABLE guilds (
    id                          BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    name                        VARCHAR(100) NOT NULL,
    icon                        TEXT,
    banner                      TEXT,
    splash                      TEXT,
    owner_id                    BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    description                 VARCHAR(1000),
    preferred_locale            VARCHAR(10) NOT NULL DEFAULT 'en-US',
    afk_channel_id              BIGINT,          -- FK added after channels table
    afk_timeout                 INTEGER NOT NULL DEFAULT 300,
    system_channel_id           BIGINT,          -- FK added after channels table
    rules_channel_id            BIGINT,          -- FK added after channels table
    verification_level          SMALLINT NOT NULL DEFAULT 0,
    default_notifications       SMALLINT NOT NULL DEFAULT 0,
    explicit_content_filter     SMALLINT NOT NULL DEFAULT 0,
    features                    TEXT[] NOT NULL DEFAULT '{}',
    vanity_url_code             VARCHAR(32),
    discoverable                BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_guilds_vanity_url UNIQUE (vanity_url_code),
    CONSTRAINT ck_guilds_name_length CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
    CONSTRAINT ck_guilds_afk_timeout CHECK (afk_timeout IN (60, 300, 900, 1800, 3600))
);

CREATE INDEX idx_guilds_owner_id ON guilds (owner_id);
CREATE INDEX idx_guilds_vanity_url ON guilds (vanity_url_code) WHERE vanity_url_code IS NOT NULL;
CREATE INDEX idx_guilds_features ON guilds USING GIN (features);

CREATE TRIGGER trg_guilds_updated_at
    BEFORE UPDATE ON guilds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- channels
-- --------------------------------------------------------------------------
CREATE TABLE channels (
    id                      BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id                BIGINT REFERENCES guilds(id) ON DELETE CASCADE,
    type                    SMALLINT NOT NULL DEFAULT 0,
    name                    VARCHAR(100),
    topic                   VARCHAR(1024),
    position                INTEGER NOT NULL DEFAULT 0,
    parent_id               BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    nsfw                    BOOLEAN NOT NULL DEFAULT FALSE,
    bitrate                 INTEGER,
    user_limit              INTEGER DEFAULT 0,
    rtc_region              VARCHAR(32),
    video_quality_mode      SMALLINT NOT NULL DEFAULT 1,
    rate_limit_per_user     INTEGER NOT NULL DEFAULT 0,
    last_message_id         BIGINT,
    icon                    TEXT,
    owner_id                BIGINT REFERENCES users(id) ON DELETE SET NULL,
    thread_metadata         JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_guild_id ON channels (guild_id) WHERE guild_id IS NOT NULL;
CREATE INDEX idx_channels_guild_position ON channels (guild_id, position) WHERE guild_id IS NOT NULL;
CREATE INDEX idx_channels_parent_id ON channels (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_channels_owner_id ON channels (owner_id) WHERE owner_id IS NOT NULL;

-- Deferred FKs for guild default channels
ALTER TABLE guilds ADD CONSTRAINT fk_guilds_afk_channel
    FOREIGN KEY (afk_channel_id) REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE guilds ADD CONSTRAINT fk_guilds_system_channel
    FOREIGN KEY (system_channel_id) REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE guilds ADD CONSTRAINT fk_guilds_rules_channel
    FOREIGN KEY (rules_channel_id) REFERENCES channels(id) ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- messages
-- --------------------------------------------------------------------------
CREATE TABLE messages (
    id                  BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    channel_id          BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content             TEXT,
    type                SMALLINT NOT NULL DEFAULT 0,
    flags               BIGINT NOT NULL DEFAULT 0,
    tts                 BOOLEAN NOT NULL DEFAULT FALSE,
    mention_everyone    BOOLEAN NOT NULL DEFAULT FALSE,
    pinned              BOOLEAN NOT NULL DEFAULT FALSE,
    edited_timestamp    TIMESTAMPTZ,
    message_reference   JSONB,
    nonce               VARCHAR(25),
    embeds              JSONB NOT NULL DEFAULT '[]'::JSONB,
    attachments         JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_channel_id ON messages (channel_id, id DESC);
CREATE INDEX idx_messages_author_id ON messages (author_id, created_at DESC);
CREATE INDEX idx_messages_channel_pinned ON messages (channel_id) WHERE pinned = TRUE;

-- --------------------------------------------------------------------------
-- message_mentions
-- --------------------------------------------------------------------------
CREATE TABLE message_mentions (
    message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_message_mentions_user_id ON message_mentions (user_id);

-- --------------------------------------------------------------------------
-- roles
-- --------------------------------------------------------------------------
CREATE TABLE roles (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    color           INTEGER NOT NULL DEFAULT 0,
    hoist           BOOLEAN NOT NULL DEFAULT FALSE,
    icon            TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    permissions     BIGINT NOT NULL DEFAULT 0,
    managed         BOOLEAN NOT NULL DEFAULT FALSE,
    mentionable     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roles_guild_id ON roles (guild_id);
CREATE INDEX idx_roles_guild_position ON roles (guild_id, position);

-- --------------------------------------------------------------------------
-- guild_members
-- --------------------------------------------------------------------------
CREATE TABLE guild_members (
    guild_id                    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id                     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nick                        VARCHAR(32),
    avatar                      TEXT,
    joined_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    premium_since               TIMESTAMPTZ,
    deaf                        BOOLEAN NOT NULL DEFAULT FALSE,
    mute                        BOOLEAN NOT NULL DEFAULT FALSE,
    pending                     BOOLEAN NOT NULL DEFAULT FALSE,
    communication_disabled_until TIMESTAMPTZ,

    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX idx_guild_members_user_id ON guild_members (user_id);
CREATE INDEX idx_guild_members_joined_at ON guild_members (guild_id, joined_at);

-- --------------------------------------------------------------------------
-- member_roles
-- --------------------------------------------------------------------------
CREATE TABLE member_roles (
    guild_id    BIGINT NOT NULL,
    user_id     BIGINT NOT NULL,
    role_id     BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,

    PRIMARY KEY (guild_id, user_id, role_id),
    CONSTRAINT fk_member_roles_member
        FOREIGN KEY (guild_id, user_id)
        REFERENCES guild_members(guild_id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_member_roles_role_id ON member_roles (role_id);
CREATE INDEX idx_member_roles_user ON member_roles (user_id, guild_id);

-- --------------------------------------------------------------------------
-- permission_overwrites
-- --------------------------------------------------------------------------
CREATE TABLE permission_overwrites (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    channel_id      BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    type            SMALLINT NOT NULL,       -- 0 = role, 1 = member
    target_id       BIGINT NOT NULL,
    allow           BIGINT NOT NULL DEFAULT 0,
    deny            BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT uq_permission_overwrites UNIQUE (channel_id, type, target_id),
    CONSTRAINT ck_overwrite_type CHECK (type IN (0, 1))
);

CREATE INDEX idx_permission_overwrites_channel_id ON permission_overwrites (channel_id);
CREATE INDEX idx_permission_overwrites_target_id ON permission_overwrites (target_id);

-- --------------------------------------------------------------------------
-- dm_channels
-- --------------------------------------------------------------------------
CREATE TABLE dm_channels (
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_dm_channels_user_id ON dm_channels (user_id);
CREATE INDEX idx_dm_channels_channel_id ON dm_channels (channel_id);

-- --------------------------------------------------------------------------
-- relationships
-- --------------------------------------------------------------------------
CREATE TABLE relationships (
    id          BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        SMALLINT NOT NULL,   -- 1=friend, 2=blocked, 3=pending_in, 4=pending_out
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_relationships UNIQUE (user_id, target_id),
    CONSTRAINT ck_relationship_type CHECK (type IN (1, 2, 3, 4)),
    CONSTRAINT ck_relationships_no_self CHECK (user_id != target_id)
);

CREATE INDEX idx_relationships_user_id ON relationships (user_id, type);
CREATE INDEX idx_relationships_target_id ON relationships (target_id, type);

-- --------------------------------------------------------------------------
-- message_reactions
-- --------------------------------------------------------------------------
CREATE TABLE message_reactions (
    id          BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji_id    BIGINT,                          -- NULL for unicode emoji
    emoji_name  VARCHAR(64) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_message_reactions_user_emoji
    ON message_reactions (message_id, user_id, emoji_name, COALESCE(emoji_id, 0));

CREATE INDEX idx_message_reactions_message_id ON message_reactions (message_id);
CREATE INDEX idx_message_reactions_user_id ON message_reactions (user_id);
CREATE INDEX idx_message_reactions_emoji_id ON message_reactions (emoji_id) WHERE emoji_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- read_states
-- --------------------------------------------------------------------------
CREATE TABLE read_states (
    user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id          BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_message_id     BIGINT NOT NULL DEFAULT 0,
    mention_count       INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id, channel_id),
    CONSTRAINT ck_mention_count CHECK (mention_count >= 0)
);

CREATE INDEX idx_read_states_channel_id ON read_states (channel_id);

-- --------------------------------------------------------------------------
-- invites
-- --------------------------------------------------------------------------
CREATE TABLE invites (
    code            VARCHAR(32) PRIMARY KEY,
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id      BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    inviter_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    max_uses        INTEGER NOT NULL DEFAULT 0,
    uses            INTEGER NOT NULL DEFAULT 0,
    max_age         INTEGER NOT NULL DEFAULT 86400,
    temporary       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_invites_max_uses CHECK (max_uses >= 0),
    CONSTRAINT ck_invites_uses CHECK (uses >= 0),
    CONSTRAINT ck_invites_max_age CHECK (max_age >= 0)
);

CREATE INDEX idx_invites_guild_id ON invites (guild_id);
CREATE INDEX idx_invites_channel_id ON invites (channel_id);
CREATE INDEX idx_invites_inviter_id ON invites (inviter_id) WHERE inviter_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- bans
-- --------------------------------------------------------------------------
CREATE TABLE bans (
    guild_id    BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      VARCHAR(512),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX idx_bans_user_id ON bans (user_id);

-- --------------------------------------------------------------------------
-- audit_log_entries
-- --------------------------------------------------------------------------
CREATE TABLE audit_log_entries (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    target_id       BIGINT,
    action_type     SMALLINT NOT NULL,
    changes         JSONB,
    reason          VARCHAR(512),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_guild_id ON audit_log_entries (guild_id, id DESC);
CREATE INDEX idx_audit_log_user_id ON audit_log_entries (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_log_target_id ON audit_log_entries (target_id) WHERE target_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- emojis
-- --------------------------------------------------------------------------
CREATE TABLE emojis (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name            VARCHAR(32) NOT NULL,
    creator_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    animated        BOOLEAN NOT NULL DEFAULT FALSE,
    managed         BOOLEAN NOT NULL DEFAULT FALSE,
    available       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_emojis_guild_id ON emojis (guild_id);
CREATE INDEX idx_emojis_creator_id ON emojis (creator_id) WHERE creator_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- attachments
-- --------------------------------------------------------------------------
CREATE TABLE attachments (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    message_id      BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename        VARCHAR(260) NOT NULL,
    content_type    VARCHAR(128),
    size            INTEGER NOT NULL,
    url             VARCHAR(2048) NOT NULL,
    proxy_url       VARCHAR(2048),
    width           INTEGER,
    height          INTEGER
);

CREATE INDEX idx_attachments_message_id ON attachments (message_id);

-- --------------------------------------------------------------------------
-- webhooks
-- --------------------------------------------------------------------------
CREATE TABLE webhooks (
    id              BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id        BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id      BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    type            SMALLINT NOT NULL DEFAULT 1,
    name            VARCHAR(80) NOT NULL,
    avatar          TEXT,
    token           VARCHAR(68),
    creator_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_webhooks_token UNIQUE (token)
);

CREATE INDEX idx_webhooks_guild_id ON webhooks (guild_id);
CREATE INDEX idx_webhooks_channel_id ON webhooks (channel_id);
CREATE INDEX idx_webhooks_creator_id ON webhooks (creator_id) WHERE creator_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- user_settings
-- --------------------------------------------------------------------------
CREATE TABLE user_settings (
    user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings    JSONB NOT NULL DEFAULT '{}'::JSONB
);

-- --------------------------------------------------------------------------
-- notification_settings
-- --------------------------------------------------------------------------
CREATE TABLE notification_settings (
    user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_id                BIGINT REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id              BIGINT REFERENCES channels(id) ON DELETE CASCADE,
    muted                   BOOLEAN NOT NULL DEFAULT FALSE,
    message_notifications   SMALLINT NOT NULL DEFAULT 0,
    suppress_everyone       BOOLEAN NOT NULL DEFAULT FALSE,
    suppress_roles          BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT uq_notification_settings UNIQUE (user_id, guild_id, channel_id)
);

CREATE INDEX idx_notification_settings_user_id ON notification_settings (user_id);
CREATE INDEX idx_notification_settings_guild_id ON notification_settings (guild_id) WHERE guild_id IS NOT NULL;
CREATE INDEX idx_notification_settings_channel_id ON notification_settings (channel_id) WHERE channel_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- auth_tokens
-- --------------------------------------------------------------------------
CREATE TABLE auth_tokens (
    token           VARCHAR(128) PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_auth_tokens_user_id ON auth_tokens (user_id);
CREATE INDEX idx_auth_tokens_expires_at ON auth_tokens (expires_at);

-- --------------------------------------------------------------------------
-- password_reset_tokens
-- --------------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
    token           VARCHAR(128) PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);

-- --------------------------------------------------------------------------
-- threads (stored as channels with thread_metadata, but we track members)
-- --------------------------------------------------------------------------
CREATE TABLE thread_members (
    channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX idx_thread_members_user_id ON thread_members (user_id);

-- --------------------------------------------------------------------------
-- automod_rules
-- --------------------------------------------------------------------------
CREATE TABLE automod_rules (
    id                  BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id            BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,
    event_type          SMALLINT NOT NULL DEFAULT 1,
    trigger_type        SMALLINT NOT NULL,
    trigger_metadata    JSONB NOT NULL DEFAULT '{}'::JSONB,
    actions             JSONB NOT NULL DEFAULT '[]'::JSONB,
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    exempt_roles        BIGINT[] NOT NULL DEFAULT '{}',
    exempt_channels     BIGINT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automod_rules_guild_id ON automod_rules (guild_id);

-- Guild scheduled events
CREATE TABLE scheduled_events (
    id                     BIGINT PRIMARY KEY DEFAULT generate_snowflake(),
    guild_id               BIGINT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id             BIGINT REFERENCES channels(id) ON DELETE SET NULL,
    creator_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                   VARCHAR(100) NOT NULL,
    description            TEXT,
    scheduled_start_time   TIMESTAMPTZ NOT NULL,
    scheduled_end_time     TIMESTAMPTZ,
    entity_type            SMALLINT NOT NULL DEFAULT 3,  -- 1=stage,2=voice,3=external
    entity_metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    status                 SMALLINT NOT NULL DEFAULT 1,  -- 1=scheduled,2=active,3=completed,4=canceled
    privacy_level          SMALLINT NOT NULL DEFAULT 2,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_events_guild_id ON scheduled_events (guild_id);

-- --------------------------------------------------------------------------
-- channel_followers  (announcement channel following / cross-posting)
--   A row means: messages published in source_channel_id are cross-posted to
--   target_channel_id via webhook_id.
-- --------------------------------------------------------------------------
CREATE TABLE channel_followers (
    source_channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_channel_id  BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    webhook_id         BIGINT REFERENCES webhooks(id) ON DELETE SET NULL,
    created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (source_channel_id, target_channel_id)
);

CREATE INDEX idx_channel_followers_source ON channel_followers (source_channel_id);
CREATE INDEX idx_channel_followers_target ON channel_followers (target_channel_id);

-- --------------------------------------------------------------------------
-- scheduled_event_users  (RSVP / "interested" for scheduled events)
-- --------------------------------------------------------------------------
CREATE TABLE scheduled_event_users (
    event_id   BIGINT NOT NULL REFERENCES scheduled_events(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX idx_scheduled_event_users_event ON scheduled_event_users (event_id);
CREATE INDEX idx_scheduled_event_users_user  ON scheduled_event_users (user_id);
