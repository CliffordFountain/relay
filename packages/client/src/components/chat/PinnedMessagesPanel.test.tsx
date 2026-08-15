import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { messagesSlice } from '../../stores/messagesSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { membersSlice } from '../../stores/membersSlice';
import { uiSlice } from '../../stores/uiSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { dmSlice } from '../../stores/dmSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { searchSlice } from '../../stores/searchSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import { typingSlice } from '../../stores/typingSlice';

const mockGetPinnedMessages = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getPinnedMessages: (...args: unknown[]) => mockGetPinnedMessages(...args),
  },
}));

function createTestStore() {
  const defaultState = {
    channels: {
      channels: {
        ch1: { id: 'ch1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      },
      selectedChannelId: 'ch1',
    },
    guilds: {
      guilds: { g1: { id: 'g1', name: 'Test Guild', icon: null, owner_id: 'u1', member_count: 3 } },
      selectedGuildId: 'g1',
    },
    members: {
      membersByGuild: { g1: [] },
      isLoading: false,
    },
    auth: {
      user: { id: 'u1', username: 'alice', avatar: null },
      token: 'test-token',
      isAuthenticated: true,
      status: 'online' as const,
      customStatus: null,
      isLoading: false,
      error: null,
      mfaRequired: false,
      mfaTicket: null,
    },
    ui: {
      replyingToMessageId: null,
      editingMessageId: null,
      memberSidebarOpen: true,
      channelSidebarWidth: 240,
      modals: [],
      activePopover: null,
      activeContextMenu: null,
      activeTooltip: null,
      selectedGuildId: 'g1',
      selectedChannelId: 'ch1',
      selectedDMChannelId: null,
      threadsPanelOpen: false,
      selectedThreadId: null,
      searchPanelOpen: false,
      dragState: null,
      lightboxImage: null,
      pinnedMessagesPanelOpen: true,
      inboxPanelOpen: false,
      inboxPanelTab: 'forYou' as const,
    },
    messages: { messagesByChannel: {} },
    notifications: {
      unreadGuilds: [],
      mentionCountByGuild: {},
      mentionCountByChannel: {},
      desktopNotificationQueue: [],
      soundEnabled: true,
      lastReadMessageIdByChannel: {},
    },
    roles: { rolesByGuild: {} },
  };

  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      messages: messagesSlice.reducer,
      voice: voiceSlice.reducer,
      members: membersSlice.reducer,
      ui: uiSlice.reducer,
      roles: rolesSlice.reducer,
      dm: dmSlice.reducer,
      notifications: notificationsSlice.reducer,
      search: searchSlice.reducer,
      settings: settingsSlice.reducer,
      typing: typingSlice.reducer,
    },
    preloadedState: defaultState as Record<string, never>,
  });
}

describe('PinnedMessagesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the panel header', async () => {
    mockGetPinnedMessages.mockResolvedValue([]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={vi.fn()} />
      </Provider>,
    );

    expect(screen.getByText('Pinned Messages')).toBeInTheDocument();
  });

  it('shows empty state when no pinned messages', async () => {
    mockGetPinnedMessages.mockResolvedValue([]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={vi.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/doesn't have any pinned messages/)).toBeInTheDocument();
    });
  });

  it('renders pinned messages with author and content', async () => {
    mockGetPinnedMessages.mockResolvedValue([
      {
        id: 'msg1',
        channel_id: 'ch1',
        author: { id: 'u1', username: 'alice', avatar: null },
        content: 'This is a pinned message',
        timestamp: '2026-03-25T10:00:00Z',
        edited_timestamp: null,
        pinned: true,
      },
    ]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={vi.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(screen.getByText('This is a pinned message')).toBeInTheDocument();
  });

  it('calls onJumpToMessage when Jump button is clicked', async () => {
    const onJump = vi.fn();
    mockGetPinnedMessages.mockResolvedValue([
      {
        id: 'msg1',
        channel_id: 'ch1',
        author: { id: 'u1', username: 'alice', avatar: null },
        content: 'Pinned content',
        timestamp: '2026-03-25T10:00:00Z',
        edited_timestamp: null,
        pinned: true,
      },
    ]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={onJump} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Jump')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Jump'));
    expect(onJump).toHaveBeenCalledWith('msg1');
  });

  it('closes the panel when close button is clicked', async () => {
    mockGetPinnedMessages.mockResolvedValue([]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={vi.fn()} />
      </Provider>,
    );

    const closeBtn = screen.getByLabelText('Close pinned messages');
    fireEvent.click(closeBtn);

    // After closing, the pinnedMessagesPanelOpen should be false
    expect(store.getState().ui.pinnedMessagesPanelOpen).toBe(false);
  });

  it('shows error state when API call fails', async () => {
    mockGetPinnedMessages.mockRejectedValue(new Error('Network error'));

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={vi.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load pinned messages.')).toBeInTheDocument();
    });
  });

  it('renders multiple pinned messages', async () => {
    mockGetPinnedMessages.mockResolvedValue([
      {
        id: 'msg1',
        channel_id: 'ch1',
        author: { id: 'u1', username: 'alice', avatar: null },
        content: 'First pin',
        timestamp: '2026-03-25T10:00:00Z',
        edited_timestamp: null,
        pinned: true,
      },
      {
        id: 'msg2',
        channel_id: 'ch1',
        author: { id: 'u2', username: 'bob', avatar: null },
        content: 'Second pin',
        timestamp: '2026-03-24T10:00:00Z',
        edited_timestamp: null,
        pinned: true,
      },
    ]);

    const store = createTestStore();
    render(
      <Provider store={store}>
        <PinnedMessagesPanel channelId="ch1" onJumpToMessage={vi.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('First pin')).toBeInTheDocument();
    });
    expect(screen.getByText('Second pin')).toBeInTheDocument();
    expect(screen.getAllByText('Jump')).toHaveLength(2);
  });
});
