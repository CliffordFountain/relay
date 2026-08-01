FROM elixir:1.17-alpine

RUN apk add --no-cache build-base git curl

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

EXPOSE 4000

# In dev with volume mount, deps aren't baked in - fetch and run at startup
CMD ["sh", "-c", "mix deps.get && mix compile && mix run --no-halt"]
