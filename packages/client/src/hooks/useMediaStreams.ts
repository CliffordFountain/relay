import { useRef, useState, useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from './useAppDispatch';
import {
  toggleVideo,
  toggleScreenShare,
} from '../stores/voiceSlice';
import { store } from '../stores/store';

interface MediaStreamsState {
  audioStream: MediaStream | null;
  videoStream: MediaStream | null;
  screenStream: MediaStream | null;
}

export interface ScreenShareConstraints {
  width: number;
  height: number;
  frameRate: number;
  audio?: boolean;
}

interface UseMediaStreamsReturn {
  audioRef: React.RefObject<HTMLVideoElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  screenRef: React.RefObject<HTMLVideoElement | null>;
  getAudioStream: () => MediaStream | null;
  getVideoStream: () => MediaStream | null;
  getScreenStream: () => MediaStream | null;
  /**
   * Start microphone capture. Resolves to `null` on success, or a clear,
   * user-facing reason string when it fails (e.g. an insecure context or a
   * denied permission) — callers can surface it without catching an opaque
   * throw.
   */
  startAudio: () => Promise<string | null>;
  switchInputDevice: (deviceId: string) => Promise<void>;
  stopAudio: () => void;
  setAudioEnabled: (enabled: boolean) => void;
  /** Start camera capture. See {@link startAudio} for the return contract. */
  startVideo: () => Promise<string | null>;
  stopVideo: () => void;
  startScreenShare: (constraints?: ScreenShareConstraints) => Promise<void>;
  stopScreenShare: () => void;
  stopAllStreams: () => void;
  /**
   * The most recent media-access failure reason (e.g. insecure context or
   * denied permission), or `null` when the last action succeeded. Components
   * can render this to explain why mic/camera did not turn on.
   */
  mediaError: string | null;
  /** Clear the current mediaError (e.g. after the user dismisses it). */
  clearMediaError: () => void;
}

/**
 * Singleton media streams state, shared across all hook instances.
 * We use a module-level singleton because MediaStreams are not serializable
 * and should not be stored in Redux. Multiple components may need access
 * to the same streams (e.g., VoiceChannelView and VoiceConnectedBar).
 */
const mediaState: MediaStreamsState = {
  audioStream: null,
  videoStream: null,
  screenStream: null,
};

/** Event target for notifying components when streams change */
const streamEvents = new EventTarget();
const STREAM_CHANGE_EVENT = 'streamchange';

function notifyStreamChange(): void {
  streamEvents.dispatchEvent(new Event(STREAM_CHANGE_EVENT));
}

function stopAllTracks(stream: MediaStream | null): void {
  if (stream) {
    stream.getTracks().forEach(track => {
      track.stop();
    });
  }
}

/**
 * Whether the current browser can capture the screen via getDisplayMedia.
 * Most mobile browsers do not implement it (iOS Safari has no
 * getDisplayMedia at all; Android Chrome support is limited/inconsistent),
 * and on insecure origins `navigator.mediaDevices` may be undefined.
 * Callers should gate the screen-share UI on this and degrade gracefully
 * where it returns false, instead of invoking a method that doesn't exist.
 */
export function isScreenShareSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

/**
 * Clear, user-facing reason shown when microphone/camera cannot be used
 * because the page is not a secure context. This is the single source of
 * truth for that message so the hook and the UI stay in sync.
 */
export const MEDIA_INSECURE_CONTEXT_REASON =
  'Microphone & camera need a secure (HTTPS) connection. Open Relay over HTTPS ' +
  '(e.g. https://<your-lan-ip>:5173) or on localhost, then try again.';

/**
 * Whether the browser can capture microphone/camera via getUserMedia.
 *
 * getUserMedia is only exposed in a *secure context* — HTTPS, or the special
 * cases http://localhost / http://127.0.0.1 that browsers treat as secure.
 * When the app is served over plain http://<lan-ip>:5173 (e.g. opening it on a
 * phone over the LAN), `window.isSecureContext` is false and
 * `navigator.mediaDevices` is typically undefined, so calling getUserMedia
 * would throw an opaque TypeError and no permission prompt ever appears.
 *
 * Callers should gate on this and surface MEDIA_INSECURE_CONTEXT_REASON
 * instead of silently failing.
 */
export function isMediaSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Best-effort detection of a touch-first / mobile device. Prefer
 * capability checks over this; it is only a hint for defaulting behavior
 * (e.g. front-camera preference) and never a hard gate.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hasTouch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0;
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  const uaLooksMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return hasTouch || uaLooksMobile;
}

