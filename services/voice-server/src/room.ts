import type * as mediasoup from 'mediasoup';
import type { WebSocket } from 'ws';
import { mediaCodecs, webRtcTransportOptions } from './mediasoup-config.js';

// ── Types ────────────────────────────────────────────────────────────

export interface Peer {
  userId: string;
  sessionId: string;
  ws: WebSocket;
  sendTransport: mediasoup.types.WebRtcTransport | null;
  recvTransport: mediasoup.types.WebRtcTransport | null;
  producers: Map<string, mediasoup.types.Producer>; // keyed by producer.id
  consumers: Map<string, mediasoup.types.Consumer>; // keyed by consumer.id
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
}

export interface Room {
  id: string; // channel_id
  guildId: string;
  router: mediasoup.types.Router;
  peers: Map<string, Peer>; // keyed by userId
  createdAt: Date;
}

// ── Transport options returned to client ─────────────────────────────

export interface TransportOptions {
  id: string;
  iceParameters: mediasoup.types.IceParameters;
  iceCandidates: mediasoup.types.IceCandidate[];
  dtlsParameters: mediasoup.types.DtlsParameters;
}

function transportToOptions(t: mediasoup.types.WebRtcTransport): TransportOptions {
  return {
    id: t.id,
    iceParameters: t.iceParameters,
    iceCandidates: t.iceCandidates,
    dtlsParameters: t.dtlsParameters,
  };
}

// ── RoomManager ──────────────────────────────────────────────────────

export class RoomManager {
  private rooms = new Map<string, Room>();
  private workers: mediasoup.types.Worker[];
  private workerIdx = 0;

  constructor(workers: mediasoup.types.Worker[]) {
    this.workers = workers;
  }

  // Round-robin worker selection
  private nextWorker(): mediasoup.types.Worker {
    const w = this.workers[this.workerIdx % this.workers.length]!;
    this.workerIdx++;
    return w;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getRoom(channelId: string): Room | undefined {
    return this.rooms.get(channelId);
  }

  // ── Create / get room ────────────────────────────────────────────

  async getOrCreateRoom(channelId: string, guildId: string): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) return existing;

    const worker = this.nextWorker();
    const router = await worker.createRouter({ mediaCodecs });

    const room: Room = {
      id: channelId,
      guildId,
      router,
      peers: new Map(),
      createdAt: new Date(),
    };

