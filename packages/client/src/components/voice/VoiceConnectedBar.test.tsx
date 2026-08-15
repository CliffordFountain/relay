import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { VoiceConnectedBar } from './VoiceConnectedBar';
import { voiceSlice } from '../../stores/voiceSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';
import { settingsSlice } from '../../stores/settingsSlice';

vi.mock('../../hooks/useMediaStreams', () => ({
  useMediaStreams: () => ({
    startScreenShare: vi.fn().mockResolvedValue(undefined),
    stopScreenShare: vi.fn(),
    stopAllStreams: vi.fn(),
    startAudio: vi.fn().mockResolvedValue(undefined),
    stopAudio: vi.fn(),
    setAudioEnabled: vi.fn(),
    startVideo: vi.fn().mockResolvedValue(undefined),
    stopVideo: vi.fn(),
    audioRef: { current: null },
    videoRef: { current: null },
    screenRef: { current: null },
    getAudioStream: () => null,
    getVideoStream: () => null,
    getScreenStream: () => null,
    switchInputDevice: vi.fn().mockResolvedValue(undefined),
  }),
  useStreamChangeListener: vi.fn(),
  getMediaState: () => ({
    audioStream: null,
    videoStream: null,
    screenStream: null,
  }),
}));

vi.mock('../../hooks/useVoiceActivityDetection', () => ({
  useVoiceActivityDetection: vi.fn(),
}));

vi.mock('../../hooks/usePushToTalk', () => ({
  usePushToTalk: vi.fn(),
}));

vi.mock('../../api/gateway', () => ({
  gateway: {
    sendVoiceStateUpdate: vi.fn(),
  },
}));

vi.mock('../../utils/sounds', () => ({
  playLeaveSound: vi.fn(),
  playScreenShareStopSound: vi.fn(),
}));

function createTestStore(overrides?: {
  connected?: boolean;
  selfScreenShare?: boolean;
}) {
  return configureStore({
    reducer: {
      voice: voiceSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
      settings: settingsSlice.reducer,
    },
    preloadedState: {
      voice: {
        channelId: '100',
        guildId: '1',
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: overrides?.selfScreenShare ?? false,
        connected: overrides?.connected ?? true,
        isSpeaking: false,
        speakingUsers: [],
        voiceUsersByChannel: {},
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
      },
      channels: {
        channels: {
          '100': {
            id: '100',
            guild_id: '1',
            type: 2,
            name: 'General Voice',
            topic: null,
            position: 0,
            parent_id: null,
          },
        },
        selectedChannelId: '100',
      },
      auth: {
        token: 'test-token',
        user: { id: '50', username: 'TestUser', email: 'test@test.com', avatar: null },
        isAuthenticated: true, status: 'online' as const, customStatus: null,
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
        inputMode: 'voiceActivity' as const,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceSensitivity: 25,
        videoDevice: 'default',
        keybinds: [
          { action: 'Toggle Mute', key: 'Ctrl+Shift+M' },
          { action: 'Push to Talk', key: '' },
        ],
      },
    },
  });
}

describe('VoiceConnectedBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not connected', () => {
    const store = createTestStore({ connected: false });
    const { container } = render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the voice connected bar when connected', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(screen.getByLabelText('Voice Connected')).toBeInTheDocument();
  });

  it('displays Voice Connected status text', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(screen.getByText('Voice Connected')).toBeInTheDocument();
  });

  it('displays the channel name', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(screen.getByText('General Voice')).toBeInTheDocument();
  });

  it('renders screen share button', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(screen.getByLabelText('Share Your Screen')).toBeInTheDocument();
  });

  it('renders disconnect button', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(screen.getByLabelText('Disconnect')).toBeInTheDocument();
  });

  it('disconnects when disconnect button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Disconnect'));
    expect(store.getState().voice.connected).toBe(false);
  });

  it('shows LIVE indicator when screen sharing', () => {
    const store = createTestStore({ selfScreenShare: true });
    render(
      <Provider store={store}>
        <VoiceConnectedBar />
      </Provider>,
    );
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });
});