/**
 * Returns true when the rejection reason is an OverconstrainedError, which
 * getUserMedia throws when the requested constraints cannot be satisfied
 * (common on mobile cameras that reject over-specified resolution/frameRate).
 */
function isOverconstrainedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { name?: unknown }).name === 'OverconstrainedError';
}

/**
 * Registry of audio elements that need output device (sink) applied.
 * Components rendering remote audio (e.g., voice consumers) register
 * their elements here so that switching output device affects them all.
 */
const audioElementRegistry = new Set<HTMLAudioElement>();

/**
 * Register an audio element so output device changes are applied to it.
 * Returns a cleanup function to unregister the element.
 */
export function registerAudioElement(element: HTMLAudioElement): () => void {
  audioElementRegistry.add(element);
  // Apply current output device immediately
  const settings = store.getState().settings;
  const deviceId = settings.outputDevice === 'default' ? '' : settings.outputDevice;
  setSinkIdOnElement(element, deviceId);
  return () => {
    audioElementRegistry.delete(element);
  };
}

/**
 * Sets the audio output device (sink) on an HTMLAudioElement.
 * Falls back silently if setSinkId is not supported by the browser.
 */
function setSinkIdOnElement(element: HTMLAudioElement, deviceId: string): void {
  if ('setSinkId' in element && typeof element.setSinkId === 'function') {
    (element.setSinkId as (sinkId: string) => Promise<void>)(deviceId).catch(() => {
      // setSinkId failed (e.g., device not available) -- ignore silently
    });
  }
}

/**
 * Apply output device to all registered audio elements.
 * Called when the user selects a new output device.
 */
export function applyOutputDeviceToAll(deviceId: string): void {
  const sinkId = deviceId === 'default' ? '' : deviceId;
  for (const element of audioElementRegistry) {
    setSinkIdOnElement(element, sinkId);
  }
}

/**
 * Requests temporary microphone access to force the browser to reveal
 * device labels in subsequent enumerateDevices() calls.
 * Returns true if permission was obtained, false otherwise.
 */
export async function ensureDevicePermissions(): Promise<boolean> {
  // Outside a secure context navigator.mediaDevices is undefined; bail out
  // cleanly rather than relying on a thrown TypeError.
  if (!isMediaSupported()) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
}

