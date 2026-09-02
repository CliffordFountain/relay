-- Backfill: Add default "Text Channels" and "Voice Channels" categories
-- to guilds that are missing them. Also reparent existing channels under
-- the appropriate category based on channel type.
--
-- Run with:
--   docker compose exec -T postgres psql -U relay -d relay < scripts/backfill_categories.sql

-- Step 1: Create "Text Channels" category (type 4, position 0) for guilds
-- that have no type-4 channels at all.
INSERT INTO channels (id, guild_id, type, name, position)
SELECT generate_snowflake(), g.id, 4, 'Text Channels', 0
FROM guilds g
WHERE NOT EXISTS (
    SELECT 1 FROM channels c WHERE c.guild_id = g.id AND c.type = 4
);

-- Step 2: Create "Voice Channels" category (type 4, position 1) for guilds
-- that now have exactly one category (the one we just created).
INSERT INTO channels (id, guild_id, type, name, position)
SELECT generate_snowflake(), g.id, 4, 'Voice Channels', 1
FROM guilds g
WHERE (
    SELECT COUNT(*) FROM channels c WHERE c.guild_id = g.id AND c.type = 4
) = 1;

-- Step 3: Reparent orphan text channels (type 0, 5, 15) that have no
-- parent_id, putting them under the "Text Channels" category.
UPDATE channels ch
SET parent_id = cat.id
FROM (
    SELECT id, guild_id
    FROM channels
    WHERE type = 4 AND name = 'Text Channels'
) cat
WHERE ch.guild_id = cat.guild_id
  AND ch.parent_id IS NULL
  AND ch.type IN (0, 5, 15)  -- text, announcement, forum
;

-- Step 4: Reparent orphan voice channels (type 2, 13) that have no
-- parent_id, putting them under the "Voice Channels" category.
UPDATE channels ch
SET parent_id = cat.id
FROM (
    SELECT id, guild_id
    FROM channels
    WHERE type = 4 AND name = 'Voice Channels'
) cat
WHERE ch.guild_id = cat.guild_id
  AND ch.parent_id IS NULL
  AND ch.type IN (2, 13)  -- voice, stage
;
