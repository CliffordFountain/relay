import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { StageView } from './StageView';
import { voiceSlice } from '../../stores/voiceSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { stageInstancesSlice } from '../../stores/stageInstancesSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import type { StageParticipant } from '../../stores/stageInstancesSlice';

vi.mock('../../api/gateway', () => ({
  gateway: {
    sendVoiceStateUpdate: vi.fn(),
  },
}));

vi.mock('../../api/rest', () => ({
  api: {
    createStageInstance: vi.fn().mockResolvedValue({
      id: 'stage-1',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      topic: 'Test Topic',
      privacy_level: 2,
      discoverable_disabled: false,
      guild_scheduled_event_id: null,
    }),
    updateStageInstance: vi.fn().mockResolvedValue({}),
    deleteStageInstance: vi.fn().mockResolvedValue(undefined),
    updateVoiceState: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/sounds', () => ({
  playLeaveSound: vi.fn(),
}));

function createTestStore(overrides?: {
  voiceConnected?: boolean;
  voiceChannelId?: string;
  stageInstance?: {
    id: string;
    guild_id: string;
    channel_id: string;
    topic: string;
    privacy_level: number;
    discoverable_disabled: boolean;
    guild_scheduled_event_id: string | null;
  } | null;
  participants?: StageParticipant[];
  handRaises?: string[];
  currentUserId?: string;
}) {
  const stageInstance = overrides?.stageInstance ?? null;
  const participants = overrides?.participants ?? [];
  const channelId = overrides?.voiceChannelId ?? 'channel-1';

  const store = configureStore({
    reducer: {
      voice: voiceSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      stageInstances: stageInstancesSlice.reducer,
      settings: settingsSlice.reducer,
    },
    preloadedState: {
      voice: {
        channelId: overrides?.voiceConnected ? channelId : null,
        guildId: overrides?.voiceConnected ? 'guild-1' : null,
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: false,
        connected: overrides?.voiceConnected ?? false,
        isSpeaking: false,
        speakingUsers: [],
        voiceUsersByChannel: {},
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
      },
      channels: {
        channels: {
          [channelId]: {
            id: channelId,
            guild_id: 'guild-1',
            type: 13,
            name: 'Stage Channel',
            topic: null,
            position: 0,
            parent_id: null,
          },
        },
        selectedChannelId: channelId,
      },
      auth: {
        token: 'test-token',
        user: {
          id: overrides?.currentUserId ?? 'user-1',
          username: 'TestUser',
          email: 'test@example.com',
          avatar: null,
          global_name: null,
          flags: 0,
          premium_type: 0,
          mfa_enabled: false,
          locale: 'en-US',
          pronouns: '',
          bio: null,
          accent_color: null,
        },
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
      },
      guilds: {
        guilds: {
          'guild-1': {
            id: 'guild-1',
            name: 'Test Guild',
            icon: null,
            owner_id: 'user-1',
            member_count: 10,
          },
        },
        selectedGuildId: 'guild-1',
        guildOrder: ['guild-1'],
      },
      stageInstances: {
        instances: stageInstance ? { [stageInstance.id]: stageInstance } : {},
        instanceByChannel: stageInstance ? { [stageInstance.channel_id]: stageInstance.id } : {},
        participantsByChannel: participants.length > 0 ? { [channelId]: participants } : {},
        handRaisesByChannel: overrides?.handRaises ? { [channelId]: overrides.handRaises } : {},
      },
      settings: {
        theme: 'dark' as const,
      },
    },
  });
  return store;
}

describe('StageView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no stage instance is live', () => {
    const store = createTestStore({ voiceConnected: true });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.getByTestId('stage-view')).toBeTruthy();
    expect(screen.getByTestId('stage-empty-state')).toBeTruthy();
    expect(screen.getByText('No Stage Event')).toBeTruthy();
    expect(screen.getByText('Start a Stage')).toBeTruthy();
  });

  it('renders stage header with channel name', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="My Stage" />
      </Provider>
    );

    expect(screen.getByText('My Stage')).toBeTruthy();
  });

  it('renders stage topic banner when instance is live', () => {
    const store = createTestStore({
      voiceConnected: true,
      stageInstance: {
        id: 'stage-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        topic: 'AMA with Developers',
        privacy_level: 2,
        discoverable_disabled: false,
        guild_scheduled_event_id: null,
      },
    });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.getByTestId('stage-topic-banner')).toBeTruthy();
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByText('AMA with Developers')).toBeTruthy();
  });

  it('renders speakers and audience sections', () => {
    const speakers: StageParticipant[] = [
      { userId: 'speaker-1', username: 'Speaker1', avatar: null, isSpeaker: true, isModerator: true, requestingToSpeak: false, suppress: false },
    ];
    const audience: StageParticipant[] = [
      { userId: 'audience-1', username: 'Audience1', avatar: null, isSpeaker: false, isModerator: false, requestingToSpeak: false, suppress: true },
    ];
    const store = createTestStore({
      voiceConnected: true,
      stageInstance: {
        id: 'stage-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        topic: 'Test Stage',
        privacy_level: 2,
        discoverable_disabled: false,
        guild_scheduled_event_id: null,
      },
      participants: [...speakers, ...audience],
    });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.getByText('Speaker1')).toBeTruthy();
    expect(screen.getByText('Audience1')).toBeTruthy();
  });

  it('shows control bar when connected', () => {
    const store = createTestStore({ voiceConnected: true });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.getByLabelText('Mute')).toBeTruthy();
    expect(screen.getByLabelText('Deafen')).toBeTruthy();
    expect(screen.getByLabelText('Disconnect')).toBeTruthy();
  });

  it('does not show control bar when not connected', () => {
    const store = createTestStore({ voiceConnected: false });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.queryByLabelText('Disconnect')).toBeNull();
  });

  it('shows Request to Speak button for audience members', () => {
    const store = createTestStore({
      voiceConnected: true,
      currentUserId: 'user-1',
      stageInstance: {
        id: 'stage-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        topic: 'Test Stage',
        privacy_level: 2,
        discoverable_disabled: false,
        guild_scheduled_event_id: null,
      },
      participants: [
        { userId: 'user-1', username: 'TestUser', avatar: null, isSpeaker: false, isModerator: false, requestingToSpeak: false, suppress: true },
      ],
    });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.getByTestId('request-to-speak-btn')).toBeTruthy();
    expect(screen.getByTestId('request-to-speak-btn')).toHaveAttribute('title', 'Raise Hand');
  });

  it('shows start stage button in empty state when connected', () => {
    const store = createTestStore({ voiceConnected: true });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    const startBtn = screen.getByText('Start a Stage');
    expect(startBtn).toBeTruthy();
  });

  it('opens start stage modal when button clicked', () => {
    const store = createTestStore({ voiceConnected: true });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    fireEvent.click(screen.getByText('Start a Stage'));
    expect(screen.getByRole('dialog', { name: 'Start Stage' })).toBeTruthy();
    expect(screen.getByPlaceholderText('What is this stage about?')).toBeTruthy();
  });

  it('shows participant count in topic banner', () => {
    const store = createTestStore({
      voiceConnected: true,
      stageInstance: {
        id: 'stage-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        topic: 'Test',
        privacy_level: 2,
        discoverable_disabled: false,
        guild_scheduled_event_id: null,
      },
      participants: [
        { userId: 'u1', username: 'A', avatar: null, isSpeaker: true, isModerator: true, requestingToSpeak: false, suppress: false },
        { userId: 'u2', username: 'B', avatar: null, isSpeaker: false, isModerator: false, requestingToSpeak: false, suppress: true },
        { userId: 'u3', username: 'C', avatar: null, isSpeaker: false, isModerator: false, requestingToSpeak: false, suppress: true },
      ],
    });
    render(
      <Provider store={store}>
        <StageView channelId="channel-1" channelName="Stage Channel" />
      </Provider>
    );

    expect(screen.getByText('3 participants')).toBeTruthy();
  });
});
