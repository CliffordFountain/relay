import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { InboxPanel } from './InboxPanel';
import { uiSlice } from '../../stores/uiSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';

const mockGetMentions = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getMentions: (...args: unknown[]) => mockGetMentions(...args),
  },
}));

function createTestStore(overrides?: {
  inboxPanelOpen?: boolean;
  inboxPanelTab?: 'forYou' | 'unreads';
  guilds?: Record<string, {
    id: string;
    name: string;
    icon: string | null;
    owner_id: string;
    member_count: number;
  }>;
  channels?: Record<string, {
    id: string;
    guild_id: string | null;
    type: number;
    name: string | null;
    topic: string | null;
    position: number;
    parent_id: string | null;
  }>;
  mentionsByChannel?: Record<string, number>;
}) {
  return configureStore({
    reducer: {
      ui: uiSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      notifications: notificationsSlice.reducer,
    },
    preloadedState: {
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
        lightboxImage: null,
        quickSwitcherOpen: false,
        pinnedMessagesPanelOpen: false,
        inboxPanelOpen: overrides?.inboxPanelOpen ?? false,
        inboxPanelTab: overrides?.inboxPanelTab ?? 'forYou',
      },
      guilds: {
        guilds: overrides?.guilds ?? {},
        selectedGuildId: null,
        folders: [],
      },
      channels: {
        channels: overrides?.channels ?? {},
        selectedChannelId: null,
      },
      notifications: {
        unreadByChannel: {},
        mentionsByChannel: overrides?.mentionsByChannel ?? {},
        lastReadMessageIdByChannel: {},
      },
    },
  });
}

