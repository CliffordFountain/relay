-- Migration: Add missing columns for voice channel fields and user profile fields
-- Run with: docker compose exec postgres psql -U relay -d relay -f /dev/stdin < scripts/migrate_add_columns.sql
-- Or:       docker compose exec -T postgres psql -U relay -d relay < scripts/migrate_add_columns.sql

-- Add rtc_region and video_quality_mode to channels table
ALTER TABLE channels ADD COLUMN IF NOT EXISTS rtc_region VARCHAR(32);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS video_quality_mode SMALLINT NOT NULL DEFAULT 1;

-- Add banner_color to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_color VARCHAR(7);

-- Add accent_color (integer representation of banner_color) to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color INTEGER;

-- Add pronouns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns VARCHAR(40) NOT NULL DEFAULT '';

-- Add date_of_birth to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Add deleted_at for soft-delete support
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add verified column for email verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Add image column to emojis table for storing base64 data URI
ALTER TABLE emojis ADD COLUMN IF NOT EXISTS image TEXT;

-- Add partial unique indexes for notification_settings upserts with NULL channel_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_settings_guild
    ON notification_settings (user_id, guild_id) WHERE channel_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_settings_channel
    ON notification_settings (user_id, channel_id) WHERE channel_id IS NOT NULL;