    this.rooms.set(channelId, room);
    console.log(`Room created: ${channelId} (guild ${guildId})`);
    return room;
  }

  // ── Join ──────────────────────────────────────────────────────────

  async joinRoom(
    channelId: string,
    guildId: string,
    userId: string,
    sessionId: string,
    ws: WebSocket,
  ): Promise<{ room: Room; peer: Peer; sendOpts: TransportOptions; recvOpts: TransportOptions }> {
    const room = await this.getOrCreateRoom(channelId, guildId);

    // If the user is already in this room (reconnect), clean up old state
    if (room.peers.has(userId)) {
      await this.leaveRoom(channelId, userId);
    }

    // Create transports
    const sendTransport = await room.router.createWebRtcTransport(webRtcTransportOptions);
    const recvTransport = await room.router.createWebRtcTransport(webRtcTransportOptions);
    // Allow high-bitrate inbound media (1080p/1440p/4K); createWebRtcTransport ignores maxIncomingBitrate in options.
    await sendTransport.setMaxIncomingBitrate(10_000_000).catch(() => { /* non-fatal */ });
    await recvTransport.setMaxIncomingBitrate(10_000_000).catch(() => { /* non-fatal */ });

    const peer: Peer = {
      userId,
      sessionId,
      ws,
      sendTransport,
      recvTransport,
      producers: new Map(),
      consumers: new Map(),
      speaking: false,
      muted: false,
      deafened: false,
    };

    room.peers.set(userId, peer);

    return {
      room,
      peer,
      sendOpts: transportToOptions(sendTransport),
      recvOpts: transportToOptions(recvTransport),
    };
  }

  // ── Leave ─────────────────────────────────────────────────────────

  async leaveRoom(channelId: string, userId: string): Promise<string[] | null> {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    const peer = room.peers.get(userId);
    if (!peer) return null;

    // Collect producer IDs that are being removed (so callers can notify)
    const removedProducerIds = [...peer.producers.keys()];

    // Close all consumers
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }

    // Close all producers
    for (const producer of peer.producers.values()) {
      producer.close();
    }

    // Close transports
    peer.sendTransport?.close();
    peer.recvTransport?.close();

    room.peers.delete(userId);
    console.log(`Peer ${userId} left room ${channelId}`);

    // Destroy room when empty
    if (room.peers.size === 0) {
      room.router.close();
      this.rooms.delete(channelId);
      console.log(`Room destroyed: ${channelId}`);
    }

    return removedProducerIds;
  }

  // ── Connect transport ─────────────────────────────────────────────

  async connectTransport(
    channelId: string,
    userId: string,
    direction: 'send' | 'recv',
    dtlsParameters: mediasoup.types.DtlsParameters,
  ): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(userId);
    if (!peer) throw new Error('Peer not found');

    const transport = direction === 'send' ? peer.sendTransport : peer.recvTransport;
    if (!transport) throw new Error(`${direction} transport not found`);

    await transport.connect({ dtlsParameters });
  }

  // ── Produce ───────────────────────────────────────────────────────

  async produce(
    channelId: string,
    userId: string,
    kind: mediasoup.types.MediaKind,
    rtpParameters: mediasoup.types.RtpParameters,
    appData?: Record<string, unknown>,
  ): Promise<mediasoup.types.Producer> {
    const room = this.rooms.get(channelId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(userId);
    if (!peer || !peer.sendTransport) throw new Error('Peer or send transport not found');

    const producer = await peer.sendTransport.produce({
      kind,
      rtpParameters,
      appData: appData ?? {},
    });

    peer.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
    });

    return producer;
  }

  // ── Consume ───────────────────────────────────────────────────────

  async consume(
    channelId: string,
    consumerUserId: string,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities,
  ): Promise<mediasoup.types.Consumer | null> {
    const room = this.rooms.get(channelId);
    if (!room) return null;

    const peer = room.peers.get(consumerUserId);
    if (!peer || !peer.recvTransport) return null;

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      console.warn(`Router cannot consume producer ${producerId} for peer ${consumerUserId}`);
      return null;
    }

    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // client resumes after setup
    });

    peer.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
    });

    return consumer;
  }

  // ── Pause / resume / close producer ───────────────────────────────

  async pauseProducer(channelId: string, userId: string, producerId: string): Promise<boolean> {
    const producer = this.findPeerProducer(channelId, userId, producerId);
    if (!producer) return false;
    await producer.pause();
    return true;
  }

  async resumeProducer(channelId: string, userId: string, producerId: string): Promise<boolean> {
    const producer = this.findPeerProducer(channelId, userId, producerId);
    if (!producer) return false;
    await producer.resume();
    return true;
  }

  closeProducer(channelId: string, userId: string, producerId: string): boolean {
    const room = this.rooms.get(channelId);
    if (!room) return false;
    const peer = room.peers.get(userId);
    if (!peer) return false;
    const producer = peer.producers.get(producerId);
    if (!producer) return false;
    producer.close();
    peer.producers.delete(producerId);
    return true;
  }

  // ── Resume / pause consumer ───────────────────────────────────────

  async resumeConsumer(channelId: string, userId: string, consumerId: string): Promise<boolean> {
    const room = this.rooms.get(channelId);
    if (!room) return false;
    const peer = room.peers.get(userId);
    if (!peer) return false;
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) return false;
    await consumer.resume();
    return true;
  }

  async pauseConsumer(channelId: string, userId: string, consumerId: string): Promise<boolean> {
    const room = this.rooms.get(channelId);
    if (!room) return false;
    const peer = room.peers.get(userId);
    if (!peer) return false;
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) return false;
    await consumer.pause();
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private findPeerProducer(
    channelId: string,
    userId: string,
    producerId: string,
  ): mediasoup.types.Producer | undefined {
    return this.rooms.get(channelId)?.peers.get(userId)?.producers.get(producerId);
  }

  /** Find which userId owns a given producerId */
  findProducerOwner(room: Room, producerId: string): string | undefined {
    for (const [uid, peer] of room.peers) {
      if (peer.producers.has(producerId)) return uid;
    }
    return undefined;
  }
}
