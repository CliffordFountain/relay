import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { normalizeChannelId, voiceGrantKey, handleSignaling } from './signaling.js';

describe('normalizeChannelId', () => {
  it('returns the channel id for a normal voice join', () => {
    expect(normalizeChannelId('123456789')).toBe('123456789');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeChannelId('  42 ')).toBe('42');
  });

  it('coerces a numeric id to its string form', () => {
    expect(normalizeChannelId(42)).toBe('42');
  });

  it('returns null for a missing/blank channel id (rejected join)', () => {
    expect(normalizeChannelId('')).toBeNull();
    expect(normalizeChannelId('   ')).toBeNull();
    expect(normalizeChannelId(undefined)).toBeNull();
    expect(normalizeChannelId(null)).toBeNull();
  });
});

describe('voiceGrantKey', () => {
  it('builds the per-user, per-channel grant key', () => {
    expect(voiceGrantKey('42', '5')).toBe('voice:grant:42:5');
  });

  it('matches the gateway key shape exactly', () => {
    // Mirror of Gateway.SocketHandler.voice_grant_key/2 — must stay byte-for-byte identical
    // or the voice-server would never find a grant the gateway wrote.
    expect(voiceGrantKey('1001', 'chan-7')).toBe('voice:grant:1001:chan-7');
  });
});

// ── Integration: handleIdentify grant enforcement ──────────────────────────────
//
// Drives the real signaling entry point with a mocked RoomManager and an in-memory Redis so
// we can assert the security property end-to-end (short of mediasoup): a voice join is only
// admitted when a matching voice:grant:<user>:<channel> exists, the guild is taken from the
// grant (never the client-supplied server_id), and a missing grant is refused with 4004.

const TOKEN = 'tok-abc';
const USER_ID = '1001';
const CHANNEL_ID = '7000';
const GRANT_GUILD = '5000';

class MockWs extends EventEmitter {
  readyState = 1;
  readonly OPEN = 1;
  sent: Array<{ op: number; d: any }> = [];
  closed: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
    this.emit('close');
  }
}

function makeRedis(store: Record<string, string>) {
  return {
    get: vi.fn(async (key: string) => (key in store ? store[key] : null)),
    // GETDEL: read and atomically remove — the voice grant is single-use.
    getDel: vi.fn(async (key: string) => {
      const v = key in store ? store[key] : null;
      delete store[key];
      return v;
    }),
    publish: vi.fn(async () => 1),
    sIsMember: vi.fn(async () => false),
  };
}

function makeRoomManager() {
  const joinRoom = vi.fn(
    async (_channelId: string, _guildId: string, _userId: string, _sessionId: string, _ws: unknown) => ({
      room: { router: { rtpCapabilities: { codecs: [] } }, peers: new Map() },
      peer: {},
      sendOpts: { id: 'send' },
      recvOpts: { id: 'recv' },
    }),
  );
  return { joinRoom, getRoom: vi.fn(() => undefined), leaveRoom: vi.fn(async () => []) };
}

async function identify(ws: MockWs, redis: any, rm: any, payload: Record<string, unknown>) {
  handleSignaling(ws as any, rm as any, redis as any);
  ws.emit('message', JSON.stringify({ op: 0, d: payload }));
  // Let the async IDENTIFY handler's awaited Redis reads/joinRoom settle.
  await vi.waitFor(() => {
    if (rm.joinRoom.mock.calls.length === 0 && ws.closed === null) {
      throw new Error('pending');
    }
  });
}

const S2C_READY = 2;
const S2C_ERROR = 15;

