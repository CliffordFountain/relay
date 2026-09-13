defmodule Gateway.Opcodes do
  @moduledoc "Gateway opcode constants."

  @dispatch 0
  @heartbeat 1
  @identify 2
  @presence_update 3
  @voice_state_update 4
  # Opcode 5 is intentionally skipped
  @resume 6
  @reconnect 7
  @request_guild_members 8
  @invalid_session 9
  @hello 10
  @heartbeat_ack 11

  def dispatch, do: @dispatch
  def heartbeat, do: @heartbeat
  def identify, do: @identify
  def presence_update, do: @presence_update
  def voice_state_update, do: @voice_state_update
  def resume, do: @resume
  def reconnect, do: @reconnect
  def request_guild_members, do: @request_guild_members
  def invalid_session, do: @invalid_session
  def hello, do: @hello
  def heartbeat_ack, do: @heartbeat_ack
end
