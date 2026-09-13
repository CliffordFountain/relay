import type { WebSocket } from 'ws';
import type { RedisClientType } from 'redis';
import type { RoomManager, Peer, Room } from './room.js';

// ── Opcodes (client -> server) ───────────────────────────────────────

const C2S = {
  IDENTIFY: 0,
  SELECT_PROTOCOL: 1,       // connect send transport
  HEARTBEAT: 2,
  SPEAKING: 3,
  CONNECT_RECV_TRANSPORT: 4,
  PRODUCE: 5,
  CONSUME: 6,
  RESUME_CONSUMER: 7,
  PAUSE_CONSUMER: 8,
  CLOSE_PRODUCER: 9,
  GET_ROUTER_CAPS: 10,
} as const;

// ── Opcodes (server -> client) ───────────────────────────────────────

const S2C = {
  READY: 2,
  HEARTBEAT_ACK: 3,
  SESSION_DESC: 4,
  SPEAKING: 5,
  PRODUCE_SUCCESS: 6,
  NEW_CONSUMER: 7,
  HELLO: 8,
  PEER_JOINED: 9,
  PEER_LEFT: 10,
  PRODUCER_PAUSED: 11,
  PRODUCER_RESUMED: 12,
  PRODUCER_CLOSED: 13,
  ROUTER_CAPABILITIES: 14,
  ERROR: 15,
} as const;

const HEARTBEAT_INTERVAL = 13_750;

// ── Per-connection state ─────────────────────────────────────────────

interface PeerState {
  userId: string | null;
  channelId: string | null;
  guildId: string | null;
  sessionId: string | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  lastHeartbeatAck: number;
}

// ── Entry point — called per WebSocket connection ────────────────────

