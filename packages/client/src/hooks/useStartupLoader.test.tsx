import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import type { ReactNode } from 'react';
import { useStartupLoader, saveLastSelection, getLastSelection } from './useStartupLoader';
import { authSlice } from '../stores/authSlice';
import { guildsSlice } from '../stores/guildsSlice';
import { channelsSlice } from '../stores/channelsSlice';
import { uiSlice } from '../stores/uiSlice';

const mockGetMe = vi.fn();
const mockGetMyGuilds = vi.fn();
const mockGetGuildChannels = vi.fn();
const mockSetToken = vi.fn();
const mockClearToken = vi.fn();

vi.mock('../api/rest', () => ({
  api: {
    getMe: () => mockGetMe(),
    getMyGuilds: () => mockGetMyGuilds(),
    getGuildChannels: (id: string) => mockGetGuildChannels(id),
    setToken: (t: string) => mockSetToken(t),
    clearToken: () => mockClearToken(),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
}

type TestStore = ReturnType<typeof createTestStore>;

const createWrapper = (store: TestStore, initialEntries: string[] = ['/']) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
    </Provider>
  );
  return Wrapper;
};

describe('useStartupLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('sets appLoading to false immediately when no token exists', async () => {
    const store = createTestStore();

    renderHook(() => useStartupLoader(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.getState().ui.appLoading).toBe(false);
    });
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it('fetches user, guilds, and channels when token exists', async () => {
    localStorage.setItem('token', 'test-token');

    const mockUser = { id: '1', username: 'testuser', avatar: null, email: 'test@test.com' };
    const mockGuilds = [
      { id: 'g1', name: 'Guild 1', icon: null, owner_id: '1', member_count: 5 },
    ];
    const mockChannels = [
      { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      { id: 'c2', guild_id: 'g1', type: 0, name: 'random', topic: null, position: 1, parent_id: null },
    ];

    mockGetMe.mockResolvedValue(mockUser);
    mockGetMyGuilds.mockResolvedValue(mockGuilds);
    mockGetGuildChannels.mockResolvedValue(mockChannels);

    const store = createTestStore();

    renderHook(() => useStartupLoader(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.getState().ui.appLoading).toBe(false);
    });

    expect(mockSetToken).toHaveBeenCalledWith('test-token');
    expect(mockGetMe).toHaveBeenCalledOnce();
    expect(mockGetMyGuilds).toHaveBeenCalledOnce();
    expect(mockGetGuildChannels).toHaveBeenCalledWith('g1');

    // Verify store state
    const state = store.getState();
    expect(state.auth.isAuthenticated).toBe(true);
    expect(state.auth.user?.username).toBe('testuser');
    expect(Object.keys(state.guilds.guilds)).toHaveLength(1);
    expect(state.guilds.selectedGuildId).toBe('g1');
    expect(Object.keys(state.channels.channels)).toHaveLength(2);
    expect(state.channels.selectedChannelId).toBe('c1');
  });

  it('clears token and logs out when getMe returns 401', async () => {
    localStorage.setItem('token', 'invalid-token');
    mockGetMe.mockRejectedValue(new Error('Unauthorized'));

    const store = createTestStore();

    renderHook(() => useStartupLoader(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.getState().ui.appLoading).toBe(false);
    });

    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('restores last-selected guild and channel from localStorage', async () => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('lastSelectedGuildId', 'g2');
    localStorage.setItem('lastSelectedChannelId', 'c3');

    const mockUser = { id: '1', username: 'testuser', avatar: null, email: 'test@test.com' };
    const mockGuilds = [
      { id: 'g1', name: 'Guild 1', icon: null, owner_id: '1', member_count: 5 },
      { id: 'g2', name: 'Guild 2', icon: null, owner_id: '1', member_count: 3 },
    ];

    mockGetMe.mockResolvedValue(mockUser);
    mockGetMyGuilds.mockResolvedValue(mockGuilds);
    mockGetGuildChannels.mockImplementation((id: string) => {
      if (id === 'g1') return Promise.resolve([
        { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      ]);
      if (id === 'g2') return Promise.resolve([
        { id: 'c3', guild_id: 'g2', type: 0, name: 'chat', topic: null, position: 0, parent_id: null },
        { id: 'c4', guild_id: 'g2', type: 0, name: 'dev', topic: null, position: 1, parent_id: null },
      ]);
      return Promise.resolve([]);
    });

    const store = createTestStore();

    renderHook(() => useStartupLoader(), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.getState().ui.appLoading).toBe(false);
    });

    expect(store.getState().guilds.selectedGuildId).toBe('g2');
    expect(store.getState().channels.selectedChannelId).toBe('c3');
  });
});

describe('saveLastSelection / getLastSelection', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('saves and restores guild and channel IDs', () => {
    saveLastSelection('g1', 'c1');
    const { guildId, channelId } = getLastSelection();
    expect(guildId).toBe('g1');
    expect(channelId).toBe('c1');
  });

  it('clears values when null is passed', () => {
    saveLastSelection('g1', 'c1');
    saveLastSelection(null, null);
    const { guildId, channelId } = getLastSelection();
    expect(guildId).toBeNull();
    expect(channelId).toBeNull();
  });
});