export function useMediaStreams(): UseMediaStreamsReturn {
  const dispatch = useAppDispatch();
  const { selfMute, connected } = useAppSelector(s => s.voice);

  const audioRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);

  // The most recent media-access failure reason, surfaced to the UI so an
  // insecure-context / permission problem is visible instead of silent.
  const [mediaError, setMediaError] = useState<string | null>(null);

  const clearMediaError = useCallback((): void => {
    setMediaError(null);
  }, []);

  const getAudioStream = useCallback((): MediaStream | null => {
    return mediaState.audioStream;
  }, []);

  const getVideoStream = useCallback((): MediaStream | null => {
    return mediaState.videoStream;
  }, []);

  const getScreenStream = useCallback((): MediaStream | null => {
    return mediaState.screenStream;
  }, []);

  const startAudio = useCallback(async (): Promise<string | null> => {
    if (mediaState.audioStream) {
      return null;
    }
    // getUserMedia is unavailable outside a secure context (e.g. http on a LAN
    // IP viewed from a phone). Surface a clear, actionable reason instead of
    // throwing an opaque TypeError from `navigator.mediaDevices` being undefined.
    if (!isMediaSupported()) {
      setMediaError(MEDIA_INSECURE_CONTEXT_REASON);
      return MEDIA_INSECURE_CONTEXT_REASON;
    }
    try {
      const settings = store.getState().settings;
      const deviceId = settings.inputDevice && settings.inputDevice !== 'default'
        ? { exact: settings.inputDevice }
        : undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ?? { ideal: 'default' },
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
      });
      mediaState.audioStream = stream;
      setMediaError(null);
      notifyStreamChange();
      return null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      // eslint-disable-next-line no-console
      console.error('Microphone access denied:', message);
      setMediaError(message);
      return message;
    }
  }, []);

  /**
   * Switch the active microphone to a different input device.
   * If audio is currently streaming, stops the old stream and starts
   * a new one with the requested device. If not streaming, does nothing
   * (the new device will be picked up on the next startAudio call).
   */
  const switchInputDevice = useCallback(async (newDeviceId: string): Promise<void> => {
    if (!mediaState.audioStream) {
      // Not currently capturing -- the new device ID is already saved in Redux
      // and will be used on the next startAudio() call.
      return;
    }
    if (!isMediaSupported()) {
      setMediaError(MEDIA_INSECURE_CONTEXT_REASON);
      return;
    }
    try {
      const settings = store.getState().settings;
      const deviceConstraint = newDeviceId && newDeviceId !== 'default'
        ? { exact: newDeviceId }
        : undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceConstraint ?? { ideal: 'default' },
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
      });
      // Preserve mute state: if user was muted, disable new tracks too
      const currentMute = store.getState().voice.selfMute;
      stream.getAudioTracks().forEach(track => {
        track.enabled = !currentMute;
      });
      // Stop old stream
      stopAllTracks(mediaState.audioStream);
      mediaState.audioStream = stream;
      notifyStreamChange();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to switch microphone';
      // eslint-disable-next-line no-console
      console.error('Microphone switch failed:', message);
    }
  }, []);

  const stopAudio = useCallback((): void => {
    stopAllTracks(mediaState.audioStream);
    mediaState.audioStream = null;
    notifyStreamChange();
  }, []);

  const setAudioEnabled = useCallback((enabled: boolean): void => {
    if (mediaState.audioStream) {
      mediaState.audioStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }, []);

  const startVideo = useCallback(async (): Promise<string | null> => {
    if (mediaState.videoStream) {
      return null;
    }
    // Camera capture also requires a secure context. Fail loud-but-clean and
    // revert the optimistic video toggle the caller applied before invoking us.
    if (!isMediaSupported()) {
      setMediaError(MEDIA_INSECURE_CONTEXT_REASON);
      dispatch(toggleVideo());
      return MEDIA_INSECURE_CONTEXT_REASON;
    }
    const settings = store.getState().settings;
    const hasSelectedDevice = Boolean(settings.videoDevice && settings.videoDevice !== 'default');

    // Keep resolution/frameRate as `ideal` (never `exact`) so weaker mobile
    // cameras downscale gracefully instead of rejecting the request.
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    };
    if (hasSelectedDevice) {
      // Desktop: honor the explicitly selected camera at high resolution.
      videoConstraints.deviceId = { exact: settings.videoDevice };
    } else {
      // No specific camera chosen: prefer the front camera. This is an
      // `ideal` preference (not `exact`), so desktop cameras that ignore
      // facingMode are unaffected, while mobile defaults to the selfie cam.
      videoConstraints.facingMode = 'user';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      mediaState.videoStream = stream;
      setMediaError(null);
      notifyStreamChange();
      return null;
    } catch (err: unknown) {
      // Mobile cameras frequently reject over-specified constraints. On an
      // OverconstrainedError, retry once with the most permissive request so
      // the camera still opens rather than failing outright.
      if (isOverconstrainedError(err)) {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
          mediaState.videoStream = fallbackStream;
          setMediaError(null);
          notifyStreamChange();
          return null;
        } catch (fallbackErr: unknown) {
          const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : 'Failed to access camera';
          // eslint-disable-next-line no-console
          console.error('Camera access denied (after fallback):', fallbackMessage);
          // Revert the Redux state since even the fallback failed
          dispatch(toggleVideo());
          setMediaError(fallbackMessage);
          return fallbackMessage;
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to access camera';
      // eslint-disable-next-line no-console
      console.error('Camera access denied:', message);
      // Revert the Redux state since we failed to get the stream
      dispatch(toggleVideo());
      setMediaError(message);
      return message;
    }
  }, [dispatch]);

  const stopVideo = useCallback((): void => {
    stopAllTracks(mediaState.videoStream);
    mediaState.videoStream = null;
    notifyStreamChange();
  }, []);

  const startScreenShare = useCallback(async (constraints?: ScreenShareConstraints): Promise<void> => {
    if (mediaState.screenStream) {
      return;
    }
    // Screen capture (getDisplayMedia) is unsupported on most mobile
    // browsers (e.g. iOS Safari). Degrade gracefully instead of throwing an
    // unhandled TypeError; the UI gates on isScreenShareSupported() so this
    // is a defensive backstop for any direct callers.
    if (!isScreenShareSupported()) {
      // eslint-disable-next-line no-console
      console.warn('Screen sharing is not supported on this device or browser');
      // Distinguish "insecure context" (fixable by switching to HTTPS) from a
      // browser that simply lacks getDisplayMedia (e.g. iOS Safari).
      setMediaError(
        isMediaSupported()
          ? 'Screen sharing is not supported on this device or browser.'
          : MEDIA_INSECURE_CONTEXT_REASON,
      );
      // Undo any optimistic screen-share state a caller may have set.
      if (store.getState().voice.selfScreenShare) {
        dispatch(toggleScreenShare());
      }
      return;
    }
    try {
      const videoConstraints: MediaTrackConstraints & { cursor?: string } = constraints
        ? {
            width: { ideal: constraints.width },
            height: { ideal: constraints.height },
            frameRate: { ideal: constraints.frameRate },
          }
        : true as unknown as MediaTrackConstraints;
      const shareAudio = constraints?.audio ?? true;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: shareAudio,
      });

      // Listen for the browser's native "stop sharing" event
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          mediaState.screenStream = null;
          notifyStreamChange();
          dispatch(toggleScreenShare());
        });
      });

      mediaState.screenStream = stream;
      setMediaError(null);
      notifyStreamChange();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to share screen';
      // eslint-disable-next-line no-console
      console.error('Screen share denied:', message);
      setMediaError(message);
      // Revert the Redux state since we failed to get the stream
      dispatch(toggleScreenShare());
    }
  }, [dispatch]);

  const stopScreenShare = useCallback((): void => {
    stopAllTracks(mediaState.screenStream);
    mediaState.screenStream = null;
    notifyStreamChange();
  }, []);

  const stopAllStreams = useCallback((): void => {
    stopAllTracks(mediaState.audioStream);
    stopAllTracks(mediaState.videoStream);
    stopAllTracks(mediaState.screenStream);
    mediaState.audioStream = null;
    mediaState.videoStream = null;
    mediaState.screenStream = null;
    notifyStreamChange();
  }, []);

  // When mute state changes, toggle audio track enabled
  useEffect(() => {
    if (mediaState.audioStream) {
      setAudioEnabled(!selfMute);
    }
  }, [selfMute, setAudioEnabled]);

  // Clean up all streams on disconnect
  useEffect(() => {
    if (!connected) {
      stopAllStreams();
    }
  }, [connected, stopAllStreams]);

  return {
    audioRef,
    videoRef,
    screenRef,
    getAudioStream,
    getVideoStream,
    getScreenStream,
    startAudio,
    switchInputDevice,
    stopAudio,
    setAudioEnabled,
    startVideo,
    stopVideo,
    startScreenShare,
    stopScreenShare,
    stopAllStreams,
    mediaError,
    clearMediaError,
  };
}

/**
 * Hook to subscribe to stream change events so components re-render
 * when streams are started or stopped.
 */
export function useStreamChangeListener(callback: () => void): void {
  useEffect(() => {
    streamEvents.addEventListener(STREAM_CHANGE_EVENT, callback);
    return () => {
      streamEvents.removeEventListener(STREAM_CHANGE_EVENT, callback);
    };
  }, [callback]);
}

/** Get current media state for reading outside of React */
export function getMediaState(): Readonly<MediaStreamsState> {
  return mediaState;
}

/**
 * Subscribe to local media start/stop changes from outside React (e.g. the
 * voiceManager, which produces/stops SFU tracks as capture changes). Returns an
 * unsubscribe function.
 */
export function subscribeMediaChange(cb: () => void): () => void {
  streamEvents.addEventListener(STREAM_CHANGE_EVENT, cb);
  return () => streamEvents.removeEventListener(STREAM_CHANGE_EVENT, cb);
}