export function handleSignaling(
  ws: WebSocket,
  roomManager: RoomManager,
  redis: RedisClientType,
): void {
  const state: PeerState = {
    userId: null,
    channelId: null,
    guildId: null,
    sessionId: null,
    heartbeatTimer: null,
    lastHeartbeatAck: Date.now(),
  };

  // Send Hello immediately
  send(ws, S2C.HELLO, { heartbeat_interval: HEARTBEAT_INTERVAL });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { op: number; d: any };
      const { op, d } = msg;

      switch (op) {
        case C2S.IDENTIFY:
          await handleIdentify(d, ws, state, roomManager, redis);
          break;

        case C2S.HEARTBEAT:
          state.lastHeartbeatAck = Date.now();
          send(ws, S2C.HEARTBEAT_ACK, d);
          break;

        case C2S.SELECT_PROTOCOL:
          await handleConnectSendTransport(d, ws, state, roomManager);
          break;

        case C2S.CONNECT_RECV_TRANSPORT:
          await handleConnectRecvTransport(d, ws, state, roomManager);
          break;

        case C2S.PRODUCE:
          await handleProduce(d, ws, state, roomManager);
          break;

        case C2S.CONSUME:
          await handleConsume(d, ws, state, roomManager);
          break;

        case C2S.RESUME_CONSUMER:
          await handleResumeConsumer(d, state, roomManager);
          break;

        case C2S.PAUSE_CONSUMER:
          await handlePauseConsumer(d, state, roomManager);
          break;

        case C2S.CLOSE_PRODUCER:
          await handleCloseProducer(d, ws, state, roomManager);
          break;

        case C2S.SPEAKING:
          handleSpeaking(d, state, roomManager);
          break;

        case C2S.GET_ROUTER_CAPS:
          handleGetRouterCaps(ws, state, roomManager);
          break;

        default:
          console.warn(`Unknown voice opcode: ${op}`);
      }
    } catch (err) {
      console.error('Voice signaling error:', err);
      send(ws, S2C.ERROR, {
        code: 4000,
        message: err instanceof Error ? err.message : 'Internal error',
      });
    }
  });

  ws.on('close', async () => {
    cleanup(state, roomManager, redis);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    cleanup(state, roomManager, redis);
  });
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleIdentify(
  d: any,
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
  redis: RedisClientType,
): Promise<void> {
  const { server_id, user_id, session_id, token, channel_id } = d;

  // Validate token against Redis auth store
  if (!token || typeof token !== 'string') {
    send(ws, S2C.ERROR, { code: 4004, message: 'Authentication failed: no token provided' });
    ws.close(4004, 'Authentication failed');
    return;
  }

  // The value stored at auth:token:<token> by the API IS the authenticated user id
  // (a bare id string). It is the ONLY trustworthy source of identity here — the
  // client-supplied user_id in the payload must never be trusted, or a peer could
  // impersonate anyone by putting someone else's id in the IDENTIFY payload.
  const authenticatedUserId = await redis.get(`auth:token:${token}`).catch(() => null);
  if (!authenticatedUserId) {
    send(ws, S2C.ERROR, { code: 4004, message: 'Authentication failed: invalid token' });
    ws.close(4004, 'Authentication failed');
    return;
  }
  if (user_id !== undefined && String(user_id) !== authenticatedUserId) {
    console.warn(
      `Voice identify: payload user_id (${user_id}) does not match the token's user id ` +
        `(${authenticatedUserId}); using the token value.`,
    );
  }

  // Authorization: joining a *guild* voice channel requires membership of that guild.
  // Authenticating who you are (above) is not enough — without this check any logged-in
  // user could join any server's voice room just by putting its ids in the payload. The
  // API maintains the authoritative membership set at auth:user:<id>:guilds (the same set
  // the gateway trusts to scope a user's guild events), kept in sync on join/leave/invite.
  // DM / group calls carry no guild id (server_id is empty) and are not gated here.
  const requiredGuildId = guildToAuthorize(server_id);
  if (requiredGuildId !== null) {
    const isMember = await redis
      .sIsMember(`auth:user:${authenticatedUserId}:guilds`, requiredGuildId)
      .catch(() => false);
    if (!isMember) {
      console.warn(
        `Voice identify: user ${authenticatedUserId} is not a member of guild ${requiredGuildId} — refusing join`,
      );
      send(ws, S2C.ERROR, {
        code: 4004,
        message: 'Authorization failed: not a member of this server',
      });
      ws.close(4004, 'Authorization failed');
      return;
    }
  }

  state.userId = authenticatedUserId;
  state.guildId = server_id;
  state.sessionId = session_id;
  state.channelId = channel_id ?? server_id;

  // Join room — creates Router if first peer
  const { room, peer, sendOpts, recvOpts } = await roomManager.joinRoom(
    state.channelId!,
    state.guildId!,
    state.userId!,
    state.sessionId!,
    ws,
  );

  // Send Ready with transport options + router capabilities
  send(ws, S2C.READY, {
    routerRtpCapabilities: room.router.rtpCapabilities,
    sendTransportOptions: sendOpts,
    recvTransportOptions: recvOpts,
  });

  // Notify existing peers about the newcomer
  const existingProducerInfos: Array<{
    peerId: string;
    producerId: string;
    kind: string;
    appData: Record<string, unknown>;
  }> = [];

  for (const [uid, existingPeer] of room.peers) {
    if (uid === state.userId) continue;

    // Tell each existing peer about the new user
    send(existingPeer.ws, S2C.PEER_JOINED, {
      userId: state.userId,
      producers: [],
    });

    // Collect existing producers so we can tell the new peer
    for (const [prodId, producer] of existingPeer.producers) {
      existingProducerInfos.push({
        peerId: uid,
        producerId: prodId,
        kind: producer.kind,
        appData: producer.appData as Record<string, unknown>,
      });
    }
  }

  // Tell new peer about every existing peer (with their producers)
  const peersByUser = new Map<string, typeof existingProducerInfos>();
  for (const info of existingProducerInfos) {
    let list = peersByUser.get(info.peerId);
    if (!list) {
      list = [];
      peersByUser.set(info.peerId, list);
    }
    list.push(info);
  }

  for (const [uid, prods] of peersByUser) {
    send(ws, S2C.PEER_JOINED, {
      userId: uid,
      producers: prods.map((p) => ({
        id: p.producerId,
        kind: p.kind,
        appData: p.appData,
      })),
    });
  }

  // Publish join event to Redis so the main gateway knows
  await redis.publish(
    'voice:events',
    JSON.stringify({
      type: 'VOICE_JOIN',
      guildId: state.guildId,
      channelId: state.channelId,
      userId: state.userId,
    }),
  ).catch(() => {});

  // Start heartbeat watchdog
  state.heartbeatTimer = setInterval(() => {
    if (Date.now() - state.lastHeartbeatAck > HEARTBEAT_INTERVAL * 3) {
      console.warn(`Peer ${state.userId} missed heartbeat — disconnecting`);
      ws.close(4009, 'Session timeout');
    }
  }, HEARTBEAT_INTERVAL);
}

async function handleConnectSendTransport(
  d: any,
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;

  const dtlsParameters = d.data?.dtlsParameters ?? d.dtlsParameters;
  await roomManager.connectTransport(state.channelId, state.userId, 'send', dtlsParameters);
  send(ws, S2C.SESSION_DESC, { sdp: 'connected' });
}

async function handleConnectRecvTransport(
  d: any,
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;

  const dtlsParameters = d.dtlsParameters;
  await roomManager.connectTransport(state.channelId, state.userId, 'recv', dtlsParameters);
  send(ws, S2C.SESSION_DESC, { sdp: 'connected' });
}