describe('InboxPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMentions.mockResolvedValue([]);
  });

  it('does not render when closed', () => {
    const store = createTestStore({ inboxPanelOpen: false });
    const { container } = render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );
    expect(container.firstChild).toBeNull();
    expect(mockGetMentions).not.toHaveBeenCalled();
  });

  it('renders when open', () => {
    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );
    expect(screen.getByRole('complementary', { name: /inbox panel/i })).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('fetches mentions when the panel opens', async () => {
    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );
    await waitFor(() => {
      expect(mockGetMentions).toHaveBeenCalledTimes(1);
    });
  });

  it('shows For You and Unreads tabs', () => {
    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );
    expect(screen.getByRole('tab', { name: /for you/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /unreads/i })).toBeInTheDocument();
  });

  it('switches tabs when clicked', () => {
    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    const unreadsTab = screen.getByRole('tab', { name: /unreads/i });
    fireEvent.click(unreadsTab);
    expect(unreadsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows empty state when no mentions', async () => {
    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );
    await waitFor(() => {
      expect(screen.getByText('No recent mentions')).toBeInTheDocument();
    });
  });

  it('shows empty state for unreads tab', async () => {
    const store = createTestStore({ inboxPanelOpen: true, inboxPanelTab: 'unreads' });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );
    await waitFor(() => {
      expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
    });
  });

  it('closes when close button is clicked', () => {
    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    const closeBtn = screen.getByRole('button', { name: /close inbox/i });
    fireEvent.click(closeBtn);
    expect(store.getState().ui.inboxPanelOpen).toBe(false);
  });

  it('does not fabricate mentions from guild/notification state', async () => {
    const store = createTestStore({
      inboxPanelOpen: true,
      guilds: {
        'g1': {
          id: 'g1',
          name: 'Test Server',
          icon: null,
          owner_id: 'u1',
          member_count: 10,
        },
      },
      mentionsByChannel: {
        'c1': 3,
      },
    });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('No recent mentions')).toBeInTheDocument();
    });
    expect(screen.queryByText('Test Server')).not.toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    mockGetMentions.mockReset();
    mockGetMentions.mockRejectedValue(new Error('network down'));

    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load your mentions/i);
    });
  });

  it('renders a mention, resolving guild and channel names from the store', async () => {
    mockGetMentions.mockReset();
    mockGetMentions.mockResolvedValue([
      {
        id: 'm1',
        channel_id: 'c1',
        guild_id: 'g1',
        author: { id: 'u1', username: 'alice', global_name: 'Alice A.', avatar: null },
        content: 'hey @you check this out',
        timestamp: '2026-09-13T10:00:00Z',
      },
    ]);

    const store = createTestStore({
      inboxPanelOpen: true,
      guilds: {
        g1: { id: 'g1', name: 'Test Server', icon: null, owner_id: 'u1', member_count: 10 },
      },
      channels: {
        c1: { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      },
    });

    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Server')).toBeInTheDocument();
    });
    expect(screen.getByText('#general')).toBeInTheDocument();
    expect(screen.getByText('Alice A.')).toBeInTheDocument();
    expect(screen.getByText('hey @you check this out')).toBeInTheDocument();
  });

  it('falls back to sensible labels when guild/channel are not in the store', async () => {
    mockGetMentions.mockReset();
    mockGetMentions.mockResolvedValue([
      {
        id: 'm1',
        channel_id: 'c-unknown',
        guild_id: 'g-unknown',
        author: { id: 'u1', username: 'bob' },
        content: 'hello',
        timestamp: '2026-09-13T10:00:00Z',
      },
    ]);

    const store = createTestStore({ inboxPanelOpen: true });
    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Unknown Server')).toBeInTheDocument();
    });
    expect(screen.getByText('#unknown-channel')).toBeInTheDocument();
    // no global_name provided, falls back to username
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('calls onNavigateToMessage with real ids and marks the mention read on click', async () => {
    mockGetMentions.mockReset();
    mockGetMentions.mockResolvedValue([
      {
        id: 'm1',
        channel_id: 'c1',
        guild_id: 'g1',
        author: { id: 'u1', username: 'alice' },
        content: 'ping',
        timestamp: '2026-09-13T10:00:00Z',
      },
    ]);

    const onNavigate = vi.fn();
    const store = createTestStore({
      inboxPanelOpen: true,
      guilds: { g1: { id: 'g1', name: 'Test Server', icon: null, owner_id: 'u1', member_count: 10 } },
      channels: { c1: { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null } },
    });

    render(
      <Provider store={store}>
        <InboxPanel onNavigateToMessage={onNavigate} />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('ping')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('ping'));
    expect(onNavigate).toHaveBeenCalledWith('g1', 'c1', 'm1');
  });

  it('marks a single mention as read and moves it out of the Unreads tab', async () => {
    mockGetMentions.mockReset();
    mockGetMentions.mockResolvedValue([
      {
        id: 'm1',
        channel_id: 'c1',
        guild_id: 'g1',
        author: { id: 'u1', username: 'alice' },
        content: 'ping',
        timestamp: '2026-09-13T10:00:00Z',
      },
    ]);

    const store = createTestStore({
      inboxPanelOpen: true,
      guilds: { g1: { id: 'g1', name: 'Test Server', icon: null, owner_id: 'u1', member_count: 10 } },
      channels: { c1: { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null } },
    });

    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/mark mention from alice as read/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/mark mention from alice as read/i));

    const unreadsTab = screen.getByRole('tab', { name: /unreads/i });
    fireEvent.click(unreadsTab);
    expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
  });

  it('marks all mentions as read', async () => {
    mockGetMentions.mockReset();
    mockGetMentions.mockResolvedValue([
      {
        id: 'm1',
        channel_id: 'c1',
        guild_id: 'g1',
        author: { id: 'u1', username: 'alice' },
        content: 'ping',
        timestamp: '2026-09-13T10:00:00Z',
      },
    ]);

    const store = createTestStore({
      inboxPanelOpen: true,
      guilds: { g1: { id: 'g1', name: 'Test Server', icon: null, owner_id: 'u1', member_count: 10 } },
      channels: { c1: { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null } },
    });

    render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Mark All as Read')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mark All as Read'));

    const unreadsTab = screen.getByRole('tab', { name: /unreads/i });
    fireEvent.click(unreadsTab);
    expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
  });

  it('refetches mentions each time the panel is reopened', async () => {
    const store = createTestStore({ inboxPanelOpen: false });
    const { rerender } = render(
      <Provider store={store}>
        <InboxPanel />
      </Provider>
    );

    expect(mockGetMentions).not.toHaveBeenCalled();

    await act(async () => {
      store.dispatch(uiSlice.actions.toggleInboxPanel());
      rerender(
        <Provider store={store}>
          <InboxPanel />
        </Provider>
      );
    });
    await waitFor(() => {
      expect(mockGetMentions).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      store.dispatch(uiSlice.actions.closeInboxPanel());
      rerender(
        <Provider store={store}>
          <InboxPanel />
        </Provider>
      );
    });

    await act(async () => {
      store.dispatch(uiSlice.actions.toggleInboxPanel());
      rerender(
        <Provider store={store}>
          <InboxPanel />
        </Provider>
      );
    });
    await waitFor(() => {
      expect(mockGetMentions).toHaveBeenCalledTimes(2);
    });
  });
});
