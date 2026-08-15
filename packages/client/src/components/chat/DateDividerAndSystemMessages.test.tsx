import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MessageList } from './MessageList';
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
import { relationshipsSlice } from '../../stores/relationshipsSlice';
import { searchSlice } from '../../stores/searchSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import { typingSlice } from '../../stores/typingSlice';
import { presenceSlice } from '../../stores/presenceSlice';
import type { Message } from '../../stores/messagesSlice';

vi.mock('../../api/rest', () => ({
  api: {
    sendMessage: vi.fn(() => Promise.resolve({ id: '1', content: 'test' })),
    sendTyping: vi.fn(() => Promise.resolve()),
    editMessage: vi.fn(() => Promise.resolve({})),
    deleteMessage: vi.fn(() => Promise.resolve()),
    addReaction: vi.fn(() => Promise.resolve()),
    crosspostMessage: vi.fn(() => Promise.resolve({})),
    pinMessage: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: {
    data: unknown[];
    itemContent: (index: number) => React.ReactNode;
    components?: { Header?: React.ComponentType; List?: React.ComponentType; Item?: React.ComponentType };
  }) => {
    const Header = components?.Header;
    return (
      <div data-testid="virtuoso-mock">
        {Header && <Header />}
        {data.map((_, index) => (
          <div key={index}>{itemContent(index)}</div>
        ))}
      </div>
    );
  },
}));

function createTestStore(overrides?: Record<string, unknown>) {
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
      membersByGuild: {
        g1: [
          { user: { id: 'u1', username: 'alice', displayName: 'Alice', avatar: null, bot: false }, roles: [], nick: null, joinedAt: '2024-01-01' },
        ],
      },
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
      pinnedMessagesPanelOpen: false,
      inboxPanelOpen: false,
      inboxPanelTab: 'forYou' as const,
    },
    messages: {
      messagesByChannel: {},
    },
    notifications: {
      unreadGuilds: [],
      mentionCountByGuild: {},
      mentionCountByChannel: {},
      desktopNotificationQueue: [],
      soundEnabled: true,
      lastReadMessageIdByChannel: {},
    },
    roles: {
      rolesByGuild: {},
    },
    relationships: {
      relationships: {},
      isLoading: false,
    },
    presence: {
      presences: {},
      selfStatus: 'online' as const,
    },
    ...overrides,
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
      relationships: relationshipsSlice.reducer,
      search: searchSlice.reducer,
      settings: settingsSlice.reducer,
      typing: typingSlice.reducer,
      presence: presenceSlice.reducer,
    },
    preloadedState: defaultState as Record<string, never>,
  });
}

function makeMessage(overrides: Partial<Message> & { id: string; timestamp: string }): Message {
  return {
    channel_id: 'ch1',
    author: { id: 'u1', username: 'alice', avatar: null },
    content: 'Hello world',
    edited_timestamp: null,
    ...overrides,
  };
}

describe('Date Dividers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a date divider between messages from different days', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', timestamp: '2026-03-25T10:00:00Z', content: 'Day 1 message' }),
      makeMessage({ id: '2', timestamp: '2026-03-26T14:00:00Z', content: 'Day 2 message' }),
    ];

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <MessageList messages={messages} channelId="ch1" />
        </MemoryRouter>
      </Provider>,
    );

    // There should be a date divider for March 26, 2026
    const dividers = screen.getAllByRole('separator');
    const dateDivider = dividers.find(d => d.getAttribute('aria-label')?.includes('March'));
    expect(dateDivider).toBeTruthy();
  });

  it('does not render a date divider between messages on the same day', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', timestamp: '2026-03-25T10:00:00Z', content: 'Message 1' }),
      makeMessage({ id: '2', timestamp: '2026-03-25T14:00:00Z', content: 'Message 2', author: { id: 'u2', username: 'bob', avatar: null } }),
    ];

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <MessageList messages={messages} channelId="ch1" />
        </MemoryRouter>
      </Provider>,
    );

    // No separator with a date label should exist between same-day messages
    const dividers = screen.queryAllByRole('separator');
    const dateDividers = dividers.filter(d => {
      const label = d.getAttribute('aria-label') ?? '';
      return label.includes('March') && !label.includes('New');
    });
    expect(dateDividers).toHaveLength(0);
  });
});

describe('System Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a join system message with correct text', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        timestamp: '2026-03-25T10:00:00Z',
        content: '',
        type: 7,
        author: { id: 'u2', username: 'bob', avatar: null },
      }),
    ];

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <MessageList messages={messages} channelId="ch1" />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === 'bob joined the server.')).toBeInTheDocument();
  });

  it('renders a pin system message', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        timestamp: '2026-03-25T10:00:00Z',
        content: '',
        type: 6,
        author: { id: 'u1', username: 'alice', avatar: null },
      }),
    ];

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <MessageList messages={messages} channelId="ch1" />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText((_content, element) => element?.textContent === 'alice pinned a message to this channel.')).toBeInTheDocument();
  });


  it('renders a thread created system message', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        timestamp: '2026-03-25T10:00:00Z',
        content: 'My Thread',
        type: 18,
        author: { id: 'u1', username: 'alice', avatar: null },
      }),
    ];

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <MessageList messages={messages} channelId="ch1" />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText((_content, element) => element?.textContent === 'alice started a thread: My Thread')).toBeInTheDocument();
  });

  it('renders system messages with data-testid', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        timestamp: '2026-03-25T10:00:00Z',
        content: '',
        type: 7,
        author: { id: 'u2', username: 'bob', avatar: null },
      }),
    ];

    const store = createTestStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <MessageList messages={messages} channelId="ch1" />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByTestId('system-message')).toBeInTheDocument();
  });
});
