-- ============================================================================
--  Relay — default development accounts
-- ----------------------------------------------------------------------------
--  Seeded into a FRESH database automatically: Docker mounts this file into
--  /docker-entrypoint-initdb.d and Postgres runs it once, right after
--  01-schema.sql, the first time the data volume is created.
--
--    username | role
--    ---------+---------------------------------
--    owner    | demo server owner / admin
--    player1  | regular member
--    player2  | regular member
--
--  All three share ONE password, which is NOT stored here. It is supplied at seed
--  time from RELAY_DEMO_PASSWORD_HASH (an argon2id hash the operator sets in .env);
--  init-db.sh passes it in as the psql variable :demo_pw_hash and only runs this file
--  when RELAY_SEED_DEMO=true AND that hash is set. So a public repo/deploy ships NO
--  usable credential. These accounts are for LOCAL DEVELOPMENT only — never seed them
--  on a real deployment. Re-running is safe (ON CONFLICT DO NOTHING).
-- ============================================================================

-- The password hash is NOT hardcoded here (shipping a shared credential in a public repo
-- would let anyone log into any default deployment). It comes from the psql variable
-- :demo_pw_hash, which init-db.sh passes from RELAY_DEMO_PASSWORD_HASH (an argon2id hash
-- the operator sets in their own .env). All three demo accounts share that one password.
INSERT INTO users (username, display_name, email, password_hash, date_of_birth) VALUES
  ('owner',   'Relay Owner', 'owner@relay.local',   :'demo_pw_hash', '2000-01-01'),
  ('player1', 'Player One',  'player1@relay.local', :'demo_pw_hash', '2000-01-01'),
  ('player2', 'Player Two',  'player2@relay.local', :'demo_pw_hash', '2000-01-01')
ON CONFLICT DO NOTHING;

-- ============================================================================
--  Relay — demo server ("Relay HQ")
-- ----------------------------------------------------------------------------
--  Gives the seeded `owner` account a ready-to-explore community so a fresh
--  install opens on something real instead of an empty home screen. Mirrors
--  exactly what the app's own "create a server" flow builds: an @everyone role
--  (role id == guild id, permission bits 104324673), an owner membership, a
--  TEXT CHANNELS and a VOICE CHANNELS category, a #general text channel and a
--  voice channel. player1 and player2 join as members, and #general starts with
--  a short welcome conversation.
--
--  Idempotent: does nothing if the demo server already exists, so re-running
--  seed.sql is safe.
-- ============================================================================

DO $$
DECLARE
  v_owner    BIGINT;
  v_p1       BIGINT;
  v_p2       BIGINT;
  v_guild    BIGINT;
  v_text_cat BIGINT;
  v_general  BIGINT;
  v_intro    BIGINT;
  v_offtopic BIGINT;
  v_voice_cat BIGINT;
BEGIN
  SELECT id INTO v_owner FROM users WHERE username = 'owner';
  SELECT id INTO v_p1    FROM users WHERE username = 'player1';
  SELECT id INTO v_p2    FROM users WHERE username = 'player2';

  -- No owner account -> nothing to seed.
  IF v_owner IS NULL THEN
    RETURN;
  END IF;

  -- Already seeded -> stay idempotent.
  IF EXISTS (SELECT 1 FROM guilds WHERE owner_id = v_owner AND name = 'Relay HQ') THEN
    RETURN;
  END IF;

  INSERT INTO guilds (name, owner_id, description)
    VALUES ('Relay HQ', v_owner, 'The demo community that ships with Relay. Say hello!')
    RETURNING id INTO v_guild;

  -- @everyone role: id == guild id, standard default permission bitmask.
  INSERT INTO roles (id, guild_id, name, position, permissions)
    VALUES (v_guild, v_guild, '@everyone', 0, 104324673);

  -- Memberships.
  INSERT INTO guild_members (guild_id, user_id) VALUES (v_guild, v_owner);
  IF v_p1 IS NOT NULL THEN
    INSERT INTO guild_members (guild_id, user_id) VALUES (v_guild, v_p1);
  END IF;
  IF v_p2 IS NOT NULL THEN
    INSERT INTO guild_members (guild_id, user_id) VALUES (v_guild, v_p2);
  END IF;

  -- TEXT CHANNELS category + text channels.
  INSERT INTO channels (guild_id, name, type, position)
    VALUES (v_guild, 'TEXT CHANNELS', 4, 0) RETURNING id INTO v_text_cat;
  INSERT INTO channels (guild_id, name, type, position, parent_id, topic)
    VALUES (v_guild, 'general', 0, 0, v_text_cat, 'General chatter for the whole server.')
    RETURNING id INTO v_general;
  INSERT INTO channels (guild_id, name, type, position, parent_id, topic)
    VALUES (v_guild, 'introductions', 0, 1, v_text_cat, 'New here? Tell everyone a little about yourself.')
    RETURNING id INTO v_intro;
  INSERT INTO channels (guild_id, name, type, position, parent_id, topic)
    VALUES (v_guild, 'off-topic', 0, 2, v_text_cat, 'Anything goes. Be excellent to each other.')
    RETURNING id INTO v_offtopic;
  INSERT INTO channels (guild_id, name, type, position, parent_id, topic)
    VALUES (v_guild, 'announcements', 5, 3, v_text_cat, 'Official updates. Follow this channel to repost them in your own server.');

  -- VOICE CHANNELS category + voice channel.
  INSERT INTO channels (guild_id, name, type, position)
    VALUES (v_guild, 'VOICE CHANNELS', 4, 1) RETURNING id INTO v_voice_cat;
  INSERT INTO channels (guild_id, name, type, position, parent_id)
    VALUES (v_guild, 'Lounge', 2, 0, v_voice_cat);

  -- A short welcome conversation so #general is not empty on first open.
  INSERT INTO messages (channel_id, author_id, content) VALUES
    (v_general, v_owner, 'Welcome to Relay HQ! This is the demo server that ships with a fresh install.'),
    (v_general, v_owner, 'Create channels, invite people, or start a voice call. Everything here runs on your own machine.');
  IF v_p1 IS NOT NULL THEN
    INSERT INTO messages (channel_id, author_id, content)
      VALUES (v_general, v_p1, 'Hey everyone, glad to be here!');
  END IF;
  IF v_p2 IS NOT NULL THEN
    INSERT INTO messages (channel_id, author_id, content)
      VALUES (v_general, v_p2, 'Testing, testing... looks like it works.');
  END IF;

  -- System channel + last-message pointer.
  UPDATE guilds SET system_channel_id = v_general WHERE id = v_guild;
  UPDATE channels
    SET last_message_id = (SELECT max(id) FROM messages WHERE channel_id = v_general)
    WHERE id = v_general;
END $$;
