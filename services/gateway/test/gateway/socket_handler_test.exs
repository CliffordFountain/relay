defmodule Gateway.SocketHandlerTest do
  use ExUnit.Case

  alias Gateway.Opcodes

  test "opcodes have the expected values" do
    assert Opcodes.dispatch() == 0
    assert Opcodes.heartbeat() == 1
    assert Opcodes.identify() == 2
    assert Opcodes.presence_update() == 3
    assert Opcodes.voice_state_update() == 4
    assert Opcodes.resume() == 6
    assert Opcodes.reconnect() == 7
    assert Opcodes.request_guild_members() == 8
    assert Opcodes.invalid_session() == 9
    assert Opcodes.hello() == 10
    assert Opcodes.heartbeat_ack() == 11
  end

  # --- Voice state persistence / READY roster helpers ---
  #
  # These cover the pure data transforms behind the voice-presence fix: the Redis key
  # naming, the JSON field encoding written on join/move, and reconstructing the enriched
  # `voice_states` roster the gateway sends on READY. The Redix I/O around them is thin
  # glue (HSET/HDEL/HGETALL) and is exercised by the orchestrator's live two-socket check.

  alias Gateway.SocketHandler

  test "voice_guild_key/1 builds the per-guild voice hash key" do
    assert SocketHandler.voice_guild_key("123") == "voice:guild:123"
    assert SocketHandler.voice_guild_key(123) == "voice:guild:123"
  end

  test "encode_voice_state_field/5 round-trips through voice_states_from_hash/3" do
    field = SocketHandler.encode_voice_state_field("chan-5", true, false, false, true)
    user_map = %{"id" => "42", "username" => "Alice", "avatar" => nil}

    [entry] =
      SocketHandler.voice_states_from_hash("7", ["42", field], fn "42" -> user_map end)

    assert entry["guild_id"] == "7"
    assert entry["user_id"] == "42"
    assert entry["channel_id"] == "chan-5"
    assert entry["self_mute"] == true
    assert entry["self_deaf"] == false
    assert entry["self_video"] == false
    assert entry["self_stream"] == true
    assert entry["member"] == %{"user" => user_map}
  end

  test "voice_states_from_hash/3 builds one enriched entry per user in the hash" do
    f1 = SocketHandler.encode_voice_state_field("c1", false, false, false, false)
    f2 = SocketHandler.encode_voice_state_field("c2", false, false, false, false)

    entries =
      SocketHandler.voice_states_from_hash("9", ["1", f1, "2", f2], fn uid ->
        %{"id" => uid, "username" => "u#{uid}", "avatar" => nil}
      end)

    assert length(entries) == 2
    assert Enum.map(entries, & &1["user_id"]) |> Enum.sort() == ["1", "2"]
    alice = Enum.find(entries, &(&1["user_id"] == "1"))
    assert alice["member"]["user"]["username"] == "u1"
    assert alice["channel_id"] == "c1"
  end

  test "voice_states_from_hash/3 skips undecodable entries" do
    good = SocketHandler.encode_voice_state_field("c1", false, false, false, false)

    entries =
      SocketHandler.voice_states_from_hash("9", ["1", good, "2", "not-json"], fn uid ->
        %{"id" => uid}
      end)

    assert length(entries) == 1
    assert hd(entries)["user_id"] == "1"
  end

  test "voice_states_from_hash/3 returns [] for an empty or non-list hash" do
    assert SocketHandler.voice_states_from_hash("9", [], fn _ -> %{} end) == []
    assert SocketHandler.voice_states_from_hash("9", nil, fn _ -> %{} end) == []
  end

  test "build_voice_state_entry/4 defaults missing flags to false" do
    entry =
      SocketHandler.build_voice_state_entry("7", "42", %{"channel_id" => "c1"}, %{"id" => "42"})

    assert entry["channel_id"] == "c1"
    assert entry["self_mute"] == false
    assert entry["self_deaf"] == false
    assert entry["self_video"] == false
    assert entry["self_stream"] == false
    assert entry["member"] == %{"user" => %{"id" => "42"}}
  end
end
