import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { ReactNode } from 'react';
import { usePushToTalk } from './usePushToTalk';
import { settingsSlice } from '../stores/settingsSlice';
import { voiceSlice } from '../stores/voiceSlice';
import { authSlice } from '../stores/authSlice';

// Mock getMediaState to return a controllable audio stream
const mockAudioTracks = [{ enabled: true }];
const mockAudioStream = {
  getAudioTracks: () => mockAudioTracks,
};

vi.mock('./useMediaStreams', () => ({
  getMediaState: () => ({
    audioStream: mockAudioStream,
    videoStream: null,
    screenStream: null,
  }),
  useMediaStreams: () => ({
    startAudio: vi.fn(),
    stopAudio: vi.fn(),
    setAudioEnabled: vi.fn(),
    startVideo: vi.fn(),
    stopVideo: vi.fn(),
    startScreenShare: vi.fn(),
    stopScreenShare: vi.fn(),
    stopAllStreams: vi.fn(),
    audioRef: { current: null },
    videoRef: { current: null },
    screenRef: { current: null },
    getAudioStream: () => null,
    getVideoStream: () => null,
    getScreenStream: () => null,
    switchInputDevice: vi.fn(),
  }),
  useStreamChangeListener: vi.fn(),
  registerAudioElement: vi.fn(() => vi.fn()),
  applyOutputDeviceToAll: vi.fn(),
  ensureDevicePermissions: vi.fn(),
}));

// Need to also mock store module since usePushToTalk imports it
vi.mock('../stores/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    store: {
      getState: () => ({
        settings: {
          keybinds: [
            { action: 'Toggle Mute', key: 'Ctrl+Shift+M' },
            { action: 'Push to Talk', key: 'V' },
          ],
          inputMode: 'pushToTalk',
        },
      }),
      dispatch: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      replaceReducer: vi.fn(),
      [Symbol.observable]: vi.fn(),
    },
  };
});

function createTestStore(overrides?: {
  inputMode?: 'voiceActivity' | 'pushToTalk';
  connected?: boolean;
}) {
  return configureStore({
    reducer: {
      settings: settingsSlice.reducer,
      voice: voiceSlice.reducer,
      auth: authSlice.reducer,
    },
    preloadedState: {
      settings: {
        theme: 'dark' as const,
        fontSize: 16,
        messageDisplayMode: 'cozy' as const,
        enableDesktopNotifications: true,
        enableSounds: true,
        enableMessageNotifications: true,
        enableFriendRequestNotifications: true,
        enableServerNotifications: true,
        inputDevice: 'default',
        outputDevice: 'default',
        inputVolume: 100,
        outputVolume: 100,
        inputMode: overrides?.inputMode ?? 'pushToTalk',
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceSensitivity: 25,
        videoDevice: 'default',
        keybinds: [
          { action: 'Toggle Mute', key: 'Ctrl+Shift+M' },
          { action: 'Push to Talk', key: 'V' },
        ],
      },
      voice: {
        connected: overrides?.connected ?? true,
        channelId: '123',
        guildId: '456',
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: false,
        voiceUsersByChannel: {},
        speakingUsers: [],
        isSpeaking: false,
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
      },
      auth: {
        token: 'test-token',
        user: {
          id: 'user-1',
          username: 'testuser',
          displayName: 'Test User',
          email: 'test@test.com',
          avatar: null,
          banner: null,
          bannerColor: null,
          accentColor: null,
          bio: null,
          pronouns: null,
          phone: null,
          mfaEnabled: false,
          verified: true,
          flags: 0,
          premiumType: 0 as const,
          locale: 'en-US',
        },
        isAuthenticated: true, status: 'online' as const, customStatus: null,
        isLoading: false,
        mfaRequired: false,
        mfaTicket: null,
        error: null,
      },
    },
  });
}

function createWrapper(store: ReturnType<typeof createTestStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe('usePushToTalk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAudioTracks[0].enabled = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when inputMode is voiceActivity', () => {
    const store = createTestStore({ inputMode: 'voiceActivity' });
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    // Simulate key press -- should not change audio track state
    const origEnabled = mockAudioTracks[0].enabled;
    fireEvent('keydown', window, { key: 'V' });
    expect(mockAudioTracks[0].enabled).toBe(origEnabled);
  });

  it('does nothing when not connected to voice', () => {
    const store = createTestStore({ connected: false });
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    // Key press should have no effect
    const origEnabled = mockAudioTracks[0].enabled;
    fireEvent('keydown', window, { key: 'V' });
    expect(mockAudioTracks[0].enabled).toBe(origEnabled);
  });

  it('mutes audio track initially in PTT mode', () => {
    const store = createTestStore();
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    // Audio should start muted in PTT mode
    expect(mockAudioTracks[0].enabled).toBe(false);
  });

  it('enables audio track on key down and disables on key up after delay', () => {
    const store = createTestStore();
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    // Audio starts muted
    expect(mockAudioTracks[0].enabled).toBe(false);

    // Press PTT key
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V' }));
    });
    expect(mockAudioTracks[0].enabled).toBe(true);

    // Release PTT key
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'V' }));
    });

    // Should still be enabled during release delay
    expect(mockAudioTracks[0].enabled).toBe(true);

    // Advance past release delay
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(mockAudioTracks[0].enabled).toBe(false);
  });

  it('dispatches speaking state on key down and clears on key up', () => {
    const store = createTestStore();
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V' }));
    });

    // Check that speaking state was dispatched
    const state = store.getState();
    expect(state.voice.speakingUsers).toContain('user-1');
    expect(state.voice.isSpeaking).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'V' }));
    });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const stateAfter = store.getState();
    expect(stateAfter.voice.speakingUsers).not.toContain('user-1');
    expect(stateAfter.voice.isSpeaking).toBe(false);
  });

  it('ignores key repeat events', () => {
    const store = createTestStore();
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    // First press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V' }));
    });
    expect(mockAudioTracks[0].enabled).toBe(true);

    // Repeat press (held key) - should not cause issues
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', repeat: true }));
    });
    expect(mockAudioTracks[0].enabled).toBe(true);
  });

  it('ignores non-PTT keys', () => {
    const store = createTestStore();
    renderHook(() => usePushToTalk(), { wrapper: createWrapper(store) });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    });
    // Audio should stay muted since 'A' is not the PTT key
    expect(mockAudioTracks[0].enabled).toBe(false);
  });
});

function fireEvent(type: string, target: EventTarget, init?: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent(type, init));
}
