import { useSyncExternalStore } from 'react';
import type { RemoteTrackInfo } from './SfuClient';

/**
 * remoteMedia — a module-level registry of remote peers' live MediaStreams.
 *
 * MediaStreams/tracks are not serializable and must not go in Redux, so (mirroring
 * useMediaStreams' local singleton) consumed remote tracks live here, keyed by user.
 * The SfuClient feeds tracks in via voiceManager; the voice UI reads them out through
 * useRemoteMedia() to render remote camera/screen <video> and remote audio <audio>.
 */

export interface RemotePeerMedia {
  userId: string;
  camera: MediaStream | null;
  screen: MediaStream | null;
  /** One MediaStream per remote audio consumer (mic + screen-audio). */
  audios: MediaStream[];
}

interface PeerEntry {
  userId: string;
  camera: MediaStream | null;
  screen: MediaStream | null;
  cameraConsumerId: string | null;
  screenConsumerId: string | null;
  audios: Map<string, MediaStream>; // consumerId -> stream
}

const peers = new Map<string, PeerEntry>();
const listeners = new Set<() => void>();
let snapshot: RemotePeerMedia[] = [];

function getOrCreate(userId: string): PeerEntry {
  let peer = peers.get(userId);
  if (!peer) {
    peer = {
      userId,
      camera: null,
      screen: null,
      cameraConsumerId: null,
      screenConsumerId: null,
      audios: new Map(),
    };
    peers.set(userId, peer);
  }
  return peer;
}

function isEmpty(peer: PeerEntry): boolean {
  return !peer.camera && !peer.screen && peer.audios.size === 0;
}

function rebuildSnapshot(): void {
  snapshot = Array.from(peers.values()).map((p) => ({
    userId: p.userId,
    camera: p.camera,
    screen: p.screen,
    audios: Array.from(p.audios.values()),
  }));
}

function emit(): void {
  rebuildSnapshot();
  for (const l of listeners) l();
}

export const remoteMedia = {
  addTrack(info: RemoteTrackInfo): void {
    const peer = getOrCreate(info.userId);
    if (info.mediaType === 'camera') {
      peer.camera = new MediaStream([info.track]);
      peer.cameraConsumerId = info.consumerId;
    } else if (info.mediaType === 'screen') {
      peer.screen = new MediaStream([info.track]);
      peer.screenConsumerId = info.consumerId;
    } else {
      // mic or screenAudio -> an audible stream
      peer.audios.set(info.consumerId, new MediaStream([info.track]));
    }
    emit();
  },

  removeConsumer(userId: string, consumerId: string): void {
    const peer = peers.get(userId);
    if (!peer) return;
    if (peer.cameraConsumerId === consumerId) {
      peer.camera = null;
      peer.cameraConsumerId = null;
    } else if (peer.screenConsumerId === consumerId) {
      peer.screen = null;
      peer.screenConsumerId = null;
    } else {
      peer.audios.delete(consumerId);
    }
    if (isEmpty(peer)) peers.delete(userId);
    emit();
  },

  clearUser(userId: string): void {
    if (peers.delete(userId)) emit();
  },

  clearAll(): void {
    if (peers.size === 0) return;
    peers.clear();
    emit();
  },

  /** Imperative read of a single peer's current media (may be null). */
  getPeer(userId: string): RemotePeerMedia | undefined {
    return snapshot.find((p) => p.userId === userId);
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  getSnapshot(): RemotePeerMedia[] {
    return snapshot;
  },
};

/** React hook: re-renders when any remote peer's media changes. */
export function useRemoteMedia(): RemotePeerMedia[] {
  return useSyncExternalStore(remoteMedia.subscribe, remoteMedia.getSnapshot, remoteMedia.getSnapshot);
}

/** React hook for a single peer's remote media. */
export function useRemotePeerMedia(userId: string | null | undefined): RemotePeerMedia | undefined {
  const all = useRemoteMedia();
  if (!userId) return undefined;
  return all.find((p) => p.userId === userId);
}
