defmodule Gateway.SocketHandler do
  @moduledoc "Cowboy WebSocket handler for gateway connections."
  @behaviour :cowboy_websocket

  require Logger
  import Bitwise
  alias Gateway.Opcodes

  @heartbeat_interval 41250

  # Gateway Intent bits
  @intent_guilds                    1
  @intent_guild_members             2
  @intent_guild_moderation          4
  @intent_guild_emojis              8
  @intent_guild_voice_states      128
  @intent_guild_presences         256
  @intent_guild_messages          512
  @intent_guild_message_reactions 1024
  @intent_guild_message_typing    2048
  @intent_direct_messages         4096
  @intent_direct_message_reactions 8192
  @intent_direct_message_typing   16384

  # Session resume buffer: 3-minute TTL, max 500 events
  @resume_ttl 180
  @resume_max_events 500

  @impl true
  def init(req, _state) do
    Logger.debug("New WebSocket connection from #{inspect(req.peer)}")

    {:cowboy_websocket, req,
     %{
       user_id: nil,
       session_id: nil,
       sequence: 0,
       identified: false,
       heartbeat_ref: nil,
       heartbeat_acked: true,
       intents: 0,
       guild_ids: []
     }}
  end

  @impl true
  def websocket_init(state) do
    # Send Hello with heartbeat_interval
    hello = %{
      "op" => Opcodes.hello(),
      "d" => %{"heartbeat_interval" => @heartbeat_interval, "_trace" => ["gateway-#{node()}"]}
    }

    # Set up heartbeat timeout check
    ref = Process.send_after(self(), :heartbeat_timeout, @heartbeat_interval + 15_000)

    {[{:text, Jason.encode!(hello)}], %{state | heartbeat_ref: ref}}
  end

  @impl true
  def websocket_handle({:text, data}, state) do
    case Jason.decode(data) do
      {:ok, %{"op" => op} = payload} ->
        handle_opcode(op, payload, state)

      {:error, _} ->
        Logger.warning("Failed to decode WebSocket message")
        close_with_code(4002, "Decode error", state)
    end
  end

  def websocket_handle(_frame, state) do
    {:ok, state}
  end

  @impl true
  def websocket_info(:heartbeat_timeout, state) do
    if state.heartbeat_acked do
      # Reset for next heartbeat cycle
      ref = Process.send_after(self(), :heartbeat_timeout, @heartbeat_interval + 15_000)
      {:ok, %{state | heartbeat_ref: ref, heartbeat_acked: false}}
    else
      Logger.info("Heartbeat timeout for session #{state.session_id}")
      close_with_code(4009, "Session timed out", state)
    end
  end

  def websocket_info({:dispatch, "GUILD_CREATE" = event_name, data}, state) do
    # GUILD_CREATE requires GUILDS intent
    if (state.intents &&& @intent_guilds) == 0 do
      {:ok, state}
    else
      # When GUILD_CREATE arrives for a guild we're not yet subscribed to (e.g. after
      # accepting an invite), subscribe to its events for future real-time updates.
      guild_id_str = data["id"]
      new_state =
        if guild_id_str && state.identified do
          guild_id = String.to_integer(guild_id_str)
          if guild_id not in state.guild_ids do
            Guild.GuildServer.subscribe(guild_id, self(), state.user_id)
            %{state | guild_ids: [guild_id | state.guild_ids]}
          else
            state
          end
        else
          state
        end

      seq = new_state.sequence + 1
      payload = %{"op" => Opcodes.dispatch(), "d" => data, "s" => seq, "t" => event_name}
      save_replay(new_state.session_id, seq, event_name, data)
      {[{:text, Jason.encode!(payload)}], %{new_state | sequence: seq}}
    end
  end

  def websocket_info({:dispatch, event_name, data}, state) do
    if should_dispatch?(event_name, data, state.intents) do
      seq = state.sequence + 1
      payload = %{"op" => Opcodes.dispatch(), "d" => data, "s" => seq, "t" => event_name}
      save_replay(state.session_id, seq, event_name, data)
      {[{:text, Jason.encode!(payload)}], %{state | sequence: seq}}
    else
      {:ok, state}
    end
  end

  def websocket_info(_msg, state) do
    {:ok, state}
  end

  @impl true
  def terminate(_reason, _req, state) do
    if state.heartbeat_ref, do: Process.cancel_timer(state.heartbeat_ref)

    # Set presence to offline
    if state.user_id do
      Redix.command(:redix, [
        "HSET", "presence:#{state.user_id}",
        "status", "offline",
        "client_status_web", "offline"
      ])
      Redix.command(:redix, ["EXPIRE", "presence:#{state.user_id}", 60])

      # Remove from each guild's online-members set and publish offline presence
      Enum.each(state.guild_ids, fn gid ->
        Redix.command(:redix, ["SREM", "guild:#{gid}:online_members", to_string(state.user_id)])

        offline_event = %{
          "t" => "PRESENCE_UPDATE",
          "d" => %{
            "user" => %{"id" => to_string(state.user_id)},
            "guild_id" => to_string(gid),
            "status" => "offline",
            "client_status" => %{},
            "activities" => []
          }
        }
        Redix.command(:redix, ["PUBLISH", "guild:#{gid}", Jason.encode!(offline_event)])

        # Also drop any persisted voice state and tell everyone still connected that
        # this user left voice. Without this, a user who disconnects while sitting in a
        # voice channel would linger in every other member's roster forever (and would
        # never be cleared from the persisted `voice:guild:*` hash read on READY).
        Redix.command(:redix, ["HDEL", voice_guild_key(gid), to_string(state.user_id)])

        leave_voice_state = %{
          "guild_id" => to_string(gid),
          "channel_id" => nil,
          "user_id" => to_string(state.user_id),
          "member" => %{"user" => %{"id" => to_string(state.user_id)}}
        }

        case Registry.lookup(Gateway.GuildRegistry, gid) do
          [{pid, _}] -> GenServer.cast(pid, {:dispatch, "VOICE_STATE_UPDATE", leave_voice_state})
          [] -> :ok
        end
      end)
    end

    # Unsubscribe from all guild processes
    Enum.each(state.guild_ids, fn gid ->
      Guild.GuildServer.unsubscribe(gid, self())
    end)

    # Unsubscribe from user-specific DM channel
    if state.user_id do
      Gateway.RedisSubscriber.unsubscribe("user:#{state.user_id}")
    end

    Logger.debug("WebSocket connection closed for user #{state.user_id}")
    :ok
  end

  # --- Opcode Handlers ---

  defp handle_opcode(1, _payload, state) do
    # Heartbeat - respond with HeartbeatACK
    ack = %{"op" => Opcodes.heartbeat_ack()}

    # Reset heartbeat timer
    if state.heartbeat_ref, do: Process.cancel_timer(state.heartbeat_ref)
    ref = Process.send_after(self(), :heartbeat_timeout, @heartbeat_interval + 15_000)

    # Refresh presence TTL on heartbeat
    if state.user_id do
      Redix.command(:redix, ["EXPIRE", "presence:#{state.user_id}", 300])
    end

    # Refresh session meta TTL for resume eligibility
    if state.session_id do
      Redix.command(:redix, ["EXPIRE", "session:meta:#{state.session_id}", 300])
    end

    {[{:text, Jason.encode!(ack)}], %{state | heartbeat_acked: true, heartbeat_ref: ref}}
  end

  defp handle_opcode(2, %{"d" => data}, state) do
    # Identify
    if state.identified do
      close_with_code(4005, "Already authenticated", state)
    else
      handle_identify(data, state)
    end
  end

  defp handle_opcode(3, %{"d" => data}, %{identified: true} = state) do
    # Presence Update from client
    status = data["status"] || "online"
    valid_status = if status in ["online", "idle", "dnd", "invisible"], do: status, else: "online"

    if state.user_id do
      redis_status = if valid_status == "invisible", do: "offline", else: valid_status

      Redix.command(:redix, [
        "HSET", "presence:#{state.user_id}",
        "status", redis_status,
        "client_status_web", redis_status
      ])
      Redix.command(:redix, ["EXPIRE", "presence:#{state.user_id}", 300])

      # Update guild online-member sets based on effective status
      Enum.each(state.guild_ids, fn gid ->
        if redis_status == "offline" do
          Redix.command(:redix, ["SREM", "guild:#{gid}:online_members", to_string(state.user_id)])
        else
          Redix.command(:redix, ["SADD", "guild:#{gid}:online_members", to_string(state.user_id)])
          Redix.command(:redix, ["EXPIRE", "guild:#{gid}:online_members", 86400])
        end

        presence_event = %{
          "t" => "PRESENCE_UPDATE",
          "d" => %{
            "user" => %{"id" => to_string(state.user_id)},
            "guild_id" => to_string(gid),
            "status" => redis_status,
            "client_status" => %{"web" => redis_status},
            "activities" => []
          }
        }
        Redix.command(:redix, ["PUBLISH", "guild:#{gid}", Jason.encode!(presence_event)])
      end)
    end

    {:ok, state}
  end

  defp handle_opcode(4, %{"d" => data}, %{identified: true} = state) do
    # Voice State Update. Requires an identified session (head guard), and the caller must be
    # a member of the target guild: otherwise an authenticated client could spoof voice
    # presence in — or probe — any guild by sending an arbitrary guild_id. Parse defensively
    # (a bad guild_id must not crash the socket) and ignore non-member / malformed guilds.
    guild_id = data["guild_id"]
    gid = safe_to_integer(guild_id)

    if gid == nil or gid not in state.guild_ids do
      {:ok, state}
    else
      channel_id = data["channel_id"]
      self_mute = data["self_mute"] || false
      self_deaf = data["self_deaf"] || false
      self_video = data["self_video"] || false
      self_stream = data["self_stream"] || false

      voice_state = %{
        "guild_id" => guild_id,
        "channel_id" => channel_id,
        "user_id" => to_string(state.user_id),
        "session_id" => state.session_id,
        "deaf" => false,
        "mute" => false,
        "self_deaf" => self_deaf,
        "self_mute" => self_mute,
        "self_video" => self_video,
        "self_stream" => self_stream,
        "suppress" => false,
        # Include the member's public identity so other clients can render this user in
        # the voice channel roster without a separate member lookup.
        "member" => %{"user" => load_user_map(state.user_id)}
      }

      # Persist the voice state so members who connect LATER learn who is already in each
      # voice channel (the READY payload reads this back as `voice_states`).
      persist_voice_state(guild_id, state.user_id, channel_id, self_mute, self_deaf, self_video, self_stream)

      # Fan the voice state out to every connected member of the guild via its GuildServer.
      case Registry.lookup(Gateway.GuildRegistry, gid) do
        [{pid, _}] -> GenServer.cast(pid, {:dispatch, "VOICE_STATE_UPDATE", voice_state})
        [] -> :ok
      end

      if channel_id do
        # User is joining/moving to a voice channel - send VOICE_SERVER_UPDATE
        voice_server = %{
          "op" => Opcodes.dispatch(),
          "d" => %{
            "token" => UUID.uuid4(),
            "guild_id" => guild_id,
            # LAN-reachable voice-server host:port advertised to clients (defaults to the host LAN IP)
            "endpoint" => System.get_env("VOICE_PUBLIC_ENDPOINT") || "localhost:4001"
          },
          "s" => state.sequence + 1,
          "t" => "VOICE_SERVER_UPDATE"
        }

        {[{:text, Jason.encode!(voice_server)}], %{state | sequence: state.sequence + 1}}
      else
        # User is leaving voice
        {:ok, state}
      end
    end
  end

  defp handle_opcode(6, %{"d" => data}, state) do
    # Resume - validate session and replay missed events
    token = data["token"]
    session_id = data["session_id"]
    # A non-integer "seq" from the client must not crash the socket (it is later used in
    # integer arithmetic when building the replay range).
    req_seq =
      case data["seq"] do
        n when is_integer(n) and n >= 0 -> n
        _ -> 0
      end

    Logger.info("Resume requested for session #{session_id} from seq #{req_seq}")

    case validate_token(token) do
      {:ok, user_id} ->
        case get_session_meta(session_id, user_id) do
          {:ok, meta} ->
            guild_ids =
              meta
              |> Map.get("guild_ids", [])
              |> Enum.map(&String.to_integer/1)

            saved_intents = Map.get(meta, "intents", 0)

            # Re-subscribe to guild processes
            Enum.each(guild_ids, fn gid ->
              Guild.GuildServer.subscribe(gid, self(), user_id)
            end)

            # Re-register in session registry and re-subscribe to user channel
            Registry.register(Gateway.SessionRegistry, user_id, self())
            Gateway.RedisSubscriber.subscribe("user:#{user_id}")

            # Restore presence
            Redix.command(:redix, [
              "HSET", "presence:#{user_id}",
              "status", "online",
              "client_status_web", "online"
            ])
            Redix.command(:redix, ["EXPIRE", "presence:#{user_id}", 300])

            # Send RESUMED dispatch
            seq = state.sequence + 1
            resumed = %{"op" => Opcodes.dispatch(), "d" => %{}, "s" => seq, "t" => "RESUMED"}

            # Build replay frames for missed events
            replay_entries = get_replay_entries(session_id, req_seq)
            {replay_frames, final_seq} =
              Enum.reduce(replay_entries, {[], seq}, fn entry, {frames, s} ->
                new_s = s + 1
                payload = %{
                  "op" => Opcodes.dispatch(),
                  "d" => entry["d"],
                  "s" => new_s,
                  "t" => entry["t"]
                }
                {frames ++ [{:text, Jason.encode!(payload)}], new_s}
              end)

            Logger.info("Session #{session_id} resumed, replaying #{length(replay_entries)} events")

            new_state = %{state |
              identified: true,
              user_id: user_id,
              session_id: session_id,
              sequence: final_seq,
              intents: saved_intents,
              guild_ids: guild_ids
            }

            {[{:text, Jason.encode!(resumed)}] ++ replay_frames, new_state}

          :error ->
            Logger.info("Session #{session_id} not found or expired, sending Invalid Session")
            invalid = %{"op" => Opcodes.invalid_session(), "d" => false}
            {[{:text, Jason.encode!(invalid)}], state}
        end

      {:error, :invalid_token} ->
        Logger.warning("Invalid token during Resume")
        invalid = %{"op" => Opcodes.invalid_session(), "d" => false}
        {[{:text, Jason.encode!(invalid)}], state}
    end
  end

  defp handle_opcode(8, %{"d" => data}, %{identified: true} = state) do
    # Request Guild Members - return an empty GUILD_MEMBERS_CHUNK
    # Full implementation requires a data-services query; this satisfies the protocol.
    guild_id = data["guild_id"]
    nonce = data["nonce"]

    if guild_id do
      seq = state.sequence + 1
      chunk = %{
        "op" => Opcodes.dispatch(),
        "d" => %{
          "guild_id" => guild_id,
          "members" => [],
          "chunk_index" => 0,
          "chunk_count" => 1,
          "not_found" => [],
          "presences" => [],
          "nonce" => nonce
        },
        "s" => seq,
        "t" => "GUILD_MEMBERS_CHUNK"
      }
      {[{:text, Jason.encode!(chunk)}], %{state | sequence: seq}}
    else
      {:ok, state}
    end
  end

  defp handle_opcode(op, _payload, state) do
    Logger.warning("Unhandled opcode: #{op}")
    {:ok, state}
  end

  # --- Identify Handler ---

  defp handle_identify(data, state) do
    token = data["token"]
    # A non-integer "intents" from the client must not crash the socket (it is later used
    # in bitwise AND for intent filtering).
    intents =
      case data["intents"] do
        n when is_integer(n) and n >= 0 -> n
        _ -> 0
      end

    case validate_token(token) do
      {:ok, user_id} ->
        session_id = UUID.uuid4()

        # Load user's guild IDs from Redis (set at auth:user:{user_id}:guilds)
        guild_ids = load_user_guild_ids(user_id)

        # Subscribe this session to each guild's GuildServer
        Enum.each(guild_ids, fn gid ->
          Guild.GuildServer.subscribe(gid, self(), user_id)
        end)

        guilds_payload =
          Enum.map(guild_ids, fn gid ->
            %{"id" => to_string(gid), "unavailable" => true}
          end)

        # Load user data from Redis cache (set by API during login)
        user_data =
          case Redix.command(:redix, ["GET", "auth:user:#{user_id}:data"]) do
            {:ok, nil} ->
              %{"id" => to_string(user_id), "username" => "unknown", "discriminator" => "0", "avatar" => nil}
            {:ok, json} ->
              case Jason.decode(json) do
                {:ok, d} -> d
                _ -> %{"id" => to_string(user_id), "username" => "unknown", "discriminator" => "0", "avatar" => nil}
              end
            _ ->
              %{"id" => to_string(user_id), "username" => "unknown", "discriminator" => "0", "avatar" => nil}
          end

        # Build the initial voice roster for every guild this user belongs to, reading the
        # persisted `voice:guild:*` hashes. This is what makes voice presence SYMMETRIC:
        # a client that connects after others are already in voice learns the full roster
        # here, instead of only ever seeing live VOICE_STATE_UPDATEs that fire post-connect.
        voice_states = build_voice_states(guild_ids)

        ready = %{
          "op" => Opcodes.dispatch(),
          "d" => %{
            "v" => 10,
            "user" => user_data,
            "guilds" => guilds_payload,
            "session_id" => session_id,
            # nil unless explicitly configured, so the client derives it from window.location (LAN-safe)
            "resume_gateway_url" => System.get_env("PUBLIC_GATEWAY_WS_URL"),
            "private_channels" => [],
            "relationships" => [],
            "presences" => [],
            "voice_states" => voice_states,
            "_trace" => ["gateway-#{node()}"]
          },
          "s" => 1,
          "t" => "READY"
        }

        # Register in SessionRegistry for DM event delivery
        {:ok, _} = Registry.register(Gateway.SessionRegistry, user_id, self())
        # Subscribe to user-specific Redis channel for DM events
        Gateway.RedisSubscriber.subscribe("user:#{user_id}")

        # Set presence in Redis
        Redix.command(:redix, [
          "HSET", "presence:#{user_id}",
          "status", "online",
          "client_status_web", "online"
        ])
        Redix.command(:redix, ["EXPIRE", "presence:#{user_id}", 300])

        # Track the user as online in each guild's online-members set, then
        # publish their PRESENCE_UPDATE to all guild members.
        Enum.each(guild_ids, fn gid ->
          # Add to guild online-members set (used when others connect later)
          Redix.command(:redix, ["SADD", "guild:#{gid}:online_members", to_string(user_id)])
          Redix.command(:redix, ["EXPIRE", "guild:#{gid}:online_members", 86400])

          presence_event = %{
            "t" => "PRESENCE_UPDATE",
            "d" => %{
              "user" => %{"id" => to_string(user_id)},
              "guild_id" => to_string(gid),
              "status" => "online",
              "client_status" => %{"web" => "online"},
              "activities" => []
            }
          }
          Redix.command(:redix, ["PUBLISH", "guild:#{gid}", Jason.encode!(presence_event)])
        end)

        # Save session metadata in Redis for session resume (opcode 6)
        session_meta = %{
          "user_id" => user_id,
          "intents" => intents,
          "guild_ids" => Enum.map(guild_ids, &to_string/1)
        }
        Redix.command(:redix, [
          "SET", "session:meta:#{session_id}",
          Jason.encode!(session_meta),
          "EX", "300"
        ])

        # Fetch already-online members for each guild and send their presences
        # to this newly-connecting session so the member list is correct immediately.
        {presence_frames, presence_seq} = build_initial_presence_frames(guild_ids, user_id, 1)

        {[{:text, Jason.encode!(ready)}] ++ presence_frames,
         %{
           state
           | identified: true,
             user_id: user_id,
             session_id: session_id,
             sequence: presence_seq,
             intents: intents,
             guild_ids: guild_ids
         }}

      {:error, :invalid_token} ->
        Logger.warning("Invalid token during Identify")
        # Send op 9 (Invalid Session) with d=false for bad tokens
        invalid = %{"op" => Opcodes.invalid_session(), "d" => false}
        {[{:text, Jason.encode!(invalid)}], state}
    end
  end

  # --- Intent Filtering ---

  # Returns true if the event should be dispatched given the client's declared intents.
  # Events not listed here default to always being sent.
  @spec should_dispatch?(String.t(), map(), non_neg_integer()) :: boolean()
  defp should_dispatch?("GUILD_UPDATE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("GUILD_DELETE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("GUILD_ROLE_CREATE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("GUILD_ROLE_UPDATE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("GUILD_ROLE_DELETE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("CHANNEL_CREATE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("CHANNEL_UPDATE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("CHANNEL_DELETE", _data, intents), do: (intents &&& @intent_guilds) != 0
  defp should_dispatch?("CHANNEL_PINS_UPDATE", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guilds) != 0,
      else: (intents &&& @intent_direct_messages) != 0
  end
  defp should_dispatch?("GUILD_MEMBER_ADD", _data, intents), do: (intents &&& @intent_guild_members) != 0
  defp should_dispatch?("GUILD_MEMBER_UPDATE", _data, intents), do: (intents &&& @intent_guild_members) != 0
  defp should_dispatch?("GUILD_MEMBER_REMOVE", _data, intents), do: (intents &&& @intent_guild_members) != 0
  defp should_dispatch?("GUILD_BAN_ADD", _data, intents), do: (intents &&& @intent_guild_moderation) != 0
  defp should_dispatch?("GUILD_BAN_REMOVE", _data, intents), do: (intents &&& @intent_guild_moderation) != 0
  defp should_dispatch?("GUILD_EMOJIS_UPDATE", _data, intents), do: (intents &&& @intent_guild_emojis) != 0
  defp should_dispatch?("GUILD_STICKERS_UPDATE", _data, intents), do: (intents &&& @intent_guild_emojis) != 0
  defp should_dispatch?("VOICE_STATE_UPDATE", _data, intents), do: (intents &&& @intent_guild_voice_states) != 0
  defp should_dispatch?("PRESENCE_UPDATE", _data, intents), do: (intents &&& @intent_guild_presences) != 0
  defp should_dispatch?("MESSAGE_CREATE", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_messages) != 0,
      else: (intents &&& @intent_direct_messages) != 0
  end
  defp should_dispatch?("MESSAGE_UPDATE", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_messages) != 0,
      else: (intents &&& @intent_direct_messages) != 0
  end
  defp should_dispatch?("MESSAGE_DELETE", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_messages) != 0,
      else: (intents &&& @intent_direct_messages) != 0
  end
  defp should_dispatch?("MESSAGE_REACTION_ADD", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_message_reactions) != 0,
      else: (intents &&& @intent_direct_message_reactions) != 0
  end
  defp should_dispatch?("MESSAGE_REACTION_REMOVE", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_message_reactions) != 0,
      else: (intents &&& @intent_direct_message_reactions) != 0
  end
  defp should_dispatch?("MESSAGE_REACTION_REMOVE_ALL", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_message_reactions) != 0,
      else: (intents &&& @intent_direct_message_reactions) != 0
  end
  defp should_dispatch?("TYPING_START", data, intents) do
    if data["guild_id"],
      do: (intents &&& @intent_guild_message_typing) != 0,
      else: (intents &&& @intent_direct_message_typing) != 0
  end
  # Unknown/unlisted events are always sent
  defp should_dispatch?(_event, _data, _intents), do: true

  # --- Session Resume Helpers ---

  # Persist an event to the replay buffer for this session (sorted set keyed by seq).
  @spec save_replay(String.t() | nil, non_neg_integer(), String.t(), map()) :: :ok
  defp save_replay(nil, _seq, _event_name, _data), do: :ok
  defp save_replay(session_id, seq, event_name, data) do
    key = "session:replay:#{session_id}"
    entry = Jason.encode!(%{"t" => event_name, "d" => data})
    Redix.command(:redix, ["ZADD", key, to_string(seq), entry])
    # Cap buffer size
    Redix.command(:redix, ["ZREMRANGEBYRANK", key, "0", to_string(-@resume_max_events - 1)])
    # Reset TTL
    Redix.command(:redix, ["EXPIRE", key, to_string(@resume_ttl)])
    :ok
  end

  # Retrieve session metadata stored at identify time.
  @spec get_session_meta(String.t(), integer()) :: {:ok, map()} | :error
  defp get_session_meta(session_id, expected_user_id) do
    case Redix.command(:redix, ["GET", "session:meta:#{session_id}"]) do
      {:ok, nil} ->
        :error

      {:ok, json} ->
        case Jason.decode(json) do
          {:ok, %{"user_id" => uid} = meta} when uid == expected_user_id ->
            {:ok, meta}
          _ ->
            :error
        end

      _ ->
        :error
    end
  end

  # Fetch replay entries with sequence number > from_seq, ordered ascending.
  @spec get_replay_entries(String.t(), non_neg_integer()) :: [map()]
  defp get_replay_entries(session_id, from_seq) do
    key = "session:replay:#{session_id}"
    case Redix.command(:redix, ["ZRANGEBYSCORE", key, to_string(from_seq + 1), "+inf"]) do
      {:ok, entries} when is_list(entries) ->
        Enum.flat_map(entries, fn entry ->
          case Jason.decode(entry) do
            {:ok, decoded} -> [decoded]
            _ -> []
          end
        end)
      _ ->
        []
    end
  end

  # --- Token / Guild Helpers ---

  defp validate_token(token) do
    case Redix.command(:redix, ["GET", "auth:token:#{token}"]) do
      {:ok, nil} -> {:error, :invalid_token}
      {:ok, user_id} -> {:ok, String.to_integer(user_id)}
      {:error, reason} ->
        Logger.error("Redis error during token validation: #{inspect(reason)}")
        {:error, :invalid_token}
    end
  end

  defp load_user_guild_ids(user_id) do
    case Redix.command(:redix, ["SMEMBERS", "auth:user:#{user_id}:guilds"]) do
      {:ok, ids} -> Enum.map(ids, &String.to_integer/1)
      {:error, _} -> []
    end
  end

  # Loads a minimal public user map (id/username/avatar/...) from the Redis cache the
  # API populates at login (auth:user:{id}:data). Used to enrich VOICE_STATE_UPDATE so
  # other clients can render the voice participant. Falls back to a stub if unavailable.
  @spec load_user_map(integer() | nil) :: map()
  defp load_user_map(user_id) do
    fallback = %{"id" => to_string(user_id), "username" => "unknown", "avatar" => nil}

    case Redix.command(:redix, ["GET", "auth:user:#{user_id}:data"]) do
      {:ok, json} when is_binary(json) ->
        case Jason.decode(json) do
          {:ok, %{} = d} ->
            %{
              "id" => to_string(user_id),
              "username" => Map.get(d, "username", "unknown"),
              "avatar" => Map.get(d, "avatar"),
              "discriminator" => Map.get(d, "discriminator", "0"),
              "global_name" => Map.get(d, "global_name")
            }

          _ ->
            fallback
        end

      _ ->
        fallback
    end
  end

  # --- Voice State Persistence Helpers ---

  # Redis hash key holding the voice state of every user currently in a voice channel of
  # this guild. Field = user_id, value = JSON blob (see encode_voice_state_field/5).
  @doc false
  @spec voice_guild_key(String.t() | integer()) :: String.t()
  def voice_guild_key(guild_id), do: "voice:guild:#{guild_id}"

  # JSON stored per user in the guild voice hash. Only the fields a late-joining client
  # needs to render the roster are kept (identity is re-enriched on read).
  @doc false
  @spec encode_voice_state_field(String.t() | nil, boolean(), boolean(), boolean(), boolean()) ::
          String.t()
  def encode_voice_state_field(channel_id, self_mute, self_deaf, self_video, self_stream) do
    Jason.encode!(%{
      "channel_id" => channel_id,
      "self_mute" => self_mute,
      "self_deaf" => self_deaf,
      "self_video" => self_video,
      "self_stream" => self_stream
    })
  end

  # Reconstructs a full voice-state map (matching the VOICE_STATE_UPDATE shape) from a
  # decoded hash field plus the member's public identity, so the client can apply READY
  # `voice_states` through the exact same code path as a live update.
  @doc false
  @spec build_voice_state_entry(String.t() | integer(), String.t() | integer(), map(), map()) ::
          map()
  def build_voice_state_entry(guild_id, user_id, decoded, user_map) do
    %{
      "guild_id" => to_string(guild_id),
      "channel_id" => Map.get(decoded, "channel_id"),
      "user_id" => to_string(user_id),
      "self_mute" => Map.get(decoded, "self_mute", false),
      "self_deaf" => Map.get(decoded, "self_deaf", false),
      "self_video" => Map.get(decoded, "self_video", false),
      "self_stream" => Map.get(decoded, "self_stream", false),
      "member" => %{"user" => user_map}
    }
  end

  # Transforms a Redis HGETALL result (flat [user_id, json, user_id, json, ...] list) for
  # one guild into a list of voice-state maps. `user_map_fn` resolves a user_id string to
  # its public identity map. Malformed/undecodable entries are skipped.
  @doc false
  @spec voice_states_from_hash(String.t() | integer(), [String.t()], (String.t() -> map())) ::
          [map()]
  def voice_states_from_hash(guild_id, pairs, user_map_fn) when is_list(pairs) do
    pairs
    |> Enum.chunk_every(2)
    |> Enum.flat_map(fn
      [user_id, json] when is_binary(json) ->
        case Jason.decode(json) do
          {:ok, %{} = decoded} ->
            [build_voice_state_entry(guild_id, user_id, decoded, user_map_fn.(user_id))]

          _ ->
            []
        end

      _ ->
        []
    end)
  end

  def voice_states_from_hash(_guild_id, _pairs, _fn), do: []

  # Persists (or clears) the caller's voice state in the guild voice hash. A nil guild_id
  # is ignored; a nil channel_id means "left voice" and removes the entry.
  @spec persist_voice_state(
          String.t() | nil,
          integer() | nil,
          String.t() | nil,
          boolean(),
          boolean(),
          boolean(),
          boolean()
        ) :: :ok
  defp persist_voice_state(nil, _user_id, _channel_id, _sm, _sd, _sv, _ss), do: :ok

  defp persist_voice_state(guild_id, user_id, nil, _sm, _sd, _sv, _ss) do
    Redix.command(:redix, ["HDEL", voice_guild_key(guild_id), to_string(user_id)])
    :ok
  end

  defp persist_voice_state(guild_id, user_id, channel_id, self_mute, self_deaf, self_video, self_stream) do
    key = voice_guild_key(guild_id)
    field = encode_voice_state_field(channel_id, self_mute, self_deaf, self_video, self_stream)
    Redix.command(:redix, ["HSET", key, to_string(user_id), field])
    # Bound the hash's lifetime so orphaned entries (e.g. after an unclean shutdown that
    # skips terminate/3) eventually expire. Refreshed on every write.
    Redix.command(:redix, ["EXPIRE", key, "86400"])
    :ok
  end

  # Reads the persisted voice roster for each of the user's guilds and enriches every
  # entry with the member's public identity. Returns a flat list of voice-state maps.
  @spec build_voice_states([integer()]) :: [map()]
  defp build_voice_states(guild_ids) do
    Enum.flat_map(guild_ids, fn gid ->
      case Redix.command(:redix, ["HGETALL", voice_guild_key(gid)]) do
        {:ok, pairs} when is_list(pairs) ->
          voice_states_from_hash(gid, pairs, fn uid ->
            load_user_map(safe_to_integer(uid))
          end)

        _ ->
          []
      end
    end)
  end

  @spec safe_to_integer(String.t() | integer()) :: integer() | nil
  defp safe_to_integer(v) when is_integer(v), do: v

  defp safe_to_integer(v) when is_binary(v) do
    case Integer.parse(v) do
      {int, _} -> int
      :error -> nil
    end
  end

  defp safe_to_integer(_), do: nil

  # Builds a list of PRESENCE_UPDATE WebSocket frames for all already-online members
  # across the given guild IDs, skipping self_user_id. Returns {frames, final_seq}.
  @spec build_initial_presence_frames([integer()], integer(), non_neg_integer()) ::
          {[{:text, binary()}], non_neg_integer()}
  defp build_initial_presence_frames(guild_ids, self_user_id, base_seq) do
    Enum.reduce(guild_ids, {[], base_seq}, fn gid, {frames_acc, seq} ->
      online_uids =
        case Redix.command(:redix, ["SMEMBERS", "guild:#{gid}:online_members"]) do
          {:ok, ids} ->
            ids
            |> Enum.map(&String.to_integer/1)
            |> Enum.reject(&(&1 == self_user_id))

          _ ->
            []
        end

      Enum.reduce(online_uids, {frames_acc, seq}, fn uid, {facc, s} ->
        case Redix.command(:redix, ["HGETALL", "presence:#{uid}"]) do
          {:ok, fields} when is_list(fields) and length(fields) >= 2 ->
            pmap =
              fields
              |> Enum.chunk_every(2)
              |> Enum.into(%{}, fn [k, v] -> {k, v} end)

            status = Map.get(pmap, "status", "offline")

            if status != "offline" do
              cs_web = Map.get(pmap, "client_status_web", "online")
              new_seq = s + 1

              event = %{
                "op" => Opcodes.dispatch(),
                "d" => %{
                  "user" => %{"id" => to_string(uid)},
                  "guild_id" => to_string(gid),
                  "status" => status,
                  "client_status" => %{"web" => cs_web},
                  "activities" => []
                },
                "s" => new_seq,
                "t" => "PRESENCE_UPDATE"
              }

              {facc ++ [{:text, Jason.encode!(event)}], new_seq}
            else
              {facc, s}
            end

          _ ->
            {facc, s}
        end
      end)
    end)
  end

  defp close_with_code(code, reason, state) do
    {[{:close, code, reason}], state}
  end
end
