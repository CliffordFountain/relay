/**
 * Gateway WebSocket client.
 *
 * Manages the full connection lifecycle: Hello -> Identify -> Ready -> Heartbeat,
 * with automatic reconnection using exponential backoff and jitter.
 */

import { store } from '../stores/store';
import { applyVoiceState, setVoiceStates } from '../stores/voiceSlice';
import type { VoiceStateUpdatePayload } from '../stores/voiceSlice';

/**
 * Raw voice-state shape as it arrives on the wire, both as a live VOICE_STATE_UPDATE
 * dispatch and as an entry in the READY `voice_states` roster. Identity may be nested
 * under `member.user` (guild context) or `user`.
 */
interface RawVoiceState {
  user_id?: string;
  channel_id?: string | null;
  self_mute?: boolean;
  self_deaf?: boolean;
  self_video?: boolean;
  self_stream?: boolean;
  member?: { user?: { id?: string; username?: string; avatar?: string | null } };
  user?: { id?: string; username?: string; avatar?: string | null };
}

// --- Protocol types ---

interface GatewayHelloData {
  heartbeat_interval: number;
  _trace?: string[];
}

interface GatewayReadyData {
  v: number;
  user: {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    email?: string;
    verified?: boolean;
    mfa_enabled?: boolean;
    flags?: number;
    public_flags?: number;
    premium_type?: number;
    locale?: string;
    bio?: string | null;
    banner?: string | null;
    accent_color?: number | null;
    global_name?: string | null;
  };
  guilds: Array<{ id: string; unavailable: boolean }>;
  session_id: string;
  resume_gateway_url: string;
  private_channels: unknown[];
  relationships: unknown[];
  presences: unknown[];
  /** Initial voice roster: who is already in each voice channel across our guilds. */
  voice_states?: RawVoiceState[];
  _trace?: string[];
}

interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

export type GatewayConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'resuming'
  | 'reconnecting';

export type GatewayEventHandler = (eventName: string, data: unknown) => void;

export type GatewayStateChangeHandler = (state: GatewayConnectionState) => void;

