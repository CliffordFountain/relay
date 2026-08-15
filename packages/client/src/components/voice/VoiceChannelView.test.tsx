import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { VoiceChannelView } from './VoiceChannelView';
import { voiceSlice } from '../../stores/voiceSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';
import { messagesSlice } from '../../stores/messagesSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import { typingSlice } from '../../stores/typingSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import type { VoiceUser } from '../../stores/voiceSlice';

// Mutable media-state singleton so individual tests can simulate live
// camera / screen streams. Hoisted so it is available inside the vi.mock factory.
const { mediaStateMock } = vi.hoisted(() => ({
  mediaStateMock: {
    audioStream: null as unknown,
    videoStream: null as unknown,
    screenStream: null as unknown,
  },
}));

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
  getMediaState: () => mediaStateMock,
}));

vi.mock('../../api/gateway', () => ({
  gateway: {
    sendVoiceStateUpdate: vi.fn(),
  },
}));

vi.mock('../../api/rest', () => ({
  api: {
    getMessages: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../utils/sounds', () => ({
  playMuteSound: vi.fn(),
  playUnmuteSound: vi.fn(),
  playDeafenSound: vi.fn(),
  playUndeafenSound: vi.fn(),
  playLeaveSound: vi.fn(),
  playScreenShareStartSound: vi.fn(),
  playScreenShareStopSound: vi.fn(),
}));

// GoLiveModal is a child modal only opened via the Go Live flow (not exercised
// by these tests); mock it to keep this suite isolated from that component.
vi.mock('./GoLiveModal', () => ({
  GoLiveModal: () => null,
}));

// Mock the chat components to simplify testing
vi.mock('../chat/MessageList', () => ({
  MessageList: ({ channelId }: { channelId: string }) => (
    <div data-testid={`message-list-${channelId}`}>MessageList</div>
  ),
}));

vi.mock('../chat/MessageInput', () => ({
  MessageInput: ({ channelId }: { channelId: string }) => (
    <div data-testid={`message-input-${channelId}`}>MessageInput</div>
  ),
}));

vi.mock('../chat/TypingIndicator', () => ({
  TypingIndicator: ({ channelId }: { channelId: string }) => (
    <div data-testid={`typing-indicator-${channelId}`}>TypingIndicator</div>
  ),
}));

const testVoiceUsers: VoiceUser[] = [
  { userId: '50', username: 'TestUser', avatar: null, selfMute: false, selfDeaf: false, streaming: false },
  { userId: '51', username: 'OtherUser', avatar: null, selfMute: false, selfDeaf: false, streaming: false },
];

function createTestStore(overrides?: {
  connected?: boolean;
  channelId?: string;
  voiceUsers?: VoiceUser[];
  selfMute?: boolean;
  selfVideo?: boolean;
  selfScreenShare?: boolean;
}) {
  const channelId = overrides?.channelId ?? '100';
  return configureStore({
    reducer: {
      voice: voiceSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
      messages: messagesSlice.reducer,
      settings: settingsSlice.reducer,
      typing: typingSlice.reducer,
      guilds: guildsSlice.reducer,
    },
    preloadedState: {
      voice: {
        channelId: overrides?.connected !== false ? channelId : null,
        guildId: overrides?.connected !== false ? '1' : null,
        selfMute: overrides?.selfMute ?? false,
        selfDeaf: false,
        selfVideo: overrides?.selfVideo ?? false,
        selfScreenShare: overrides?.selfScreenShare ?? false,
        connected: overrides?.connected ?? true,
        isSpeaking: false,
        speakingUsers: [],
        voiceUsersByChannel: {
          [channelId]: overrides?.voiceUsers ?? testVoiceUsers,
        },
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
      },
      channels: {
        channels: {
          [channelId]: {
            id: channelId,
            guild_id: '1',
            type: 2,
            name: 'General Voice',
            topic: null,
            position: 0,
            parent_id: null,
          },
        },
        selectedChannelId: channelId,
      },
      auth: {
        token: 'test-token',
        user: { id: '50', username: 'TestUser', email: 'test@test.com', avatar: null },
        isAuthenticated: true, status: 'online' as const, customStatus: null,
      },
      messages: {
        messagesByChannel: {},
        hasMoreByChannel: {},
        loadingMoreByChannel: {},
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
        keybinds: [],
      },
      typing: {
        typingByChannel: {},
      },
    },
  });
}

describe('VoiceChannelView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the shared media-state singleton between tests
    mediaStateMock.audioStream = null;
    mediaStateMock.videoStream = null;
    mediaStateMock.screenStream = null;
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByText('General Voice')).toBeInTheDocument();
  });

  it('displays channel name in the header', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    const headerName = screen.getByText('General Voice');
    expect(headerName).toBeInTheDocument();
  });

  it('renders user tiles for connected users', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByText('TestUser')).toBeInTheDocument();
    expect(screen.getByText('OtherUser')).toBeInTheDocument();
  });

  it('shows empty state when no users are in channel and not connected', () => {
    const store = createTestStore({ connected: false, voiceUsers: [] });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByText('No one is currently in this voice channel.')).toBeInTheDocument();
  });

  it('renders voice control bar when connected to this channel', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByLabelText('Mute')).toBeInTheDocument();
    expect(screen.getByLabelText('Disconnect')).toBeInTheDocument();
  });

  it('does not render voice control bar when not connected', () => {
    const store = createTestStore({ connected: false, voiceUsers: testVoiceUsers });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.queryByLabelText('Disconnect')).not.toBeInTheDocument();
  });

  // --- Grid/Focus View Toggle ---

  it('shows grid/focus toggle when more than 1 user is connected', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByLabelText('Switch to Focus View')).toBeInTheDocument();
  });

  it('does not show grid/focus toggle with only 1 user', () => {
    const store = createTestStore({
      voiceUsers: [testVoiceUsers[0]],
    });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.queryByLabelText('Switch to Focus View')).not.toBeInTheDocument();
  });

  it('toggles to focus view when toggle button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Switch to Focus View'));
    expect(screen.getByLabelText('Switch to Grid View')).toBeInTheDocument();
  });

  it('toggles back to grid view from focus view', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Switch to Focus View'));
    fireEvent.click(screen.getByLabelText('Switch to Grid View'));
    expect(screen.getByLabelText('Switch to Focus View')).toBeInTheDocument();
  });

  // --- Text Chat Toggle ---

  it('renders chat toggle button', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByTestId('voice-chat-toggle')).toBeInTheDocument();
  });

  it('shows chat panel when chat toggle is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByTestId('voice-chat-toggle'));
    expect(screen.getByTestId('voice-chat-panel')).toBeInTheDocument();
  });

  it('chat panel contains MessageList and MessageInput', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByTestId('voice-chat-toggle'));
    expect(screen.getByTestId('message-list-100')).toBeInTheDocument();
    expect(screen.getByTestId('message-input-100')).toBeInTheDocument();
  });

  it('hides chat panel when toggle is clicked again', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByTestId('voice-chat-toggle'));
    expect(screen.getByTestId('voice-chat-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-chat-toggle'));
    expect(screen.queryByTestId('voice-chat-panel')).not.toBeInTheDocument();
  });

  it('chat panel shows Text Chat header', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByTestId('voice-chat-toggle'));
    expect(screen.getByText('Text Chat')).toBeInTheDocument();
  });

  // --- Mute/Unmute Controls ---

  it('toggles mute when mute button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Mute'));
    expect(store.getState().voice.selfMute).toBe(true);
  });

  it('shows Unmute label when muted', () => {
    const store = createTestStore({ selfMute: true });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByLabelText('Unmute')).toBeInTheDocument();
  });

  // --- User tile interactions ---

  it('marks self user with (You) badge', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    // self tile shows a "You" badge (visible) and "(You)" in its aria-label
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  // --- Camera on/off rendering (issue #3) ---

  it('renders a <video> for a camera-ON participant', () => {
    // Self has camera on AND a live video stream
    mediaStateMock.videoStream = { id: 'video' };
    const store = createTestStore({ selfVideo: true });
    const { container } = render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(container.querySelector('video.tileVideo')).toBeInTheDocument();
  });

  it('renders the avatar placeholder (no <video>) for a camera-OFF participant', () => {
    // Camera flag off (default) -> no tile video, monogram placeholder instead
    const store = createTestStore({ selfVideo: false });
    const { container } = render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(container.querySelector('video.tileVideo')).not.toBeInTheDocument();
    // Monogram placeholder ('T' for TestUser) is shown instead
    expect(container.querySelector('.tileMonogram')).toBeInTheDocument();
  });

  it('does not render a tile <video> when the camera flag is on but no stream exists', () => {
    // Flag on but no live stream -> still shows placeholder, never a stale/black video
    mediaStateMock.videoStream = null;
    const store = createTestStore({ selfVideo: true });
    const { container } = render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(container.querySelector('video.tileVideo')).not.toBeInTheDocument();
  });

  // --- Focused stream controls (issue #1) ---

  it('renders Fullscreen and Minimize controls on the focused screen-share', () => {
    mediaStateMock.screenStream = { id: 'screen' };
    const store = createTestStore({ selfScreenShare: true });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByLabelText('Enter Fullscreen')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimize Stream')).toBeInTheDocument();
  });

  it('toggles the minimize control label when clicked', () => {
    mediaStateMock.screenStream = { id: 'screen' };
    const store = createTestStore({ selfScreenShare: true });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Minimize Stream'));
    expect(screen.getByLabelText('Restore Stream')).toBeInTheDocument();
  });

  // --- Presenter camera PiP overlay (issue #2) ---

  it('renders the camera PiP overlay when the presenter is screen-sharing AND on camera', () => {
    mediaStateMock.screenStream = { id: 'screen' };
    mediaStateMock.videoStream = { id: 'video' };
    const store = createTestStore({ selfScreenShare: true, selfVideo: true });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.getByTestId('presenter-camera-pip')).toBeInTheDocument();
  });

  it('does not render the camera PiP overlay when the presenter camera is off', () => {
    mediaStateMock.screenStream = { id: 'screen' };
    mediaStateMock.videoStream = null;
    const store = createTestStore({ selfScreenShare: true, selfVideo: false });
    render(
      <Provider store={store}>
        <VoiceChannelView channelId="100" channelName="General Voice" />
      </Provider>,
    );
    expect(screen.queryByTestId('presenter-camera-pip')).not.toBeInTheDocument();
  });
});
