import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { ServerSidebar } from './ServerSidebar';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { uiSlice } from '../../stores/uiSlice';
import { dmSlice } from '../../stores/dmSlice';
import { authSlice } from '../../stores/authSlice';
import { presenceSlice } from '../../stores/presenceSlice';
import { relationshipsSlice } from '../../stores/relationshipsSlice';
import type { GuildFolder } from '../../stores/guildsSlice';

// ServerSidebar renders DiscoverModal (once opened), which calls api.discoverGuilds on
// mount -- mock the rest client so that stays a fast, deterministic no-op in these tests.
const mockDiscoverGuilds = vi.fn();
vi.mock('../../api/rest', () => ({
  api: {
    discoverGuilds: (...args: unknown[]) => mockDiscoverGuilds(...args),
    leaveGuild: vi.fn(),
  },
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn().mockReturnValue(null),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

function createTestStore(overrides: {
  guilds?: Record<string, { id: string; name: string; icon: string | null; owner_id: string; member_count: number; banner?: string | null; splash?: string | null }>;
  selectedGuildId?: string | null;
  folders?: GuildFolder[];
} = {}) {
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      notifications: notificationsSlice.reducer,
      ui: uiSlice.reducer,
      dm: dmSlice.reducer,
      auth: authSlice.reducer,
      presence: presenceSlice.reducer,
      relationships: relationshipsSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: overrides.guilds ?? {
          'guild-1': { id: 'guild-1', name: 'Test Server', icon: null, owner_id: 'user-1', member_count: 10 },
          'guild-2': { id: 'guild-2', name: 'Another Server', icon: null, owner_id: 'user-2', member_count: 5 },
        },
        selectedGuildId: overrides.selectedGuildId ?? null,
        folders: overrides.folders ?? [],
      },
      channels: {
        channels: {},
        selectedChannelId: null,
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
        lightboxImage: null,
        threadsPanelOpen: false,
        pinnedMessagesPanelOpen: false,
      },
      dm: {
        dmChannels: [],
        selectedDmChannelId: null,
      },
      auth: {
        token: 'test-token',
        user: { id: 'user-1', username: 'testuser', avatar: null, email: 'test@test.com' },
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
      },
      presence: {
        presences: {},
      },
      relationships: {
        relationships: [],
      },
    },
  });
}

function renderWithRouter(ui: React.ReactElement, { initialEntries = ['/channels/@me'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
    </MemoryRouter>
  );
}

describe('ServerSidebar', () => {
  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    expect(container).toBeTruthy();
  });

  it('renders the Home button', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    expect(screen.getByRole('treeitem', { name: 'Home' })).toBeInTheDocument();
  });

  it('renders server items', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    expect(screen.getByRole('treeitem', { name: 'Test Server' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Another Server' })).toBeInTheDocument();
  });

  it('renders the Add a Server button', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    expect(screen.getByRole('button', { name: 'Add a Server' })).toBeInTheDocument();
  });

  it('dispatches openModal with createGuild when Add Server button is clicked', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a Server' }));
    const state = store.getState();
    expect(state.ui.activeModal).toBe('createGuild');
  });

  it('selects a guild when clicked', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    fireEvent.click(screen.getByRole('treeitem', { name: 'Test Server' }));
    const state = store.getState();
    expect(state.guilds.selectedGuildId).toBe('guild-1');
  });

  it('clears selection when Home button is clicked', () => {
    const store = createTestStore({ selectedGuildId: 'guild-1' });
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    fireEvent.click(screen.getByRole('treeitem', { name: 'Home' }));
    const state = store.getState();
    expect(state.guilds.selectedGuildId).toBeNull();
  });

  it('renders servers inside a folder when folder exists', () => {
    const store = createTestStore({
      guilds: {
        'guild-1': { id: 'guild-1', name: 'Foldered Server A', icon: null, owner_id: 'user-1', member_count: 10 },
        'guild-2': { id: 'guild-2', name: 'Foldered Server B', icon: null, owner_id: 'user-1', member_count: 5 },
        'guild-3': { id: 'guild-3', name: 'Standalone Server', icon: null, owner_id: 'user-1', member_count: 3 },
      },
      folders: [
        { id: 'folder-1', guildIds: ['guild-1', 'guild-2'], name: 'My Folder', color: null, expanded: false },
      ],
    });
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    // Standalone server should still be visible
    expect(screen.getByRole('treeitem', { name: 'Standalone Server' })).toBeInTheDocument();
    // Folder should be rendered
    expect(screen.getByRole('button', { name: 'My Folder - click to expand' })).toBeInTheDocument();
  });

  it('expands folder when clicked and shows contained servers', () => {
    const store = createTestStore({
      guilds: {
        'guild-1': { id: 'guild-1', name: 'Foldered Server A', icon: null, owner_id: 'user-1', member_count: 10 },
        'guild-2': { id: 'guild-2', name: 'Foldered Server B', icon: null, owner_id: 'user-1', member_count: 5 },
      },
      folders: [
        { id: 'folder-1', guildIds: ['guild-1', 'guild-2'], name: 'My Folder', color: null, expanded: false },
      ],
    });
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );

    // Click to expand
    fireEvent.click(screen.getByRole('button', { name: 'My Folder - click to expand' }));

    // After expanding, should show servers inside the folder
    expect(screen.getByRole('treeitem', { name: 'Foldered Server A' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Foldered Server B' })).toBeInTheDocument();
  });

  it('has accessible labels on sidebar navigation', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    expect(screen.getByRole('navigation', { name: 'Servers' })).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Servers' })).toBeInTheDocument();
  });

  it('renders guild icon image when guild has icon', () => {
    const store = createTestStore({
      guilds: {
        'guild-1': { id: 'guild-1', name: 'Icon Server', icon: 'abc123', banner: null, splash: null, owner_id: 'user-1', member_count: 10 },
      },
    });
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    const img = screen.getByAltText('Icon Server');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
    expect((img as HTMLImageElement).src).toContain('/icons/guild-1/abc123.png');
  });

  it('renders text acronym when guild has no icon', () => {
    const store = createTestStore({
      guilds: {
        'guild-1': { id: 'guild-1', name: 'Test Server', icon: null, banner: null, splash: null, owner_id: 'user-1', member_count: 10 },
      },
    });
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    const treeItem = screen.getByRole('treeitem', { name: 'Test Server' });
    expect(treeItem.textContent).toContain('TS');
    expect(treeItem.querySelector('img')).toBeNull();
  });

  it('renders the Discover servers button', () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    expect(screen.getByRole('button', { name: 'Discover servers' })).toBeInTheDocument();
  });

  it('opens the Discover modal when the Discover servers button is clicked', async () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover servers' }));
    expect(screen.getByRole('dialog', { name: 'Discover servers' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockDiscoverGuilds).toHaveBeenCalled();
    });
  });

  it('closes the Discover modal when its close button is clicked', () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <ServerSidebar />
      </Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover servers' }));
    expect(screen.getByRole('dialog', { name: 'Discover servers' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('dialog', { name: 'Discover servers' })).not.toBeInTheDocument();
  });
});
