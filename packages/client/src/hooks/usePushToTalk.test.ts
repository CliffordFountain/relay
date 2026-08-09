import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { createElement } from 'react';
import { usePushToTalk } from './usePushToTalk';
import { voiceSlice } from '../stores/voiceSlice';
import { authSlice } from '../stores/authSlice';
import { settingsSlice } from '../stores/settingsSlice';

// Mock getMediaState to return controllable stream
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
}));

// Mock the store module to return our test store
let testStore: ReturnType<typeof createTestStore>;

vi.mock('../stores/store', () => ({
  get store() {
    return testStore;
  },
}));

function createTestStore(overrides?: {
  inputMode?: 'voiceActivity' | 'pushToTalk';
  pttKey?: string;
  connected?: boolean;
}) {
  return configureStore({
    reducer: {
      voice: voiceSlice.reducer,
      auth: authSlice.reducer,
      settings: settingsSlice.reducer,
    },
    preloadedState: {
      voice: {
        channelId: overrides?.connected !== false ? '100' : null,
        guildId: overrides?.connected !== false ? '1' : null,
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: false,
        connected: overrides?.connected ?? true,
        isSpeaking: false,
        speakingUsers: [],
        voiceUsersByChannel: {},
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
      },
      auth: {
        token: 'test-token',
        user: { id: '50', username: 'TestUser', email: 'test@test.com', avatar: null },
        isAuthenticated: true,
      },
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
          { action: 'Push to Talk', key: overrides?.pttKey ?? 'V' },
        ],
      },
    },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(Provider, { store: testStore }, children);
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
    testStore = createTestStore({ inputMode: 'voiceActivity' });
    renderHook(() => usePushToTalk(), { wrapper });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });

    // Speaking state should NOT change
    expect(testStore.getState().voice.isSpeaking).toBe(false);
  });

  it('does nothing when not connected to voice', () => {
    testStore = createTestStore({ connected: false });
    renderHook(() => usePushToTalk(), { wrapper });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });

    expect(testStore.getState().voice.isSpeaking).toBe(false);
  });

  it('enables audio track on PTT key down', () => {
    testStore = createTestStore({ pttKey: 'V' });
    mockAudioTracks[0].enabled = false;
    renderHook(() => usePushToTalk(), { wrapper });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });

    expect(mockAudioTracks[0].enabled).toBe(true);
    expect(testStore.getState().voice.isSpeaking).toBe(true);
  });

  it('disables audio track after key up with release delay', () => {
    testStore = createTestStore({ pttKey: 'V' });
    mockAudioTracks[0].enabled = false;
    renderHook(() => usePushToTalk(200), { wrapper });

    // Key down
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(mockAudioTracks[0].enabled).toBe(true);

    // Key up
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'v' }));
    });

    // Still speaking during release delay
    expect(testStore.getState().voice.isSpeaking).toBe(true);

    // After delay
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockAudioTracks[0].enabled).toBe(false);
    expect(testStore.getState().voice.isSpeaking).toBe(false);
  });

  it('ignores key repeat events', () => {
    testStore = createTestStore({ pttKey: 'V' });
    mockAudioTracks[0].enabled = false;
    renderHook(() => usePushToTalk(), { wrapper });

    // First press
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(mockAudioTracks[0].enabled).toBe(true);

    // Repeat press should not cause issues
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', repeat: true }));
    });
    expect(mockAudioTracks[0].enabled).toBe(true);
  });

  it('ignores non-PTT keys', () => {
    testStore = createTestStore({ pttKey: 'V' });
    mockAudioTracks[0].enabled = false;
    renderHook(() => usePushToTalk(), { wrapper });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    // Should still be muted since 'A' is not the PTT key
    expect(mockAudioTracks[0].enabled).toBe(false);
    expect(testStore.getState().voice.isSpeaking).toBe(false);
  });

  it('does not activate when empty PTT keybind', () => {
    testStore = createTestStore({ pttKey: '' });
    mockAudioTracks[0].enabled = false;
    renderHook(() => usePushToTalk(), { wrapper });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });

    expect(testStore.getState().voice.isSpeaking).toBe(false);
  });

  it('mutes audio track initially in PTT mode', () => {
    testStore = createTestStore({ pttKey: 'V' });
    mockAudioTracks[0].enabled = true;
    renderHook(() => usePushToTalk(), { wrapper });

    // After mounting, audio should be muted in PTT mode
    expect(mockAudioTracks[0].enabled).toBe(false);
  });

  it('skips activation when focused on a text input', () => {
    testStore = createTestStore({ pttKey: 'V' });
    mockAudioTracks[0].enabled = false;
    renderHook(() => usePushToTalk(), { wrapper });

    // Simulate keydown from an input element
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'v', bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      window.dispatchEvent(event);
    });

    // PTT should NOT activate since we're focused on an input
    expect(testStore.getState().voice.isSpeaking).toBe(false);

    document.body.removeChild(input);
  });
});
