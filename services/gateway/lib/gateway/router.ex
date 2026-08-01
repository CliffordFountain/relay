defmodule Gateway.Router do
  @moduledoc "HTTP router for non-WebSocket requests."
  use Plug.Router

  plug :match
  plug :dispatch

  get "/health" do
    send_resp(conn, 200, Jason.encode!(%{status: "ok"}))
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end
end
