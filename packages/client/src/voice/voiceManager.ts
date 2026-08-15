import { SfuClient, buildSignalingUrl, type MediaType } from './SfuClient';
import { remoteMedia } from './remoteMedia';
import { getMediaState, subscribeMediaChange } from '../hooks/useMediaStreams';
import { store } from '../stores/store';
import { gateway } from '../api/gateway';
import { setSpeaking } from '../stores/voiceSlice';

/**
 * voiceManager — singleton that owns the live SFU media session.
 *
 * It is driven by three inputs:
 *   1. VOICE_SERVER_UPDATE from the gateway (App.tsx) -> connect() with the endpoint.
 *   2. The local-media singleton (useMediaStreams) -> reconcile() produces/stops the
 *      mic / camera / screen / screen-audio tracks on the send transport.
 *   3. The redux voice.channelId dropping to null (leave) -> disconnect().
 *
 * Consumed remote tracks are pushed into the remoteMedia registry, which the voice
 * UI renders. This is the bridge that was entirely missing: presence flowed through
 * the gateway, but no actual RTP ever did.
 */

export interface VoiceServerInfo {
  endpoint: string;
  guildId: string;
  channelId: string;
}

class VoiceManager {
  private sfu: SfuClient | null = null;
  private channelId: string | null = null;
  private unsubMedia: (() => void) | null = null;
  private reconcileChain: Promise<void> = Promise.resolve();
  private lastKnownChannelId: string | null = null;
  private unsubStore: (() => void) | null = null;

  /** Start (or switch) the SFU media session for a voice channel. */
  connect(info: VoiceServerInfo): void {
    const state = store.getState();
    const token = gateway.getToken();
    const userId = state.auth.user?.id;
    if (!token || !userId) return;

    // Already on this channel — nothing to do.
    if (this.sfu && this.channelId === info.channelId) return;
    // Switching channels — drop the old session first.
    if (this.sfu) this.disconnect();

    const sessionId = gateway.getSessionId() ?? `${userId}:${info.channelId}`;
    this.channelId = info.channelId;
    this.lastKnownChannelId = state.voice.channelId;

    // Tear down when the user leaves voice (channelId -> null). Subscribed lazily here
    // (not in the constructor) so importing this module has no store side effects.
    if (!this.unsubStore) {
      this.unsubStore = store.subscribe(() => {
        const ch = store.getState().voice.channelId;
        if (ch === this.lastKnownChannelId) return;
        this.lastKnownChannelId = ch;
        if (ch === null && this.sfu) this.disconnect();
      });
    }

    this.sfu = new SfuClient({
      url: buildSignalingUrl(info.endpoint),
      token,
      userId,
      sessionId,
      guildId: info.guildId,
      channelId: info.channelId,
      onConnected: () => this.reconcile(),
      onRemoteTrack: (t) => remoteMedia.addTrack(t),
      onRemoteTrackEnded: ({ userId: uid, consumerId }) => remoteMedia.removeConsumer(uid, consumerId),
      onPeerLeft: ({ userId: uid }) => remoteMedia.clearUser(uid),
      onSpeaking: ({ userId: uid, speaking }) => {
        store.dispatch(setSpeaking({ userId: uid, speaking }));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error('[voice] SFU error:', err);
      },
    });

    // Reconcile producers whenever local capture changes (unmute, camera on, share).
    this.unsubMedia = subscribeMediaChange(() => this.reconcile());
  }

  disconnect(): void {
    this.unsubMedia?.();
    this.unsubMedia = null;
    this.unsubStore?.();
    this.unsubStore = null;
    this.sfu?.close();
    this.sfu = null;
    this.channelId = null;
    remoteMedia.clearAll();
  }

  /** Relay local speaking state to the SFU (called by the VAD hook). */
  setSpeaking(speaking: boolean): void {
    this.sfu?.setSpeaking(speaking);
  }

  /** Serialize reconciles so we never double-produce the same media type. */
  private reconcile(): void {
    this.reconcileChain = this.reconcileChain.then(() => this.doReconcile()).catch(() => {});
  }

  private async doReconcile(): Promise<void> {
    const sfu = this.sfu;
    if (!sfu || !sfu.isReady()) return;
    const media = getMediaState();

    const desired: Array<[MediaType, MediaStreamTrack | undefined]> = [
      ['mic', media.audioStream?.getAudioTracks()[0]],
      ['camera', media.videoStream?.getVideoTracks()[0]],
      ['screen', media.screenStream?.getVideoTracks()[0]],
      ['screenAudio', media.screenStream?.getAudioTracks()[0]],
    ];

    for (const [mediaType, track] of desired) {
      if (track && track.readyState === 'live') {
        try {
          await sfu.produce(mediaType, track);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[voice] failed to produce ${mediaType}:`, err);
        }
      } else if (sfu.hasProducer(mediaType)) {
        sfu.closeProducer(mediaType);
      }
    }
  }
}

export const voiceManager = new VoiceManager();
