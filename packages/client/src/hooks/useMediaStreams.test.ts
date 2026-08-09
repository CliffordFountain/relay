import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { createElement } from 'react';
import {
  useMediaStreams,
  isScreenShareSupported,
  isMediaSupported,
  ensureDevicePermissions,
  getMediaState,
  MEDIA_INSECURE_CONTEXT_REASON,
} from './useMediaStreams';
import { voiceSlice } from '../stores/voiceSlice';
import { settingsSlice } from '../stores/settingsSlice';
import { store as singletonStore } from '../stores/store';

/**
 * Minimal fake MediaStream. The success paths of the hook only stash the
 * stream and (for screen share) attach an 'ended' listener to video tracks,
 * so empty track lists are sufficient here.
 */
function makeFakeStream(): MediaStream {
  return {
    getTracks: () => [],
    getVideoTracks: () => [],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

/** Mirrors the shape of a getUserMedia OverconstrainedError rejection. */
class FakeOverconstrainedError extends Error {
  constraint: string;
  constructor(constraint = 'width') {
    super('Requested constraints could not be satisfied');
    this.name = 'OverconstrainedError';
    this.constraint = constraint;
  }
}

interface FakeMediaDevices {
  getUserMedia?: ReturnType<typeof vi.fn>;
  getDisplayMedia?: ReturnType<typeof vi.fn>;
}

function setMediaDevices(devices: FakeMediaDevices | undefined): void {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: devices,
  });
}

/**
 * Simulate whether the page is a secure context. getUserMedia is only exposed
 * in a secure context (HTTPS or localhost); a phone on http://<lan-ip>:5173 is
 * not. window === globalThis under the jsdom test environment, so stubbing the
 * global is what isMediaSupported()'s `window.isSecureContext` check reads.
 */
function setSecureContext(secure: boolean): void {
  vi.stubGlobal('isSecureContext', secure);
}

function createTestStore() {
  // Only the voice slice is needed: useAppSelector(s => s.voice) reads
  // selfMute/connected from here, while the hook's direct store.getState()
  // calls target the real singleton store (settings, voice.selfScreenShare).
  return configureStore({
    reducer: { voice: voiceSlice.reducer },
  });
}

