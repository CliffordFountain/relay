defmodule Guild.GuildServerTest do
  use ExUnit.Case, async: false

  # The GuildServer registers under Gateway.GuildRegistry and, when absent, is started
  # via Gateway.GuildSupervisor. Under `mix test` the application boots and provides
  # both; this setup starts them itself if the app tree is not running so the test is
  # self-contained either way. (GuildServer.init also casts a subscribe to the Redis
  # subscriber; when that process is absent the cast is safely dropped, so no Redis is
  # required here.)
  setup do
    ensure_started(Gateway.GuildRegistry, {Registry, keys: :unique, name: Gateway.GuildRegistry})

    ensure_started(
      Gateway.GuildSupervisor,
      {DynamicSupervisor, strategy: :one_for_one, name: Gateway.GuildSupervisor}
    )

    :ok
  end

  test "dispatch fans a VOICE_STATE_UPDATE out to every subscribed session" do
    guild_id = System.unique_integer([:positive])
    test_pid = self()

    # Each fake session process relays any {:dispatch, ...} it receives back to the test.
    receiver = fn ->
      receive do
        {:dispatch, event, data} -> send(test_pid, {:received, self(), event, data})
      after
        2_000 -> :ok
      end
    end

    session_a = spawn(receiver)
    session_b = spawn(receiver)

    # Subscribe two distinct sessions. Casts to the GuildServer are processed FIFO, so
    # both subscribes land before the dispatch below.
    Guild.GuildServer.subscribe(guild_id, session_a, 1)
    Guild.GuildServer.subscribe(guild_id, session_b, 2)

    [{guild_pid, _}] = Registry.lookup(Gateway.GuildRegistry, guild_id)

    payload = %{
      "user_id" => "42",
      "channel_id" => "5",
      "guild_id" => to_string(guild_id)
    }

    GenServer.cast(guild_pid, {:dispatch, "VOICE_STATE_UPDATE", payload})

    assert_receive {:received, ^session_a, "VOICE_STATE_UPDATE", ^payload}, 2_000
    assert_receive {:received, ^session_b, "VOICE_STATE_UPDATE", ^payload}, 2_000
  end

  defp ensure_started(name, child_spec) do
    case Process.whereis(name) do
      nil -> start_supervised!(child_spec)
      _pid -> :ok
    end
  end
end
