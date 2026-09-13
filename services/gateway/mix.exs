defmodule Gateway.MixProject do
  use Mix.Project

  def project do
    [
      app: :gateway,
      version: "0.0.1",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      # :inets provides the built-in :httpc client used for the service-to-service
      # voice-authorization call to the API (see SocketHandler.authorize_voice_join/3);
      # :ssl lets it reach an https API_URL if one is ever configured.
      extra_applications: [:logger, :inets, :ssl],
      mod: {Gateway.Application, []}
    ]
  end

  defp deps do
    [
      {:cowboy, "~> 2.12"},
      {:plug, "~> 1.16"},
      {:plug_cowboy, "~> 2.7"},
      {:jason, "~> 1.4"},
      {:redix, "~> 1.5"},
      {:uuid, "~> 1.1"},
      {:phoenix_pubsub, "~> 2.1"}
    ]
  end
end
