import { Device, types } from 'mediasoup-client';

/**
 * SfuClient — the client half of the Relay voice/video media plane.
 *
 * The voice-server (services/voice-server) is a real mediasoup SFU that speaks a
 * custom numeric {op,d} signaling protocol over a WebSocket. This class is the
 * matching client: it loads a mediasoup Device from the router capabilities the
 * server advertises in READY, builds a send and a recv WebRtcTransport (whose
 * options also arrive in READY), PRODUCEs local mic/camera/screen tracks, and
 * CONSUMEs remote producers so other users' audio/video actually plays.
 *
 * Protocol quirks this client is deliberately robust to (see voice-server/signaling.ts):
 *  - PEER_JOINED (op 9) is overloaded for BOTH presence and "new producer", so we
 *    re-process producers[] on every PEER_JOINED and de-dupe by producerId ourselves.
 *  - Existing-producer notifications arrive immediately after READY, before our recv
 *    transport exists, so producer infos are buffered and flushed once we're ready.
 *  - Consumers are created PAUSED server-side and NEW_CONSUMER carries no paused flag,
 *    so we always send RESUME_CONSUMER after consuming.
 *  - The connect ack is a SESSION_DESC message (not a per-request ack), so transport
 *    'connect' callbacks are resolved from a FIFO queue in request order.
 */

// ── Opcodes (client -> server), must match voice-server/src/signaling.ts C2S ──
const C2S = {
  IDENTIFY: 0,
  CONNECT_SEND: 1, // SELECT_PROTOCOL — connect the send transport
  HEARTBEAT: 2,
  SPEAKING: 3,
  CONNECT_RECV: 4,
  PRODUCE: 5,
  CONSUME: 6,
  RESUME_CONSUMER: 7,
  PAUSE_CONSUMER: 8,
  CLOSE_PRODUCER: 9,
  GET_ROUTER_CAPS: 10,
} as const;

// ── Opcodes (server -> client), must match voice-server/src/signaling.ts S2C ──
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

export type MediaType = 'mic' | 'camera' | 'screen' | 'screenAudio';

export interface RemoteTrackInfo {
  userId: string;
  mediaType: MediaType;
  kind: 'audio' | 'video';
  track: MediaStreamTrack;
  consumerId: string;
}

export interface SfuClientOptions {
  /** Fully-built ws(s):// signaling URL. */
  url: string;
  token: string;
  userId: string;
  sessionId: string;
  guildId: string;
  channelId: string;
  onRemoteTrack: (info: RemoteTrackInfo) => void;
  onRemoteTrackEnded: (info: { userId: string; consumerId: string }) => void;
  onPeerLeft: (info: { userId: string }) => void;
  onSpeaking?: (info: { userId: string; speaking: boolean }) => void;
  onConnected?: () => void;
  onError?: (err: unknown) => void;
}

interface ProducerInfo {
  id: string;
  kind: 'audio' | 'video';
  appData?: Record<string, unknown>;
}

/**
 * Derive the voice signaling WebSocket URL.
 *
 * We connect through the same-origin `/voice` proxy rather than directly to the
 * voice-server's port. That server speaks plain ws (no TLS), so on an HTTPS page a
 * direct wss://host:4001 fails (mixed content / TLS-against-plain-ws); routing via the
 * app origin shares the page's TLS. Protocol follows the page (wss on https, ws
 * otherwise). The advertised `endpoint` is retained for compatibility but no longer
 * determines host/port — only the media (UDP/RTP) path uses the server's announced IP.
 */