describe('useMediaStreams', () => {
  let testStore: ReturnType<typeof createTestStore>;

  function wrapper({ children }: { children: React.ReactNode }) {
    return createElement(Provider, { store: testStore }, children);
  }

  function renderMediaStreams() {
    return renderHook(() => useMediaStreams(), { wrapper });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    testStore = createTestStore();
    // The default for these tests is the working case: a secure context
    // (HTTPS / localhost) where getUserMedia is available. Insecure-context
    // tests opt out explicitly via setSecureContext(false).
    setSecureContext(true);
    // Ensure no camera device is selected by default (mobile / fresh state).
    singletonStore.dispatch(settingsSlice.actions.setVideoDevice('default'));
    // Reset the module-level singleton media state between tests.
    const { result, unmount } = renderMediaStreams();
    act(() => result.current.stopAllStreams());
    unmount();
  });

  afterEach(() => {
    singletonStore.dispatch(settingsSlice.actions.setVideoDevice('default'));
  });

  describe('isScreenShareSupported', () => {
    it('returns true when getDisplayMedia is a function', () => {
      setMediaDevices({ getUserMedia: vi.fn(), getDisplayMedia: vi.fn() });
      expect(isScreenShareSupported()).toBe(true);
    });

    it('returns false when getDisplayMedia is missing (mobile)', () => {
      setMediaDevices({ getUserMedia: vi.fn() });
      expect(isScreenShareSupported()).toBe(false);
    });

    it('returns false when mediaDevices is undefined', () => {
      setMediaDevices(undefined);
      expect(isScreenShareSupported()).toBe(false);
    });
  });

  describe('startScreenShare (screen share unsupported)', () => {
    it('degrades gracefully without throwing when getDisplayMedia is undefined', async () => {
      const getUserMedia = vi.fn().mockResolvedValue(makeFakeStream());
      // No getDisplayMedia -> mobile browser without screen capture.
      setMediaDevices({ getUserMedia });

      const { result } = renderMediaStreams();

      await act(async () => {
        // Must not throw an unhandled error.
        await result.current.startScreenShare({ width: 1920, height: 1080, frameRate: 30 });
      });

      // No screen stream was acquired, and getUserMedia was never misused.
      expect(getMediaState().screenStream).toBeNull();
      expect(getUserMedia).not.toHaveBeenCalled();
    });
  });

  describe('startVideo (webcam)', () => {
    it('defaults to facingMode "user" when no device is selected', async () => {
      const getUserMedia = vi.fn().mockResolvedValue(makeFakeStream());
      setMediaDevices({ getUserMedia, getDisplayMedia: vi.fn() });

      const { result } = renderMediaStreams();
      await act(async () => {
        await result.current.startVideo();
      });

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      const constraints = getUserMedia.mock.calls[0]?.[0] as { video: MediaTrackConstraints };
      expect(constraints.video.facingMode).toBe('user');
      // Should not pin a deviceId when none is selected.
      expect(constraints.video.deviceId).toBeUndefined();
      // Resolution stays an `ideal` so weaker cameras downscale gracefully.
      expect(constraints.video.width).toEqual({ ideal: 1920 });
      expect(getMediaState().videoStream).not.toBeNull();
    });

    it('falls back to minimal constraints on OverconstrainedError and succeeds', async () => {
      const getUserMedia = vi
        .fn()
        .mockRejectedValueOnce(new FakeOverconstrainedError())
        .mockResolvedValueOnce(makeFakeStream());
      setMediaDevices({ getUserMedia, getDisplayMedia: vi.fn() });

      const { result } = renderMediaStreams();
      await act(async () => {
        await result.current.startVideo();
      });

      expect(getUserMedia).toHaveBeenCalledTimes(2);
      // Second attempt is the most permissive request.
      expect(getUserMedia.mock.calls[1]?.[0]).toEqual({ video: true });
      // The camera still opened despite the initial over-constraint.
      expect(getMediaState().videoStream).not.toBeNull();
    });

    it('does not retry on a non-overconstrained error (e.g. permission denied)', async () => {
      const permissionError = new Error('Permission denied');
      permissionError.name = 'NotAllowedError';
      const getUserMedia = vi.fn().mockRejectedValue(permissionError);
      setMediaDevices({ getUserMedia, getDisplayMedia: vi.fn() });

      const { result } = renderMediaStreams();
      await act(async () => {
        await result.current.startVideo();
      });

      // Only one attempt; no minimal-constraints fallback for permission errors.
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(getMediaState().videoStream).toBeNull();
    });

    it('honors the selected camera at high resolution on desktop (no regression)', async () => {
      singletonStore.dispatch(settingsSlice.actions.setVideoDevice('cam-123'));
      const getUserMedia = vi.fn().mockResolvedValue(makeFakeStream());
      setMediaDevices({ getUserMedia, getDisplayMedia: vi.fn() });

      const { result } = renderMediaStreams();
      await act(async () => {
        await result.current.startVideo();
      });

      const constraints = getUserMedia.mock.calls[0]?.[0] as { video: MediaTrackConstraints };
      expect(constraints.video.deviceId).toEqual({ exact: 'cam-123' });
      // When a specific device is chosen, we do not override with facingMode.
      expect(constraints.video.facingMode).toBeUndefined();
      expect(constraints.video.width).toEqual({ ideal: 1920 });
    });
  });

  describe('isMediaSupported', () => {
    it('returns true in a secure context with getUserMedia available', () => {
      setSecureContext(true);
      setMediaDevices({ getUserMedia: vi.fn() });
      expect(isMediaSupported()).toBe(true);
    });

    it('returns false in an insecure context (http on a LAN IP)', () => {
      // Real browsers drop navigator.mediaDevices entirely on insecure origins.
      setSecureContext(false);
      setMediaDevices(undefined);
      expect(isMediaSupported()).toBe(false);
    });

    it('returns false when secure but getUserMedia is unavailable', () => {
      setSecureContext(true);
      setMediaDevices({});
      expect(isMediaSupported()).toBe(false);
    });
  });

  describe('media actions in an insecure context (no HTTPS)', () => {
    beforeEach(() => {
      // Mirror a phone on http://<lan-ip>:5173: not secure, and the browser
      // has stripped navigator.mediaDevices.
      setSecureContext(false);
      setMediaDevices(undefined);
    });

    it('startAudio returns the HTTPS reason and never touches getUserMedia', async () => {
      const { result } = renderMediaStreams();

      let reason: string | null = null;
      await act(async () => {
        // Must not throw an opaque TypeError from mediaDevices being undefined.
        reason = await result.current.startAudio();
      });

      expect(reason).toBe(MEDIA_INSECURE_CONTEXT_REASON);
      expect(reason).toMatch(/secure \(HTTPS\)/i);
      // The reason is also exposed as state for the UI to render.
      expect(result.current.mediaError).toBe(MEDIA_INSECURE_CONTEXT_REASON);
      expect(getMediaState().audioStream).toBeNull();
    });

    it('startVideo returns the HTTPS reason and does not acquire a stream', async () => {
      const { result } = renderMediaStreams();

      let reason: string | null = null;
      await act(async () => {
        reason = await result.current.startVideo();
      });

      expect(reason).toBe(MEDIA_INSECURE_CONTEXT_REASON);
      expect(result.current.mediaError).toBe(MEDIA_INSECURE_CONTEXT_REASON);
      expect(getMediaState().videoStream).toBeNull();
    });

    it('ensureDevicePermissions resolves false without throwing', async () => {
      await expect(ensureDevicePermissions()).resolves.toBe(false);
    });

    it('clearMediaError resets the surfaced reason', async () => {
      const { result } = renderMediaStreams();

      await act(async () => {
        await result.current.startAudio();
      });
      expect(result.current.mediaError).toBe(MEDIA_INSECURE_CONTEXT_REASON);

      act(() => result.current.clearMediaError());
      expect(result.current.mediaError).toBeNull();
    });
  });

  describe('media actions in a secure context (happy path)', () => {
    it('startAudio resolves to null and acquires the stream', async () => {
      setSecureContext(true);
      const getUserMedia = vi.fn().mockResolvedValue(makeFakeStream());
      setMediaDevices({ getUserMedia, getDisplayMedia: vi.fn() });

      const { result } = renderMediaStreams();
      let reason: string | null = 'unset';
      await act(async () => {
        reason = await result.current.startAudio();
      });

      expect(reason).toBeNull();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(getMediaState().audioStream).not.toBeNull();
      expect(result.current.mediaError).toBeNull();
    });
  });
});
