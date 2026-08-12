import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { ChannelSidebar } from './ChannelSidebar';
import { channelsSlice } from '../../stores/channelsSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { authSlice } from '../../stores/authSlice';
import { uiSlice } from '../../stores/uiSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { threadsSlice } from '../../stores/threadsSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import { membersSlice } from '../../stores/membersSlice';

vi.mock('../../api/rest', () => ({
  api: {
    getGuildChannels: vi.fn().mockResolvedValue([]),
    getGuildActiveThreads: vi.fn().mockResolvedValue({ threads: [] }),
    deleteChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../api/gateway', () => ({
  gateway: {
    sendVoiceStateUpdate: vi.fn(),
  },
}));

vi.mock('../../utils/sounds', () => ({
  playJoinSound: vi.fn(),
}));

const mockGuild = {
  id: 'guild-1',
  name: 'Test Server',
  icon: null,
  owner_id: 'user-1',
  member_count: 5,
};

const mockTextCategory = {
  id: 'cat-text',
  guild_id: 'guild-1',
  type: 4,
  name: 'Text Channels',
  topic: null,
  position: 0,
  parent_id: null,
};

const mockVoiceCategory = {
  id: 'cat-voice',
  guild_id: 'guild-1',
  type: 4,
  name: 'Voice Channels',
  topic: null,
  position: 1,
  parent_id: null,
};

const mockGeneralText = {
  id: 'ch-general',
  guild_id: 'guild-1',
  type: 0,
  name: 'general',
  topic: null,
  position: 0,
  parent_id: 'cat-text',
};

const mockGeneralVoice = {
  id: 'ch-voice',
  guild_id: 'guild-1',
  type: 2,
  name: 'General',
  topic: null,
  position: 0,
  parent_id: 'cat-voice',
};

function createTestStore(channels = [mockTextCategory, mockVoiceCategory, mockGeneralText, mockGeneralVoice], guildOverride?: Partial<typeof mockGuild>) {
  const channelsMap: Record<string, typeof mockGeneralText> = {};
  for (const ch of channels) {
    channelsMap[ch.id] = ch;
  }

  const guild = guildOverride ? { ...mockGuild, ...guildOverride } : mockGuild;

  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      voice: voiceSlice.reducer,
      notifications: notificationsSlice.reducer,
      ui: uiSlice.reducer,
      roles: rolesSlice.reducer,
      threads: threadsSlice.reducer,
      settings: settingsSlice.reducer,
      members: membersSlice.reducer,
    },
    preloadedState: {
      auth: {
        user: { id: 'user-1', username: 'testuser', email: 'test@test.com' },
        token: 'test-token',
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
      },
      guilds: {
        guilds: { 'guild-1': guild },
        selectedGuildId: 'guild-1',
      },
      channels: {
        channels: channelsMap,
        selectedChannelId: 'ch-general',
      },
      voice: {
        channelId: null,
        guildId: null,
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: false,
        connected: false,
        isSpeaking: false,
        speakingUsers: [] as string[],
        voiceUsersByChannel: {},
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720, frameRate: 30 },
      },
      notifications: {
        unreadByChannel: {},
        mentionsByChannel: {},
        lastReadMessageIdByChannel: {},
      },
      ui: {
        activeModal: null,
        modalProps: {},
        memberSidebarOpen: true,
        channelSidebarWidth: 240,
        sidebarCollapsed: false,
        activePopoverUserId: null,
        activePopoverPosition: null,
        activePopoverGuildId: null,
        replyingToMessageId: null,
        editingMessageId: null,
        appLoading: false,
      },
      roles: {
        rolesByGuild: {},
      },
      threads: {
        entities: {},
        threadsByParent: {},
        activeThreadsByGuild: {},
        selectedThreadId: null,
        threadsPanelOpen: false,
      },
      settings: {
        theme: 'dark' as const,
        fontSize: 16,
        reducedMotion: false,
        saturation: 100,
        highContrast: false,
        developerMode: false,
        compactMode: false,
        hideMutedChannelsByGuild: {},
      },
      members: {
        membersByGuild: {},
        isLoading: false,
      },
    },
  });
}

const defaultProps = {
  onOpenSettings: vi.fn(),
  onOpenServerSettings: vi.fn(),
  onOpenChannelSettings: vi.fn(),
};