export function buildSignalingUrl(_endpoint?: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/voice`;
}

export class SfuClient {
  private ws: WebSocket | null = null;
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private heartbeatTimer: number | null = null;

  private readonly opts: SfuClientOptions;

  // FIFO queues resolving the server's shared-shape acks back to the right callback.
  private connectAcks: Array<() => void> = [];
  private produceAcks: Array<(id: { id: string }) => void> = [];

  // Local producers keyed by media type so we can close the right one on stop.
  private producers = new Map<MediaType, types.Producer>();

  // Remote consumers + producer<->consumer index for teardown on PRODUCER_CLOSED.
  private consumers = new Map<string, types.Consumer>(); // consumerId -> consumer
  private consumerByProducer = new Map<string, string>(); // producerId -> consumerId
  private consumedProducers = new Set<string>(); // producerId already consumed/in-flight

  // Producer infos that arrived before the recv transport was ready.
  private pendingProducers: Array<{ userId: string; producer: ProducerInfo }> = [];
  private ready = false;

  constructor(opts: SfuClientOptions) {
    this.opts = opts;
    const ws = new WebSocket(opts.url);
    this.ws = ws;
    ws.onmessage = (e) => {
      try {
        this.handleMessage(JSON.parse(e.data));
      } catch (err) {
        this.opts.onError?.(err);
      }
    };
    ws.onerror = (e) => this.opts.onError?.(e);
    ws.onclose = () => this.cleanup();
  }

  /** True once the mediasoup Device + transports are built and producing is possible. */
  isReady(): boolean {
    return this.ready;
  }

  private send(op: number, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  private handleMessage(msg: { op: number; d: any }): void {
    switch (msg.op) {
      case S2C.HELLO:
        this.startHeartbeat(msg.d?.heartbeat_interval ?? 13750);
        this.identify();
        break;
      case S2C.READY:
        void this.onReady(msg.d);
        break;
      case S2C.SESSION_DESC: {
        // Shared connect ack — resolve the oldest pending transport 'connect'.
        const cb = this.connectAcks.shift();
        cb?.();
        break;
      }
      case S2C.PRODUCE_SUCCESS: {
        const cb = this.produceAcks.shift();
        cb?.({ id: msg.d?.id });
        break;
      }
      case S2C.PEER_JOINED:
        this.onPeerJoined(msg.d);
        break;
      case S2C.NEW_CONSUMER:
        void this.onNewConsumer(msg.d);
        break;
      case S2C.PRODUCER_CLOSED:
        this.onProducerClosed(msg.d);
        break;
      case S2C.PEER_LEFT:
        if (msg.d?.userId) this.opts.onPeerLeft({ userId: String(msg.d.userId) });
        break;
      case S2C.SPEAKING:
        this.opts.onSpeaking?.({ userId: String(msg.d?.user_id), speaking: Boolean(msg.d?.speaking) });
        break;
      case S2C.HEARTBEAT_ACK:
        break;
      case S2C.ERROR:
        this.opts.onError?.(new Error(msg.d?.message ?? 'voice server error'));
        break;
      default:
        break;
    }
  }

  private identify(): void {
    this.send(C2S.IDENTIFY, {
      server_id: this.opts.guildId,
      user_id: this.opts.userId,
      session_id: this.opts.sessionId,
      token: this.opts.token,
      channel_id: this.opts.channelId,
    });
  }

  private startHeartbeat(interval: number): void {
    this.heartbeatTimer = window.setInterval(() => {
      this.send(C2S.HEARTBEAT, Date.now());
    }, interval);
  }

  private async onReady(d: {
    routerRtpCapabilities: types.RtpCapabilities;
    sendTransportOptions: types.TransportOptions;
    recvTransportOptions: types.TransportOptions;
  }): Promise<void> {
    try {
      const device = new Device();
      await device.load({ routerRtpCapabilities: d.routerRtpCapabilities });
      this.device = device;

      // Send transport: 'connect' fires on first produce, 'produce' on each produce.
      const sendTransport = device.createSendTransport(d.sendTransportOptions);
      sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.connectAcks.push(callback);
        try {
          this.send(C2S.CONNECT_SEND, { dtlsParameters });
        } catch (err) {
          errback(err as Error);
        }
      });
      sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.produceAcks.push(callback);
        try {
          this.send(C2S.PRODUCE, { kind, rtpParameters, appData });
        } catch (err) {
          errback(err as Error);
        }
      });
      this.sendTransport = sendTransport;

      // Recv transport: 'connect' fires on first consume.
      const recvTransport = device.createRecvTransport(d.recvTransportOptions);
      recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.connectAcks.push(callback);
        try {
          this.send(C2S.CONNECT_RECV, { dtlsParameters });
        } catch (err) {
          errback(err as Error);
        }
      });
      this.recvTransport = recvTransport;

      this.ready = true;
      this.opts.onConnected?.();

      // Flush any producers the server announced before we were ready.
      const pending = this.pendingProducers;
      this.pendingProducers = [];
      for (const p of pending) this.requestConsume(p.userId, p.producer);
    } catch (err) {
      this.opts.onError?.(err);
    }
  }

  private onPeerJoined(d: { userId: string | number; producers?: ProducerInfo[] }): void {
    const userId = String(d.userId);
    const producers = Array.isArray(d.producers) ? d.producers : [];
    // Re-process producers[] on EVERY PEER_JOINED (the op is overloaded for
    // presence + new-producer); de-dupe is by producerId, never by userId.
    for (const producer of producers) {
      if (!producer?.id) continue;
      if (this.ready) this.requestConsume(userId, producer);
      else this.pendingProducers.push({ userId, producer });
    }
  }

  private requestConsume(userId: string, producer: ProducerInfo): void {
    if (this.consumedProducers.has(producer.id)) return;
    if (!this.device) return;
    this.consumedProducers.add(producer.id);
    // Remember who owns this producer so NEW_CONSUMER (which echoes peerId) can be
    // trusted, and so teardown maps correctly.
    this.producerOwners.set(producer.id, userId);
    // Capture the media type from the PRODUCER's appData now: the server does NOT copy
    // producer appData onto the consumer, so NEW_CONSUMER arrives with empty appData and
    // a screen share would otherwise be misclassified as a camera. The producer info in
    // PEER_JOINED carries the real { mediaType }.
    this.producerMediaType.set(producer.id, this.resolveMediaType(producer.appData, producer.kind));
    this.send(C2S.CONSUME, {
      producerId: producer.id,
      rtpCapabilities: this.device.rtpCapabilities,
    });
  }

  private producerOwners = new Map<string, string>(); // producerId -> userId
  private producerMediaType = new Map<string, MediaType>(); // producerId -> media type (from producer appData)

  private async onNewConsumer(d: {
    peerId: string;
    producerId: string;
    consumerId: string;
    kind: 'audio' | 'video';
    rtpParameters: types.RtpParameters;
    appData?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.recvTransport) return;
    try {
      const consumer = await this.recvTransport.consume({
        id: d.consumerId,
        producerId: d.producerId,
        kind: d.kind,
        rtpParameters: d.rtpParameters,
        appData: d.appData ?? {},
      });
      this.consumers.set(consumer.id, consumer);
      this.consumerByProducer.set(d.producerId, consumer.id);
      this.consumedProducers.add(d.producerId);

      // Server creates consumers paused; resume so RTP actually flows.
      this.send(C2S.RESUME_CONSUMER, { consumerId: consumer.id });

      const userId =
        this.producerOwners.get(d.producerId) ?? (d.peerId ? String(d.peerId) : 'unknown');
      // Prefer the media type captured from the producer's appData (correct for screen
      // vs camera); fall back to the consumer's appData / kind only if unknown.
      const mediaType =
        this.producerMediaType.get(d.producerId) ?? this.resolveMediaType(d.appData, d.kind);
      this.opts.onRemoteTrack({
        userId,
        mediaType,
        kind: d.kind,
        track: consumer.track,
        consumerId: consumer.id,
      });
    } catch (err) {
      this.consumedProducers.delete(d.producerId);
      this.opts.onError?.(err);
    }
  }

  private resolveMediaType(appData: Record<string, unknown> | undefined, kind: 'audio' | 'video'): MediaType {
    const mt = appData?.mediaType;
    if (mt === 'mic' || mt === 'camera' || mt === 'screen' || mt === 'screenAudio') return mt;
    return kind === 'audio' ? 'mic' : 'camera';
  }

  private onProducerClosed(d: { peerId?: string; producerId?: string }): void {
    if (!d.producerId) return;
    const consumerId = this.consumerByProducer.get(d.producerId);
    const userId = this.producerOwners.get(d.producerId) ?? (d.peerId ? String(d.peerId) : 'unknown');
    if (consumerId) {
      const consumer = this.consumers.get(consumerId);
      consumer?.close();
      this.consumers.delete(consumerId);
      this.consumerByProducer.delete(d.producerId);
      this.opts.onRemoteTrackEnded({ userId, consumerId });
    }
    this.consumedProducers.delete(d.producerId);
    this.producerOwners.delete(d.producerId);
    this.producerMediaType.delete(d.producerId);
  }

  // ── Public: local production ────────────────────────────────────────────

  /**
   * Produce (or replace) a local track for the given media type. Closes any
   * existing producer of that type first (e.g. switching cameras). Returns the
   * server producer id, or null if not ready.
   */
  async produce(mediaType: MediaType, track: MediaStreamTrack): Promise<string | null> {
    if (!this.sendTransport || !this.ready) return null;
    const existing = this.producers.get(mediaType);
    if (existing && existing.track?.id === track.id && !existing.closed) {
      return existing.id; // already producing this exact track
    }
    if (existing) this.closeProducer(mediaType);

    const isVideo = track.kind === 'video';
    // stopTracks:false — never stop the raw local capture track when this producer is closed
    // (mediasoup-client defaults to stopTracks:true). Otherwise a transport/WS teardown closes
    // the producers and STOPS the mic/camera/screen tracks, blacking out the sender's OWN local
    // preview and killing capture. Decoupling here keeps the self-view (and re-produce) alive.
    let produceOptions: Parameters<types.Transport['produce']>[0] = { track, appData: { mediaType }, stopTracks: false };
    if (isVideo) {
      // Give the encoder a real bitrate budget. Without explicit `encodings`, libwebrtc
      // caps VP8 at a low default (~1–2 Mbps) and ramps up slowly, which looks poor and
      // stutters even on a fast LAN. Size the cap to the captured resolution and the
      // content type, and start high so it doesn't crawl up from nothing.
      const isScreen = mediaType === 'screen';
      const height = track.getSettings().height ?? 720;
      const maxBitrate = isScreen
        ? height >= 1440
          ? 10_000_000
          : height >= 1080
            ? 6_000_000
            : 4_000_000
        : height >= 1080
          ? 3_000_000
          : 1_800_000;
      // Content hint steers the quality/framerate tradeoff: screen = detail, camera = motion.
      try {
        track.contentHint = isScreen ? 'detail' : 'motion';
      } catch {
        /* not supported — ignore */
      }
      produceOptions = {
        track,
        appData: { mediaType },
        stopTracks: false, // keep the raw camera/screen track alive when the producer closes
        encodings: [{ maxBitrate }],
        // Start bitrate in kbps; begin at roughly half the cap so it ramps fast on a LAN.
        codecOptions: { videoGoogleStartBitrate: Math.min(4000, Math.round(maxBitrate / 2000)) },
      };
    }
    const producer = await this.sendTransport.produce(produceOptions);
    this.producers.set(mediaType, producer);
    producer.on('trackended', () => this.closeProducer(mediaType));
    producer.observer.on('close', () => {
      if (this.producers.get(mediaType) === producer) this.producers.delete(mediaType);
    });
    return producer.id;
  }

  /** Whether a producer of this media type is currently active. */
  hasProducer(mediaType: MediaType): boolean {
    const p = this.producers.get(mediaType);
    return Boolean(p && !p.closed);
  }

  /** Stop producing the given media type and tell the server to drop the producer. */
  closeProducer(mediaType: MediaType): void {
    const producer = this.producers.get(mediaType);
    if (!producer) return;
    const producerId = producer.id;
    if (!producer.closed) producer.close();
    this.producers.delete(mediaType);
    this.send(C2S.CLOSE_PRODUCER, { producerId });
  }

  setSpeaking(speaking: boolean): void {
    this.send(C2S.SPEAKING, { speaking: speaking ? 1 : 0, delay: 0, ssrc: 0 });
  }

  close(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear();
    this.consumerByProducer.clear();
    this.consumedProducers.clear();
    this.producerOwners.clear();
    this.producerMediaType.clear();
    for (const producer of this.producers.values()) producer.close();
    this.producers.clear();
    this.pendingProducers = [];
    this.connectAcks = [];
    this.produceAcks = [];
    try {
      this.sendTransport?.close();
      this.recvTransport?.close();
    } catch {
      /* ignore */
    }
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.ready = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    this.ws = null;
  }
}