// --- Opcodes ---
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
// const OP_PRESENCE_UPDATE = 3;
// const OP_VOICE_STATE_UPDATE = 4;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
// const OP_REQUEST_GUILD_MEMBERS = 8;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatJitterTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private token: string | null = null;
  private eventHandler: GatewayEventHandler | null = null;
  private stateChangeHandler: GatewayStateChangeHandler | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private connectionState: GatewayConnectionState = 'disconnected';
  private lastHeartbeatAcked = true;

  connect(token: string, handler: GatewayEventHandler, stateHandler?: GatewayStateChangeHandler): void {
    this.token = token;
    this.eventHandler = handler;
    if (stateHandler) {
      this.stateChangeHandler = stateHandler;
    }
    this.intentionalClose = false;
    this.setConnectionState('connecting');

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = import.meta.env.VITE_GATEWAY_URL || `${wsProto}//${window.location.host}/gateway`;
    this.ws = new WebSocket(url);

    // reconnectAttempts resets on a successful READY/RESUMED handshake (see handleDispatch),
    // NOT on raw socket open: a server that accepts the socket then immediately closes would
    // otherwise reset the backoff every cycle and spin in a tight reconnect loop.
    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string) as GatewayPayload;
        this.handleMessage(payload);
      } catch {
        // Malformed frame -- ignore silently
      }
    };

    this.ws.onclose = (e: CloseEvent) => this.handleClose(e);
    this.ws.onerror = () => {
      // The onerror event fires before onclose; the close handler manages reconnection.
      // No logging here to avoid console noise (per project rules: no console.log).
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setConnectionState('disconnected');
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * The current auth token. The voice-server authenticates the SFU signaling
   * connection against Redis `auth:token:<token>`, so the media plane reuses the
   * same login token the gateway connected with.
   */
  getToken(): string | null {
    return this.token;
  }

  getConnectionState(): GatewayConnectionState {
    return this.connectionState;
  }

  sendPresenceUpdate(status: string, customStatus?: string | null): void {
    this.send({
      op: 3,
      d: {
        since: status === 'idle' ? Date.now() : null,
        activities: customStatus
          ? [
              {
                name: 'Custom Status',
                type: 4,
                state: customStatus,
              },
            ]
          : [],
        status,
        afk: status === 'idle',
      },
    });
  }

  sendVoiceStateUpdate(
    guildId: string,
    channelId: string | null,
    selfMute = false,
    selfDeaf = false,
    selfVideo = false,
    selfStream = false,
  ): void {
    this.send({
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: selfMute,
        self_deaf: selfDeaf,
        // Carried so other members see our camera / screen-share ("LIVE") status; the
        // gateway persists and broadcasts these alongside mute/deaf.
        self_video: selfVideo,
        self_stream: selfStream,
      },
    });
  }

  // --- Internal methods ---

  private setConnectionState(state: GatewayConnectionState): void {
    this.connectionState = state;
    this.stateChangeHandler?.(state);
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(payload: GatewayPayload): void {
    // Update sequence number if present (only dispatch events carry sequence)
    if (payload.s != null) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case OP_HELLO:
        this.handleHello(payload.d as GatewayHelloData);
        break;

      case OP_HEARTBEAT_ACK:
        this.lastHeartbeatAcked = true;
        break;

      case OP_DISPATCH:
        this.handleDispatch(payload.t, payload.d);
        break;

      case OP_RECONNECT:
        // Server is requesting we reconnect (e.g., server restarting)
        this.attemptResume();
        break;

      case OP_INVALID_SESSION: {
        // payload.d is a boolean: true = resumable, false = not resumable
        const resumable = payload.d as boolean;
        if (resumable && this.sessionId) {
          // Wait a random 1-5 seconds before resuming (spreads out reconnects after an outage).
          // Track it in reconnectTimer so disconnect()/clearTimers cancels it — an untracked
          // timer would fire after logout and silently revive the gateway.
          this.reconnectTimer = setTimeout(() => this.attemptResume(), 1000 + Math.random() * 4000);
        } else {
          // Must re-identify with a fresh session
          this.sessionId = null;
          this.sequence = null;
          this.resumeGatewayUrl = null;
          // Wait a random 1-5 seconds before identifying (tracked so disconnect cancels it).
          this.reconnectTimer = setTimeout(() => this.identify(), 1000 + Math.random() * 4000);
        }
        break;
      }

      case OP_HEARTBEAT:
        // Server can request an immediate heartbeat
        this.sendHeartbeat();
        break;

      default:
        // Unknown opcode -- ignore
        break;
    }
  }

  private handleHello(data: GatewayHelloData): void {
    this.startHeartbeat(data.heartbeat_interval);

    // If we have a previous session, attempt to resume instead of fresh identify
    if (this.sessionId && this.sequence != null) {
      this.resume();
    } else {
      this.identify();
    }
  }

  private handleDispatch(eventName: string | null | undefined, data: unknown): void {
    if (!eventName) return;

    // Handle READY to capture session info
    if (eventName === 'READY') {
      const readyData = data as GatewayReadyData;
      this.sessionId = readyData.session_id;
      this.resumeGatewayUrl = readyData.resume_gateway_url;
      this.setConnectionState('connected');
      // A completed handshake means this connection is healthy — reset the reconnect backoff.
      this.reconnectAttempts = 0;

      // Seed the voice roster from the initial state so we immediately see who is ALREADY
      // in each voice channel. Live VOICE_STATE_UPDATEs only cover post-connect changes,
      // so without this a client that joins later never learns the existing occupants.
      const rawStates = Array.isArray(readyData.voice_states) ? readyData.voice_states : [];
      const states = rawStates
        .map(s => this.normalizeVoiceState(s))
        .filter((s): s is VoiceStateUpdatePayload => s !== null);
      const selfUserId = store.getState().auth.user?.id ?? null;
      store.dispatch(setVoiceStates({ states, selfUserId }));
    }

    // Handle RESUMED to confirm resume succeeded
    if (eventName === 'RESUMED') {
      this.setConnectionState('connected');
      this.reconnectAttempts = 0;
    }

    // Voice state changes are applied directly to the shared voice store and are NOT
    // forwarded to the app-level event handler. The payload describes an arbitrary guild
    // member (usually someone other than us), so it must update the per-channel voice
    // roster (voiceUsersByChannel) rather than the local user's own connection state.
    // Local join/leave is owned by the voice UI components.
    if (eventName === 'VOICE_STATE_UPDATE') {
      this.applyRemoteVoiceState(data);
      return;
    }

    this.eventHandler?.(eventName, data);
  }

  /**
   * Normalizes a raw wire voice-state into the redux `VoiceStateUpdatePayload` shape,
   * used for both live VOICE_STATE_UPDATEs and READY `voice_states` entries. Returns
   * null when no user id can be resolved.
   */
  private normalizeVoiceState(d: RawVoiceState): VoiceStateUpdatePayload | null {
    const userId = d.user_id ?? d.member?.user?.id ?? d.user?.id;
    if (!userId) return null;

    const userInfo = d.member?.user ?? d.user;
    return {
      userId,
      channelId: d.channel_id ?? null,
      username: userInfo?.username,
      avatar: userInfo?.avatar ?? undefined,
      selfMute: d.self_mute ?? false,
      selfDeaf: d.self_deaf ?? false,
      streaming: d.self_stream ?? false,
      video: d.self_video ?? false,
    };
  }

  private applyRemoteVoiceState(data: unknown): void {
    const normalized = this.normalizeVoiceState(data as RawVoiceState);
    if (!normalized) return;

    // Our own voice presence is managed locally by the voice components (join/leave
    // dispatch their own actions), so ignore the echo of our own state to avoid
    // fighting that local state.
    const selfId = store.getState().auth.user?.id;
    if (selfId && normalized.userId === selfId) return;

    store.dispatch(applyVoiceState(normalized));
  }

  private identify(): void {
    this.send({
      op: OP_IDENTIFY,
      d: {
        token: this.token,
        intents:
          0x1 |    // GUILDS
          0x2 |    // GUILD_MEMBERS
          0x80 |   // GUILD_VOICE_STATES (required to receive VOICE_STATE_UPDATE)
          0x100 |  // GUILD_PRESENCES
          0x200 |  // GUILD_MESSAGES
          0x400 |  // GUILD_MESSAGE_REACTIONS
          0x800 |  // GUILD_MESSAGE_TYPING
          0x1000 | // DIRECT_MESSAGES
          0x2000,  // DIRECT_MESSAGE_REACTIONS
        properties: {
          os: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
          browser: 'relay',
          device: 'web',
        },
      },
    });
  }

  private resume(): void {
    this.setConnectionState('resuming');
    this.send({
      op: OP_RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.sequence,
      },
    });
  }

  private startHeartbeat(interval: number): void {
    this.clearHeartbeatTimers();
    this.lastHeartbeatAcked = true;

    // First heartbeat after jitter (0 to interval * 1.0)
    const jitter = Math.floor(Math.random() * interval);
    this.heartbeatJitterTimer = setTimeout(() => {
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (!this.lastHeartbeatAcked) {
          // Server did not ACK our last heartbeat -- connection is zombie
          this.ws?.close(4009, 'Heartbeat timeout');
          return;
        }
        this.sendHeartbeat();
      }, interval);
    }, jitter);
  }

  private sendHeartbeat(): void {
    this.lastHeartbeatAcked = false;
    this.send({ op: OP_HEARTBEAT, d: this.sequence });
  }

  private handleClose(event: CloseEvent): void {
    this.clearTimers();

    if (this.intentionalClose) {
      this.setConnectionState('disconnected');
      return;
    }

    // Certain close codes mean we should NOT reconnect
    const nonRecoverableCodes = [4004, 4010, 4011, 4012, 4013, 4014];
    if (nonRecoverableCodes.includes(event.code)) {
      this.setConnectionState('disconnected');
      // Notify the event handler so the app can react (e.g., force re-login)
      this.eventHandler?.('GATEWAY_CLOSE', {
        code: event.code,
        reason: event.reason,
        recoverable: false,
      });
      return;
    }

    // Keep retrying indefinitely with exponential backoff, capped at 30s (plus jitter).
    // The connection-status indicator (driven by the state handler) keeps the user
    // informed while 'reconnecting', and reconnect() lets them force an attempt.
    this.setConnectionState('reconnecting');
    const exponent = Math.min(this.reconnectAttempts, 5); // 1s,2s,4s,8s,16s,32s->cap 30s
    const delay = Math.min(1000 * Math.pow(2, exponent), 30000);
    const jitter = Math.random() * 1000;
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (this.token && this.eventHandler) {
        this.connect(this.token, this.eventHandler, this.stateChangeHandler ?? undefined);
      }
    }, delay + jitter);
  }

  /**
   * Force an immediate reconnect, e.g. from a user-facing "reconnect" button in the
   * connection-status indicator. Resets the backoff so the attempt happens right away.
   */
  reconnect(): void {
    if (!this.token || !this.eventHandler) return;
    this.clearTimers();
    this.reconnectAttempts = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close(4000, 'Manual reconnect');
      } catch {
        // Socket may already be closing/closed -- ignore.
      }
      this.ws = null;
    }
    this.connect(this.token, this.eventHandler, this.stateChangeHandler ?? undefined);
  }

  private attemptResume(): void {
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close(4000, 'Reconnecting');
      this.ws = null;
    }

    if (this.token && this.eventHandler) {
      this.setConnectionState('resuming');
      // Use the resume URL if we have one, otherwise fall back to the default
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = this.resumeGatewayUrl ?? (import.meta.env.VITE_GATEWAY_URL || `${wsProto}//${window.location.host}/gateway`);
      this.ws = new WebSocket(url);

      // reconnectAttempts resets on READY/RESUMED, not raw open (see connect()).
      this.ws.onmessage = (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data as string) as GatewayPayload;
          this.handleMessage(payload);
        } catch {
          // Malformed frame
        }
      };

      this.ws.onclose = (e: CloseEvent) => this.handleClose(e);
      this.ws.onerror = () => {
        // Handled by onclose
      };
    }
  }

  private clearHeartbeatTimers(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatJitterTimer != null) {
      clearTimeout(this.heartbeatJitterTimer);
      this.heartbeatJitterTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeatTimers();
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const gateway = new GatewayClient();