describe('handleIdentify grant enforcement', () => {
  it('admits a join when a matching grant exists and uses the grant guild', async () => {
    const ws = new MockWs();
    const redis = makeRedis({
      [`auth:token:${TOKEN}`]: USER_ID,
      [voiceGrantKey(USER_ID, CHANNEL_ID)]: GRANT_GUILD,
    });
    const rm = makeRoomManager();

    await identify(ws, redis, rm, {
      token: TOKEN,
      user_id: USER_ID,
      session_id: 'sess-1',
      channel_id: CHANNEL_ID,
      server_id: GRANT_GUILD,
    });

    expect(rm.joinRoom).toHaveBeenCalledTimes(1);
    const [channelArg, guildArg, userArg] = rm.joinRoom.mock.calls[0]!;
    expect(channelArg).toBe(CHANNEL_ID);
    expect(guildArg).toBe(GRANT_GUILD);
    expect(userArg).toBe(USER_ID);
    expect(ws.sent.some((m) => m.op === S2C_READY)).toBe(true);
    expect(ws.closed).toBeNull();

    ws.close(); // trigger cleanup (clears heartbeat interval)
  });

  it('consumes the grant on join — a second identify with the same grant is refused', async () => {
    const store = {
      [`auth:token:${TOKEN}`]: USER_ID,
      [voiceGrantKey(USER_ID, CHANNEL_ID)]: GRANT_GUILD,
    };
    const redis = makeRedis(store); // shared store across both joins

    const ws1 = new MockWs();
    const rm1 = makeRoomManager();
    await identify(ws1, redis, rm1, { token: TOKEN, user_id: USER_ID, session_id: 's1', channel_id: CHANNEL_ID, server_id: GRANT_GUILD });
    expect(rm1.joinRoom).toHaveBeenCalledTimes(1);
    ws1.close();

    // The grant was single-use — it's gone, so a re-join without a freshly-minted grant fails.
    const ws2 = new MockWs();
    const rm2 = makeRoomManager();
    await identify(ws2, redis, rm2, { token: TOKEN, user_id: USER_ID, session_id: 's2', channel_id: CHANNEL_ID, server_id: GRANT_GUILD });
    expect(rm2.joinRoom).not.toHaveBeenCalled();
    expect(ws2.closed?.code).toBe(4004);
  });

  it('refuses a join when no grant exists (the core cross-channel fix)', async () => {
    const ws = new MockWs();
    const redis = makeRedis({ [`auth:token:${TOKEN}`]: USER_ID }); // no grant written
    const rm = makeRoomManager();

    await identify(ws, redis, rm, {
      token: TOKEN,
      user_id: USER_ID,
      session_id: 'sess-1',
      channel_id: CHANNEL_ID,
      server_id: GRANT_GUILD,
    });

    expect(rm.joinRoom).not.toHaveBeenCalled();
    expect(ws.closed?.code).toBe(4004);
    const err = ws.sent.find((m) => m.op === S2C_ERROR);
    expect(err?.d?.code).toBe(4004);
  });

  it('ignores a spoofed server_id and derives the guild from the grant', async () => {
    const ws = new MockWs();
    // Attacker is a member of guild "9999" (server_id) but the only grant they hold is for
    // channel 7000 in guild 5000. server_id must not influence the room's guild.
    const redis = makeRedis({
      [`auth:token:${TOKEN}`]: USER_ID,
      [voiceGrantKey(USER_ID, CHANNEL_ID)]: GRANT_GUILD,
    });
    const rm = makeRoomManager();

    await identify(ws, redis, rm, {
      token: TOKEN,
      user_id: USER_ID,
      session_id: 'sess-1',
      channel_id: CHANNEL_ID,
      server_id: '9999',
    });

    expect(rm.joinRoom).toHaveBeenCalledTimes(1);
    expect(rm.joinRoom.mock.calls[0]![1]).toBe(GRANT_GUILD); // guild from grant, not "9999"
    ws.close();
  });

  it('refuses a join with no channel_id even if a token is valid', async () => {
    const ws = new MockWs();
    const redis = makeRedis({ [`auth:token:${TOKEN}`]: USER_ID });
    const rm = makeRoomManager();

    await identify(ws, redis, rm, {
      token: TOKEN,
      user_id: USER_ID,
      session_id: 'sess-1',
      server_id: GRANT_GUILD,
    });

    expect(rm.joinRoom).not.toHaveBeenCalled();
    expect(ws.closed?.code).toBe(4004);
  });
});