function renderWithRouter(ui: React.ReactElement, { initialEntries = ['/channels/guild-1/ch-general'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
    </MemoryRouter>
  );
}

describe('ChannelSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the server header with guild name', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('Test Server')).toBeTruthy();
  });

  it('renders category headers', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('Text Channels')).toBeTruthy();
    expect(screen.getByText('Voice Channels')).toBeTruthy();
  });

  it('renders text channels under their category', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('general')).toBeTruthy();
  });

  it('renders voice channels under their category', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // Voice channel "General" should be present
    const voiceChannel = screen.getByLabelText(/Voice channel General/i);
    expect(voiceChannel).toBeTruthy();
  });

  it('collapses category when clicked', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // Click on the "Text Channels" category to collapse
    const textCategory = screen.getByLabelText(/Text Channels, expanded/i);
    fireEvent.click(textCategory);

    // After collapse, the category label should say collapsed
    expect(screen.getByLabelText(/Text Channels, collapsed/i)).toBeTruthy();
  });

  it('returns null when no guild is selected', () => {
    const store = configureStore({
      reducer: {
        auth: authSlice.reducer,
        guilds: guildsSlice.reducer,
        channels: channelsSlice.reducer,
        voice: voiceSlice.reducer,
        notifications: notificationsSlice.reducer,
        ui: uiSlice.reducer,
        roles: rolesSlice.reducer,
        threads: threadsSlice.reducer,
        settings: settingsSlice.reducer,
        members: membersSlice.reducer,
      },
      preloadedState: {
        auth: {
          user: { id: 'user-1', username: 'testuser', email: 'test@test.com' },
          token: 'test-token',
          isLoading: false,
          error: null,
        },
        guilds: {
          guilds: {},
          selectedGuildId: null,
        },
        channels: {
          channels: {},
          selectedChannelId: null,
        },
        voice: {
          channelId: null,
          guildId: null,
          selfMute: false,
          selfDeaf: false,
          selfVideo: false,
          selfScreenShare: false,
          connected: false,
          isSpeaking: false,
          speakingUsers: [] as string[],
          voiceUsersByChannel: {},
          voiceChannelStatuses: {},
        streamQuality: { resolution: 720, frameRate: 30 },
        },
        notifications: {
          unreadByChannel: {},
          mentionsByChannel: {},
          lastReadMessageIdByChannel: {},
        },
        ui: {
          activeModal: null,
          modalProps: {},
          memberSidebarOpen: true,
          channelSidebarWidth: 240,
          sidebarCollapsed: false,
          activePopoverUserId: null,
          activePopoverPosition: null,
          activePopoverGuildId: null,
          replyingToMessageId: null,
          editingMessageId: null,
          appLoading: false,
        },
        roles: {
          rolesByGuild: {},
        },
        threads: {
          entities: {},
          threadsByParent: {},
          activeThreadsByGuild: {},
          selectedThreadId: null,
          threadsPanelOpen: false,
        },
        settings: {
          theme: 'dark' as const,
          fontSize: 16,
          reducedMotion: false,
          saturation: 100,
          highContrast: false,
          developerMode: false,
          compactMode: false,
        },
        members: {
          membersByGuild: {},
          isLoading: false,
        },
      },
    });

    const { container } = renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // When no guild is selected, the sidebar should render nothing
    expect(container.children.length).toBe(0);
  });

  it('renders channels with correct channel type icons', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // Text channel should have the text channel aria label
    expect(screen.getByLabelText(/Text channel general/i)).toBeTruthy();
    // Voice channel should have the voice channel aria label
    expect(screen.getByLabelText(/Voice channel General/i)).toBeTruthy();
  });

  it('toggles server header dropdown on click', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    const header = screen.getByLabelText(/Test Server server options/i);
    fireEvent.click(header);

    // Dropdown should now be visible (the header should indicate expanded)
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders uncategorized channels at the top when they have no parent_id', () => {
    const uncategorizedChannel = {
      id: 'ch-orphan',
      guild_id: 'guild-1',
      type: 0,
      name: 'orphan-channel',
      topic: null,
      position: 0,
      parent_id: null,
    };

    const store = createTestStore([
      mockTextCategory,
      mockVoiceCategory,
      mockGeneralText,
      mockGeneralVoice,
      uncategorizedChannel,
    ]);

    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // Uncategorized channel should be rendered
    expect(screen.getByText('orphan-channel')).toBeTruthy();
    // Categories should still be rendered
    expect(screen.getByText('Text Channels')).toBeTruthy();
    expect(screen.getByText('Voice Channels')).toBeTruthy();
  });

  it('hides child channels when a category is collapsed', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // general text channel should be visible
    expect(screen.getByText('general')).toBeTruthy();

    // Click on the "Text Channels" category to collapse it
    const textCategory = screen.getByLabelText(/Text Channels, expanded/i);
    fireEvent.click(textCategory);

    // After collapse, the child channel should not be visible
    expect(screen.queryByLabelText(/Text channel general/i)).toBeNull();
  });

  it('shows create channel button on category headers when user has permission', () => {
    const store = createTestStore();

    // Give the user MANAGE_CHANNELS permission via the @everyone role
    store.dispatch({
      type: 'roles/setRoles',
      payload: {
        guildId: 'guild-1',
        roles: [
          {
            id: 'guild-1',
            guild_id: 'guild-1',
            name: '@everyone',
            color: 0,
            hoist: false,
            position: 0,
            permissions: String(1 << 4), // MANAGE_CHANNELS
            managed: false,
            mentionable: false,
          },
        ],
      },
    });

    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // The create channel button ("+") should be in the DOM for each category
    const createButtons = screen.getAllByLabelText(/Create channel in/i);
    expect(createButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders both categories from guild creation response', () => {
    // Simulate a newly created guild with both default categories
    const channels = [
      {
        id: 'cat-1',
        guild_id: 'guild-1',
        type: 4,
        name: 'Text Channels',
        topic: null,
        position: 0,
        parent_id: null,
      },
      {
        id: 'ch-1',
        guild_id: 'guild-1',
        type: 0,
        name: 'general',
        topic: null,
        position: 0,
        parent_id: 'cat-1',
      },
      {
        id: 'cat-2',
        guild_id: 'guild-1',
        type: 4,
        name: 'Voice Channels',
        topic: null,
        position: 1,
        parent_id: null,
      },
      {
        id: 'ch-2',
        guild_id: 'guild-1',
        type: 2,
        name: 'General',
        topic: null,
        position: 0,
        parent_id: 'cat-2',
      },
    ];

    const store = createTestStore(channels);
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // Both category headers should appear
    expect(screen.getByText('Text Channels')).toBeTruthy();
    expect(screen.getByText('Voice Channels')).toBeTruthy();

    // Both channels should appear
    expect(screen.getByText('general')).toBeTruthy();
    expect(screen.getByLabelText(/Voice channel General/i)).toBeTruthy();
  });

  it('renders server banner when guild has banner', () => {
    const store = createTestStore(undefined, { banner: 'banner_hash_123' });
    const { container } = renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    const bannerImg = container.querySelector('img');
    expect(bannerImg).toBeTruthy();
    expect(bannerImg?.src).toContain('/banners/guild-1/banner_hash_123.png');
  });

  it('does not render server banner when guild has no banner', () => {
    const store = createTestStore(undefined, { banner: null });
    const { container } = renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // No banner image should be present (there shouldn't be any img element in the sidebar)
    const imgs = container.querySelectorAll('img');
    expect(imgs.length).toBe(0);
  });

  it('shows user limit for voice channels with user_limit set', () => {
    const voiceWithLimit = {
      ...mockGeneralVoice,
      user_limit: 5,
    };
    const store = createTestStore([mockTextCategory, mockVoiceCategory, mockGeneralText, voiceWithLimit]);
    // Add 2 users to the voice channel
    store.dispatch({
      type: 'voice/addVoiceUser',
      payload: {
        channelId: 'ch-voice',
        user: {
          userId: 'user-1',
          username: 'User1',
          avatar: null,
          selfMute: false,
          selfDeaf: false,
          streaming: false,
        },
      },
    });
    store.dispatch({
      type: 'voice/addVoiceUser',
      payload: {
        channelId: 'ch-voice',
        user: {
          userId: 'user-2',
          username: 'User2',
          avatar: null,
          selfMute: false,
          selfDeaf: false,
          streaming: false,
        },
      },
    });

    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('shows voice user limit in red when channel is full', () => {
    const voiceWithLimit = {
      ...mockGeneralVoice,
      user_limit: 1,
    };
    const store = createTestStore([mockTextCategory, mockVoiceCategory, mockGeneralText, voiceWithLimit]);
    store.dispatch({
      type: 'voice/addVoiceUser',
      payload: {
        channelId: 'ch-voice',
        user: {
          userId: 'user-1',
          username: 'User1',
          avatar: null,
          selfMute: false,
          selfDeaf: false,
          streaming: false,
        },
      },
    });

    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    const limitElement = screen.getByText('1/1');
    expect(limitElement).toBeInTheDocument();
    expect(limitElement.getAttribute('aria-label')).toBe('1 of 1 user limit');
  });

  it('does not show user limit for voice channels without user_limit', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ChannelSidebar {...defaultProps} />
      </Provider>
    );

    // Voice channel without user_limit should not show any limit display
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
  });
});
