/** Gateway opcodes matching the gateway protocol exactly. */
export const GatewayOpcode = {
  /** Server -> Client: An event was dispatched */
  Dispatch: 0,
  /** Both: Fired periodically to keep connection alive */
  Heartbeat: 1,
  /** Client -> Server: Starts a new session during initial handshake */
  Identify: 2,
  /** Client -> Server: Update the client's presence */
  PresenceUpdate: 3,
  /** Client -> Server: Join/leave/move voice channels */
  VoiceStateUpdate: 4,
  // Opcode 5 is intentionally skipped (the gateway protocol skips it)
  /** Client -> Server: Resume a previous session */
  Resume: 6,
  /** Server -> Client: Server is telling client to reconnect */
  Reconnect: 7,
  /** Client -> Server: Request information about guild members */
  RequestGuildMembers: 8,
  /** Server -> Client: Session has been invalidated */
  InvalidSession: 9,
  /** Server -> Client: Sent immediately after connecting with heartbeat interval */
  Hello: 10,
  /** Server -> Client: Sent in response to a heartbeat */
  HeartbeatAck: 11,
} as const;

export type GatewayOpcodeValue = (typeof GatewayOpcode)[keyof typeof GatewayOpcode];

/** Gateway close event codes. */
export const GatewayCloseCode = {
  UnknownError: 4000,
  UnknownOpcode: 4001,
  DecodeError: 4002,
  NotAuthenticated: 4003,
  AuthenticationFailed: 4004,
  AlreadyAuthenticated: 4005,
  InvalidSeq: 4007,
  RateLimited: 4008,
  SessionTimedOut: 4009,
  InvalidShard: 4010,
  ShardingRequired: 4011,
  InvalidApiVersion: 4012,
  InvalidIntents: 4013,
  DisallowedIntents: 4014,
} as const;

/** Heartbeat interval in milliseconds (the gateway protocol uses 41250ms). */
export const HEARTBEAT_INTERVAL = 41250;
