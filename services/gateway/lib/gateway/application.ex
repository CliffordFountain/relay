defmodule Gateway.Application do
  @moduledoc "Main application supervisor for the Relay Gateway."
  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    port = Application.get_env(:gateway, :port, 4000)

    redis_url = Application.get_env(:gateway, :redis_url, "redis://redis:6379/0")

    children = [
      {Redix, {redis_url, [name: :redix]}},
      Gateway.RedisSubscriber,
      {Registry, keys: :unique, name: Gateway.GuildRegistry},
      {Registry, keys: :duplicate, name: Gateway.SessionRegistry},
      {DynamicSupervisor, strategy: :one_for_one, name: Gateway.SessionSupervisor},
      {DynamicSupervisor, strategy: :one_for_one, name: Gateway.GuildSupervisor},
      {Plug.Cowboy,
       scheme: :http,
       plug: Gateway.Router,
       options: [
         port: port,
         dispatch: dispatch()
       ]}
    ]

    Logger.info("Gateway starting on port #{port}")
    opts = [strategy: :one_for_one, name: Gateway.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp dispatch do
    [
      {:_,
       [
         {"/gateway", Gateway.SocketHandler, []},
         {:_, Plug.Cowboy.Handler, {Gateway.Router, []}}
       ]}
    ]
  end
end
