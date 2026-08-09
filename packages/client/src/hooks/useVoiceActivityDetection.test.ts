import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { createElement } from 'react';
import { useVoiceActivityDetection } from './useVoiceActivityDetection';
import { voiceSlice } from '../stores/voiceSlice';
import { authSlice } from '../stores/authSlice';
import { settingsSlice } from '../stores/settingsSlice';

// Mock AudioContext and AnalyserNode
const mockGetByteFrequencyData = vi.fn();
const mockAnalyserNode = {
  fftSize: 256,
  smoothingTimeConstant: 0.5,
  frequencyBinCount: 128,
  getByteFrequencyData: mockGetByteFrequencyData,
};

const mockAudioContext = {
  createAnalyser: vi.fn(() => mockAnalyserNode),
  createMediaStreamSource: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));

// Mock getMediaState
let mockHasAudioStream = false;
vi.mock('./useMediaStreams', () => ({
  getMediaState: () => ({
    audioStream: mockHasAudioStream ? { id: 'mock-stream' } : null,
    videoStream: null,
    screenStream: null,
  }),
}));

function createTestStore(overrides?: {
  connected?: boolean;
  selfMute?: boolean;
  inputMode?: 'voiceActivity' | 'pushToTalk';
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
        selfMute: overrides?.selfMute ?? false,
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
        inputMode: overrides?.inputMode ?? 'voiceActivity',
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceSensitivity: 25,
        videoDevice: 'default',
        keybinds: [],
      },
    },
  });
}

describe('useVoiceActivityDetection', () => {
  let testStore: ReturnType<typeof createTestStore>;

  function wrapper({ children }: { children: React.ReactNode }) {
    return createElement(Provider, { store: testStore }, children);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockHasAudioStream = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not set up analyser when not connected', () => {
    testStore = createTestStore({ connected: false });
    renderHook(() => useVoiceActivityDetection(), { wrapper });

    // Should not have created an AudioContext
    expect(mockAudioContext.createAnalyser).not.toHaveBeenCalled();
  });

  it('does not set up analyser when muted', () => {
    testStore = createTestStore({ selfMute: true });
    renderHook(() => useVoiceActivityDetection(), { wrapper });

    // Should not have created an AudioContext
    expect(mockAudioContext.createAnalyser).not.toHaveBeenCalled();
  });

  it('does not set up analyser when in pushToTalk mode', () => {
    testStore = createTestStore({ inputMode: 'pushToTalk' });
    renderHook(() => useVoiceActivityDetection(), { wrapper });

    // Should not have created an AudioContext
    expect(mockAudioContext.createAnalyser).not.toHaveBeenCalled();
  });

  it('starts polling when connected in voiceActivity mode', () => {
    testStore = createTestStore();
    mockHasAudioStream = true;

    renderHook(() => useVoiceActivityDetection(), { wrapper });

    // Advance timers past the poll interval (50ms)
    vi.advanceTimersByTime(100);

    // The analyser should have been created since we have an audio stream
    expect(mockAudioContext.createAnalyser).toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    testStore = createTestStore();
    mockHasAudioStream = true;

    const { unmount } = renderHook(() => useVoiceActivityDetection(), { wrapper });

    vi.advanceTimersByTime(100);
    unmount();

    // AudioContext.close should have been called
    expect(mockAudioContext.close).toHaveBeenCalled();
  });

  it('detects speaking when audio level exceeds sensitivity threshold', () => {
    testStore = createTestStore();
    mockHasAudioStream = true;

    // Make getByteFrequencyData return high values (above sensitivity of 25)
    mockGetByteFrequencyData.mockImplementation((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = 100; // Above threshold of 25
      }
    });

    renderHook(() => useVoiceActivityDetection(), { wrapper });

    // Advance past poll interval
    vi.advanceTimersByTime(100);

    expect(testStore.getState().voice.isSpeaking).toBe(true);
  });

  it('detects silence when audio level is below sensitivity threshold', () => {
    testStore = createTestStore();
    mockHasAudioStream = true;

    // Low audio levels
    mockGetByteFrequencyData.mockImplementation((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = 5; // Below threshold of 25
      }
    });

    renderHook(() => useVoiceActivityDetection(), { wrapper });

    vi.advanceTimersByTime(100);

    expect(testStore.getState().voice.isSpeaking).toBe(false);
  });
});
