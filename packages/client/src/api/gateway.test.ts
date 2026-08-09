import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GatewayEventHandler, GatewayConnectionState, GatewayStateChangeHandler } from './gateway';

// --- Mock WebSocket ---

interface MockWSInstance {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

let mockWSInstances: MockWSInstance[] = [];

class MockWebSocket implements MockWSInstance {
  url: string;
  readyState = 0; // CONNECTING
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    mockWSInstances.push(this);
  }
}

// Simulate the WebSocket opening and the server sending Hello
function simulateOpen(ws: MockWSInstance): void {
  ws.readyState = MockWebSocket.OPEN;
  ws.onopen?.(new Event('open'));
}

function simulateMessage(ws: MockWSInstance, data: unknown): void {
  ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
}

function simulateClose(ws: MockWSInstance, code = 1000, reason = ''): void {
  ws.readyState = MockWebSocket.CLOSED;
  ws.onclose?.(new CloseEvent('close', { code, reason }));
}

function sendHello(ws: MockWSInstance, interval = 41250): void {
  simulateMessage(ws, { op: 10, d: { heartbeat_interval: interval } });
}

function sendReady(ws: MockWSInstance, sessionId = 'test-session-123'): void {
  simulateMessage(ws, {
    op: 0,
    d: {
      v: 10,
      user: { id: '1', username: 'testuser', discriminator: '0', avatar: null },
      guilds: [{ id: '100', unavailable: false }],
      session_id: sessionId,
      resume_gateway_url: 'ws://resume.test/gateway',
      private_channels: [],
      relationships: [],
      presences: [],
    },
    s: 1,
    t: 'READY',
  });
}

function sendHeartbeatAck(ws: MockWSInstance): void {
  simulateMessage(ws, { op: 11 });
}

// Helper to get the last sent payload
function getLastSent(ws: MockWSInstance): unknown {
  const calls = ws.send.mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) return undefined;
  return JSON.parse(lastCall[0] as string) as unknown;
}

function getAllSent(ws: MockWSInstance): unknown[] {
  return ws.send.mock.calls.map((call) => JSON.parse(call[0] as string) as unknown);
}

// We need to dynamically import the gateway module after setting up the WebSocket mock
let gateway: { gateway: { connect: (token: string, handler: GatewayEventHandler, stateHandler?: GatewayStateChangeHandler) => void; disconnect: () => void; getSessionId: () => string | null; getConnectionState: () => GatewayConnectionState; sendPresenceUpdate: (status: string, customStatus?: string | null) => void; sendVoiceStateUpdate: (guildId: string, channelId: string | null, selfMute?: boolean, selfDeaf?: boolean, selfVideo?: boolean, selfStream?: boolean) => void } };

