defmodule Guild.GuildServer do
  @moduledoc "GenServer per guild. Tracks connected sessions and dispatches events."
  use GenServer
  require Logger

  defstruct [
    :guild_id,
    sessions: MapSet.new(),
    voice_states: %{}
  ]

  @spec start_link(integer()) :: GenServer.on_start()
  def start_link(guild_id) do
    GenServer.start_link(__MODULE__, guild_id, name: via(guild_id))
  end

  @spec via(integer()) :: {:via, Registry, {Gateway.GuildRegistry, integer()}}
  def via(guild_id) do
    {:via, Registry, {Gateway.GuildRegistry, guild_id}}
  end

  @spec subscribe(integer(), pid(), integer()) :: :ok
  def subscribe(guild_id, session_pid, user_id) do
    case Registry.lookup(Gateway.GuildRegistry, guild_id) do
      [{pid, _}] ->
        GenServer.cast(pid, {:subscribe, session_pid, user_id})

      [] ->
        # Two sessions for the same guild can race to start the server. The loser gets
        # {:error, {:already_started, pid}} rather than {:ok, pid}; use that pid instead
        # of crashing with a MatchError.
        pid =
          case DynamicSupervisor.start_child(
                 Gateway.GuildSupervisor,
                 {__MODULE__, guild_id}
               ) do
            {:ok, pid} -> pid
            {:error, {:already_started, pid}} -> pid
          end

        GenServer.cast(pid, {:subscribe, session_pid, user_id})
    end
  end

  @spec unsubscribe(integer(), pid()) :: :ok
  def unsubscribe(guild_id, session_pid) do
    case Registry.lookup(Gateway.GuildRegistry, guild_id) do
      [{pid, _}] -> GenServer.cast(pid, {:unsubscribe, session_pid})
      [] -> :ok
    end
  end

  @impl true
  def init(guild_id) do
    Logger.info("Guild process started for guild #{guild_id}")
    Gateway.RedisSubscriber.subscribe("guild:#{guild_id}")
    {:ok, %__MODULE__{guild_id: guild_id}}
  end

  @impl true
  def handle_cast({:subscribe, session_pid, user_id}, state) do
    Process.monitor(session_pid)
    {:noreply, %{state | sessions: MapSet.put(state.sessions, {session_pid, user_id})}}
  end

  @impl true
  def handle_cast({:unsubscribe, session_pid}, state) do
    sessions = MapSet.reject(state.sessions, fn {pid, _} -> pid == session_pid end)
    maybe_shutdown(state, sessions)
  end

  @impl true
  def handle_cast({:dispatch, event_name, data}, state) do
    Enum.each(state.sessions, fn {pid, _user_id} ->
      send(pid, {:dispatch, event_name, data})
    end)

    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    sessions = MapSet.reject(state.sessions, fn {p, _} -> p == pid end)
    maybe_shutdown(state, sessions)
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end

  defp maybe_shutdown(state, sessions) do
    if MapSet.size(sessions) == 0 do
      Logger.info("Guild process stopping for guild #{state.guild_id} (no sessions)")
      Gateway.RedisSubscriber.unsubscribe("guild:#{state.guild_id}")
      {:stop, :normal, %{state | sessions: sessions}}
    else
      {:noreply, %{state | sessions: sessions}}
    end
  end
end
