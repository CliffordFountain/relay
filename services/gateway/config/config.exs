import Config

config :gateway,
  port: 4000,
  redis_url: "redis://redis:6379/0"

import_config "#{config_env()}.exs"