async function handleProduce(
  d: any,
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;

  const { kind, rtpParameters, appData } = d;
  const producer = await roomManager.produce(
    state.channelId,
    state.userId,
    kind,
    rtpParameters,
    appData,
  );

  // Respond with producer ID
  send(ws, S2C.PRODUCE_SUCCESS, { id: producer.id });

  // Notify all other peers so they can consume
  const room = roomManager.getRoom(state.channelId);
  if (!room) return;

  for (const [uid, otherPeer] of room.peers) {
    if (uid === state.userId) continue;
    send(otherPeer.ws, S2C.PEER_JOINED, {
      userId: state.userId,
      producers: [
        {
          id: producer.id,
          kind: producer.kind,
          appData: producer.appData,
        },
      ],
    });
  }
}

async function handleConsume(
  d: any,
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;

  const { producerId, rtpCapabilities } = d;

  const room = roomManager.getRoom(state.channelId);
  if (!room) return;

  // Use client's rtpCapabilities if provided, otherwise fallback to router's
  const caps = rtpCapabilities ?? room.router.rtpCapabilities;

  const consumer = await roomManager.consume(
    state.channelId,
    state.userId,
    producerId,
    caps,
  );

  if (!consumer) {
    send(ws, S2C.ERROR, { code: 4003, message: 'Cannot consume producer' });
    return;
  }

  const producerOwner = roomManager.findProducerOwner(room, producerId);

  send(ws, S2C.NEW_CONSUMER, {
    peerId: producerOwner ?? 'unknown',
    producerId: consumer.producerId,
    consumerId: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    appData: consumer.appData,
  });
}

async function handleResumeConsumer(
  d: any,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;
  await roomManager.resumeConsumer(state.channelId, state.userId, d.consumerId);
}

async function handlePauseConsumer(
  d: any,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;
  await roomManager.pauseConsumer(state.channelId, state.userId, d.consumerId);
}

async function handleCloseProducer(
  d: any,
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
): Promise<void> {
  if (!state.channelId || !state.userId) return;

  const closed = roomManager.closeProducer(state.channelId, state.userId, d.producerId);
  if (!closed) return;

  // Notify other peers
  const room = roomManager.getRoom(state.channelId);
  if (!room) return;

  for (const [uid, otherPeer] of room.peers) {
    if (uid === state.userId) continue;
    send(otherPeer.ws, S2C.PRODUCER_CLOSED, {
      peerId: state.userId,
      producerId: d.producerId,
    });
  }
}

function handleSpeaking(
  d: any,
  state: PeerState,
  roomManager: RoomManager,
): void {
  if (!state.channelId || !state.userId) return;

  const room = roomManager.getRoom(state.channelId);
  if (!room) return;

  for (const [uid, peer] of room.peers) {
    if (uid === state.userId) continue;
    send(peer.ws, S2C.SPEAKING, {
      user_id: state.userId,
      speaking: d.speaking,
      ssrc: d.ssrc,
    });
  }
}

function handleGetRouterCaps(
  ws: WebSocket,
  state: PeerState,
  roomManager: RoomManager,
): void {
  if (!state.channelId) return;
  const room = roomManager.getRoom(state.channelId);
  if (!room) return;
  send(ws, S2C.ROUTER_CAPABILITIES, {
    rtpCapabilities: room.router.rtpCapabilities,
  });
}

// ── Disconnect cleanup ──────────────────────────────────────────────

async function cleanup(
  state: PeerState,
  roomManager: RoomManager,
  redis: RedisClientType,
): Promise<void> {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  if (!state.channelId || !state.userId) return;

  const room = roomManager.getRoom(state.channelId);

  // Leave the room (closes transports, producers, consumers)
  const removedProducers = await roomManager.leaveRoom(state.channelId, state.userId);

  // Notify remaining peers
  if (room) {
    for (const [uid, peer] of room.peers) {
      if (uid === state.userId) continue;
      send(peer.ws, S2C.PEER_LEFT, { userId: state.userId });

      // Also notify about closed producers so clients clean up consumers
      if (removedProducers) {
        for (const prodId of removedProducers) {
          send(peer.ws, S2C.PRODUCER_CLOSED, {
            peerId: state.userId,
            producerId: prodId,
          });
        }
      }
    }
  }

  // Publish leave event
  await redis.publish(
    'voice:events',
    JSON.stringify({
      type: 'VOICE_LEAVE',
      guildId: state.guildId,
      channelId: state.channelId,
      userId: state.userId,
    }),
  ).catch(() => {});

  state.userId = null;
  state.channelId = null;
  state.guildId = null;
}

// ── Helpers ──────────────────────────────────────────────────────────

// Normalizes the IDENTIFY payload's server_id into the guild id that must be
// authorized before joining, or null when no guild check applies (DM/group calls,
// which send an empty/absent server_id). Kept pure so it can be unit-tested.
export function guildToAuthorize(serverId: unknown): string | null {
  if (serverId === null || serverId === undefined) return null;
  const s = String(serverId).trim();
  return s === '' ? null : s;
}

function send(ws: WebSocket, op: number, d: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ op, d }));
  }
}
