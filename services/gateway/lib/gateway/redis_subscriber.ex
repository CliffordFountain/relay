defmodule Gateway.RedisSubscriber do
  @moduledoc "Subscribes to Redis pub/sub for events from the API."
  use GenServer
  require Logger

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @spec subscribe(String.t()) :: :ok
  def subscribe(channel) do
    GenServer.cast(__MODULE__, {:subscribe, channel})
  end

  @spec unsubscribe(String.t()) :: :ok
  def unsubscribe(channel) do
    GenServer.cast(__MODULE__, {:unsubscribe, channel})
  end

  @impl true
  def init(_opts) do
    redis_url = Application.get_env(:gateway, :redis_url, "redis://redis:6379/0")
    {:ok, pubsub} = Redix.PubSub.start_link(redis_url)
    {:ok, %{pubsub: pubsub, subscriptions: MapSet.new()}}
  end

  @impl true
  def handle_cast({:subscribe, channel}, state) do
    Redix.PubSub.subscribe(state.pubsub, channel, self())
    {:noreply, %{state | subscriptions: MapSet.put(state.subscriptions, channel)}}
  end

  @impl true
  def handle_cast({:unsubscribe, channel}, state) do
    Redix.PubSub.unsubscribe(state.pubsub, channel, self())
    {:noreply, %{state | subscriptions: MapSet.delete(state.subscriptions, channel)}}
  end

  @impl true
  def handle_info({:redix_pubsub, _pubsub, _ref, :subscribed, %{channel: channel}}, state) do
    Logger.debug("Subscribed to Redis channel: #{channel}")
    {:noreply, state}
  end

  @impl true
  def handle_info({:redix_pubsub, _pubsub, _ref, :message, %{channel: channel, payload: payload}}, state) do
    case Jason.decode(payload) do
      {:ok, %{"t" => event_name, "d" => data}} ->
        # Extract guild_id from channel name "guild:{guild_id}"
        case String.split(channel, ":") do
          ["guild", guild_id_str] ->
            guild_id = String.to_integer(guild_id_str)

            case Registry.lookup(Gateway.GuildRegistry, guild_id) do
              [{pid, _}] ->
                GenServer.cast(pid, {:dispatch, event_name, data})

              [] ->
                Logger.debug("No guild process for #{guild_id}, event #{event_name} dropped")
            end

          ["user", user_id_str] ->
            # DM events: dispatch directly to all sessions belonging to this user
            user_id = String.to_integer(user_id_str)

            Registry.dispatch(Gateway.SessionRegistry, user_id, fn entries ->
              for {pid, _} <- entries do
                send(pid, {:dispatch, event_name, data})
              end
            end)

          _ ->
            Logger.warning("Unknown Redis channel format: #{channel}")
        end

      {:error, _} ->
        Logger.warning("Failed to decode Redis message on #{channel}")
    end

    {:noreply, state}
  end

  @impl true
  def handle_info(_msg, state) do
    {:noreply, state}
  end
end