describe('GatewayClient', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mockWSInstances = [];

    // Mock the WebSocket global
    vi.stubGlobal('WebSocket', MockWebSocket);

    // Clear VITE_GATEWAY_URL so the gateway uses the default fallback URL
    delete (import.meta.env as Record<string, unknown>).VITE_GATEWAY_URL;

    // Re-import gateway module to get a fresh instance
    vi.resetModules();
    gateway = await import('./gateway');
  });

  afterEach(() => {
    gateway.gateway.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('Connection lifecycle', () => {
    it('creates a WebSocket connection to the gateway URL', () => {
      const handler = vi.fn();
      gateway.gateway.connect('test-token', handler);

      expect(mockWSInstances).toHaveLength(1);
      // Fallback is derived from window.location so the app works from any host
      // (localhost, a LAN IP, or a hostname). jsdom's default location drives this.
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      expect(mockWSInstances[0]?.url).toBe(`${wsProto}//${window.location.host}/gateway`);
    });

    it('starts in connecting state', () => {
      const stateHandler = vi.fn();
      gateway.gateway.connect('test-token', vi.fn(), stateHandler);

      expect(stateHandler).toHaveBeenCalledWith('connecting');
    });

    it('sends Identify after receiving Hello', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);

      const sent = getAllSent(ws);
      // Should have sent an Identify (op 2)
      const identify = sent.find((p) => (p as Record<string, unknown>).op === 2) as Record<string, unknown> | undefined;
      expect(identify).toBeDefined();
      expect(identify?.op).toBe(2);

      const identifyData = identify?.d as Record<string, unknown>;
      expect(identifyData?.token).toBe('test-token');
      // 0x80 = GUILD_VOICE_STATES, required to receive VOICE_STATE_UPDATE events.
      expect(identifyData?.intents).toBe(0x1 | 0x2 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x1000 | 0x2000);
    });

    it('sets sessionId from READY event', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);
      sendReady(ws, 'my-session-42');

      expect(gateway.gateway.getSessionId()).toBe('my-session-42');
    });

    it('transitions to connected state after READY', () => {
      const stateHandler = vi.fn();
      gateway.gateway.connect('test-token', vi.fn(), stateHandler);
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);
      sendReady(ws);

      expect(stateHandler).toHaveBeenCalledWith('connected');
      expect(gateway.gateway.getConnectionState()).toBe('connected');
    });

    it('dispatches READY event to the handler', () => {
      const handler = vi.fn();
      gateway.gateway.connect('test-token', handler);
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);
      sendReady(ws);

      expect(handler).toHaveBeenCalledWith('READY', expect.objectContaining({
        session_id: 'test-session-123',
        user: expect.objectContaining({ username: 'testuser' }),
      }));
    });

    it('dispatches generic events to the handler', () => {
      const handler = vi.fn();
      gateway.gateway.connect('test-token', handler);
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);
      sendReady(ws);

      simulateMessage(ws, {
        op: 0,
        d: { id: 'msg-1', channel_id: 'ch-1', content: 'hello' },
        s: 2,
        t: 'MESSAGE_CREATE',
      });

      expect(handler).toHaveBeenCalledWith('MESSAGE_CREATE', expect.objectContaining({
        id: 'msg-1',
        content: 'hello',
      }));
    });
  });

  describe('Heartbeat', () => {
    it('sends heartbeat after jittered initial delay', () => {
      // Mock Math.random to return 0 for zero jitter
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws, 41250);

      // Clear the Identify that was sent
      ws.send.mockClear();

      // Advance past the jitter delay (0 * 41250 = 0ms)
      vi.advanceTimersByTime(1);

      const sent = getLastSent(ws) as Record<string, unknown> | undefined;
      expect(sent?.op).toBe(1); // Heartbeat
    });

    it('sends periodic heartbeats after initial', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws, 1000); // Use short interval for testing

      // Advance past initial jitter
      vi.advanceTimersByTime(1);

      // ACK the first heartbeat
      sendHeartbeatAck(ws);

      ws.send.mockClear();

      // Advance one interval
      vi.advanceTimersByTime(1000);

      const sent = getLastSent(ws) as Record<string, unknown> | undefined;
      expect(sent?.op).toBe(1);
    });

    it('closes connection if heartbeat not ACKed', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws, 1000);

      // Advance past initial jitter to send first heartbeat
      vi.advanceTimersByTime(1);

      // Do NOT send HeartbeatACK
      // Advance another interval -- should trigger zombie detection
      vi.advanceTimersByTime(1000);

      expect(ws.close).toHaveBeenCalledWith(4009, 'Heartbeat timeout');
    });
  });

  describe('Disconnect', () => {
    it('closes the WebSocket on disconnect', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);

      gateway.gateway.disconnect();

      expect(ws.close).toHaveBeenCalledWith(1000, 'Client disconnect');
      expect(gateway.gateway.getConnectionState()).toBe('disconnected');
    });

    it('does not reconnect after intentional disconnect', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);

      gateway.gateway.disconnect();

      // Advance time to check no reconnect happens
      vi.advanceTimersByTime(60000);

      // Should only have the initial WebSocket, no new ones
      expect(mockWSInstances).toHaveLength(1);
    });
  });

  describe('Reconnection', () => {
    it('reconnects with exponential backoff on unexpected close', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);

      // Simulate unexpected close
      simulateClose(ws, 1006, 'Abnormal closure');

      expect(gateway.gateway.getConnectionState()).toBe('reconnecting');

      // Advance past first reconnect delay (1000ms + jitter)
      vi.advanceTimersByTime(2000);

      // Should have created a new WebSocket
      expect(mockWSInstances.length).toBeGreaterThan(1);
    });

    it('does not reconnect on non-recoverable close codes', () => {
      const handler = vi.fn();
      gateway.gateway.connect('test-token', handler);
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);

      // 4004 = Authentication failed -- should NOT reconnect
      simulateClose(ws, 4004, 'Authentication failed');

      expect(gateway.gateway.getConnectionState()).toBe('disconnected');

      // Advance time
      vi.advanceTimersByTime(60000);

      // Should only have the initial WebSocket
      expect(mockWSInstances).toHaveLength(1);

      // Should notify via GATEWAY_CLOSE event
      expect(handler).toHaveBeenCalledWith('GATEWAY_CLOSE', expect.objectContaining({
        code: 4004,
        recoverable: false,
      }));
    });

    it('stops reconnecting after max attempts', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());

      // Simulate 5 failed connections that close WITHOUT opening (so reconnectAttempts
      // keeps incrementing and never resets). This simulates the server being unreachable.
      for (let i = 0; i < 5; i++) {
        const ws = mockWSInstances[mockWSInstances.length - 1]!;
        // Close without opening (simulates connection failure)
        simulateClose(ws, 1006, 'Abnormal closure');

        // Advance past reconnect delay
        vi.advanceTimersByTime(31000);
      }

      // After 5 failed attempts, the next close should NOT schedule another reconnect
      const ws = mockWSInstances[mockWSInstances.length - 1]!;
      simulateClose(ws, 1006, 'Abnormal closure');

      expect(gateway.gateway.getConnectionState()).toBe('disconnected');
    });

    it('resets reconnect attempts on successful connection', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());

      // First connection fails
      const ws1 = mockWSInstances[0]!;
      simulateOpen(ws1);
      simulateClose(ws1, 1006, 'Abnormal closure');

      vi.advanceTimersByTime(2000);

      // Second connection succeeds
      const ws2 = mockWSInstances[1]!;
      simulateOpen(ws2);

      // Now if it closes, it should start from attempt 0 again
      simulateClose(ws2, 1006, 'Abnormal closure');

      vi.advanceTimersByTime(2000);

      // Should have created a third WebSocket
      expect(mockWSInstances.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Resume', () => {
    it('sends Resume (op 6) when reconnecting with existing session', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());
      const ws1 = mockWSInstances[0]!;
      simulateOpen(ws1);
      sendHello(ws1);
      sendReady(ws1, 'session-abc');

      // Dispatch a message to advance sequence
      simulateMessage(ws1, { op: 0, d: {}, s: 5, t: 'MESSAGE_CREATE' });

      // Simulate unexpected close
      simulateClose(ws1, 1006, 'Lost connection');

      vi.advanceTimersByTime(2000);

      // New connection opens
      const ws2 = mockWSInstances[1]!;
      simulateOpen(ws2);
      sendHello(ws2);

      // Should have sent Resume instead of Identify
      const sent = getAllSent(ws2);
      const resume = sent.find((p) => (p as Record<string, unknown>).op === 6) as Record<string, unknown> | undefined;
      expect(resume).toBeDefined();

      const resumeData = resume?.d as Record<string, unknown>;
      expect(resumeData?.token).toBe('test-token');
      expect(resumeData?.session_id).toBe('session-abc');
      expect(resumeData?.seq).toBe(5);
    });
  });

  describe('Invalid Session', () => {
    it('re-identifies on non-resumable Invalid Session (op 9, d: false)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);

      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);
      sendReady(ws, 'session-abc');

      ws.send.mockClear();

      // Server sends Invalid Session with d: false (not resumable)
      simulateMessage(ws, { op: 9, d: false });

      // Should wait 1-5 seconds then re-identify
      vi.advanceTimersByTime(1100);

      const sent = getAllSent(ws);
      const identify = sent.find((p) => (p as Record<string, unknown>).op === 2) as Record<string, unknown> | undefined;
      expect(identify).toBeDefined();

      // Session should be cleared
      expect(gateway.gateway.getSessionId()).toBeNull();
    });
  });

  describe('Sequence tracking', () => {
    it('updates sequence from dispatch events', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);
      sendReady(ws);

      simulateMessage(ws, { op: 0, d: {}, s: 42, t: 'SOME_EVENT' });

      // The sequence should be tracked internally and sent with heartbeats
      vi.spyOn(Math, 'random').mockReturnValue(0);

      // Clear old sends
      ws.send.mockClear();

      // Force a heartbeat by sending op 1 from server (request immediate heartbeat)
      simulateMessage(ws, { op: 1 });

      const sent = getLastSent(ws) as Record<string, unknown>;
      expect(sent?.op).toBe(1);
      expect(sent?.d).toBe(42);
    });
  });

  describe('Presence and Voice', () => {
    it('sends presence update with correct payload', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      ws.send.mockClear();

      gateway.gateway.sendPresenceUpdate('dnd', 'Working');

      const sent = getLastSent(ws) as Record<string, unknown>;
      expect(sent?.op).toBe(3);

      const d = sent?.d as Record<string, unknown>;
      expect(d?.status).toBe('dnd');
      expect(d?.since).toBeNull();
      expect(d?.afk).toBe(false);

      const activities = d?.activities as Array<Record<string, unknown>>;
      expect(activities).toHaveLength(1);
      expect(activities[0]?.state).toBe('Working');
    });

    it('sends voice state update', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      ws.send.mockClear();

      gateway.gateway.sendVoiceStateUpdate('guild-1', 'channel-1');

      const sent = getLastSent(ws) as Record<string, unknown>;
      expect(sent?.op).toBe(4);

      const d = sent?.d as Record<string, unknown>;
      expect(d?.guild_id).toBe('guild-1');
      expect(d?.channel_id).toBe('channel-1');
      expect(d?.self_mute).toBe(false);
      expect(d?.self_deaf).toBe(false);
      // Streaming flags default to false and are always present on the wire.
      expect(d?.self_video).toBe(false);
      expect(d?.self_stream).toBe(false);
    });

    it('carries self_video and self_stream flags so others see live status', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      ws.send.mockClear();

      gateway.gateway.sendVoiceStateUpdate('guild-1', 'channel-1', false, false, true, true);

      const d = (getLastSent(ws) as Record<string, unknown>)?.d as Record<string, unknown>;
      expect(d?.self_video).toBe(true);
      expect(d?.self_stream).toBe(true);
    });

    it('sends voice leave (channel_id null)', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      ws.send.mockClear();

      gateway.gateway.sendVoiceStateUpdate('guild-1', null);

      const sent = getLastSent(ws) as Record<string, unknown>;
      const d = sent?.d as Record<string, unknown>;
      expect(d?.channel_id).toBeNull();
    });

    it('seeds the voice roster from READY voice_states', async () => {
      // The store singleton is re-imported from the same fresh module graph as the
      // gateway (both loaded post vi.resetModules), so they share one instance.
      const { store } = await import('../stores/store');

      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);
      sendHello(ws);

      simulateMessage(ws, {
        op: 0,
        s: 1,
        t: 'READY',
        d: {
          v: 10,
          user: { id: '1', username: 'testuser', discriminator: '0', avatar: null },
          guilds: [{ id: '100', unavailable: false }],
          session_id: 'sess-voice',
          resume_gateway_url: '',
          private_channels: [],
          relationships: [],
          presences: [],
          voice_states: [
            {
              user_id: '2',
              channel_id: 'vc-1',
              self_mute: true,
              self_stream: true,
              member: { user: { id: '2', username: 'Alice', avatar: null } },
            },
          ],
        },
      });

      const roster = store.getState().voice.voiceUsersByChannel['vc-1'];
      expect(roster).toHaveLength(1);
      expect(roster?.[0]?.userId).toBe('2');
      expect(roster?.[0]?.username).toBe('Alice');
      expect(roster?.[0]?.selfMute).toBe(true);
      expect(roster?.[0]?.streaming).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('ignores malformed messages without crashing', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      simulateOpen(ws);

      // Send invalid JSON
      expect(() => {
        ws.onmessage?.(new MessageEvent('message', { data: 'not json' }));
      }).not.toThrow();
    });

    it('does not send when WebSocket is not open', () => {
      gateway.gateway.connect('test-token', vi.fn());
      const ws = mockWSInstances[0]!;
      // WebSocket is still CONNECTING (readyState = 0)

      gateway.gateway.sendPresenceUpdate('online');

      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});
