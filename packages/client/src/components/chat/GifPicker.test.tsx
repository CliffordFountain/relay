import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MessageInput } from './MessageInput';
import { GifPicker } from './GifPicker';
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

vi.mock('../../api/rest', () => ({
  api: {
    sendMessage: vi.fn(() => Promise.resolve({ id: '1', content: 'test' })),
    sendTyping: vi.fn(() => Promise.resolve()),
    sendMessageWithAttachments: vi.fn(() => Promise.resolve({ id: '1', content: '' })),
  },
}));

const MOCK_GIPHY_RESPONSE = {
  data: [
    {
      id: 'gif1',
      title: 'Funny Cat',
      images: {
        original: { url: 'https://media.giphy.com/media/gif1/giphy.gif', width: '400', height: '400' },
        fixed_width: { url: 'https://media.giphy.com/media/gif1/200w.gif', width: '200', height: '200' },
      },
    },
    {
      id: 'gif2',
      title: 'Dancing Dog',
      images: {
        original: { url: 'https://media.giphy.com/media/gif2/giphy.gif', width: '400', height: '400' },
        fixed_width: { url: 'https://media.giphy.com/media/gif2/200w.gif', width: '200', height: '200' },
      },
    },
  ],
  meta: { status: 200, msg: 'OK' },
};

function createTestStore(overrides?: Record<string, unknown>) {
  const defaultState = {
    channels: {
      channels: {
        ch1: { id: 'ch1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      },
      selectedChannelId: 'ch1',
    },
    guilds: {
      guilds: { g1: { id: 'g1', name: 'Test Guild', icon: null, owner_id: 'u1', member_count: 1 } },
      selectedGuildId: 'g1',
    },
    members: {
      membersByGuild: { g1: [] },
      isLoading: false,
    },
    auth: {
      user: { id: 'u1', username: 'alice', avatar: null },
      token: 'test-token',
      isAuthenticated: true, status: 'online' as const, customStatus: null,
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
    },
    messages: {
      messagesByChannel: {},
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
      search: searchSlice.reducer,
      settings: settingsSlice.reducer,
      typing: typingSlice.reducer,
    },
    preloadedState: defaultState as Record<string, never>,
  });
}

function renderWithStore(ui: React.ReactElement, overrides?: Record<string, unknown>) {
  const store = createTestStore(overrides);
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe('GifPicker', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('VITE_GIPHY_API_KEY', 'test-key');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_GIPHY_RESPONSE),
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('renders without crashing', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'GIF picker' })).toBeInTheDocument();
  });

  it('renders search input', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByPlaceholderText('Search GIPHY')).toBeInTheDocument();
  });

  it('renders GIPHY branding', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText('Powered by GIPHY')).toBeInTheDocument();
  });

  it('fetches trending GIFs on mount', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('trending')
      );
    });
  });

  it('renders GIF results after fetch', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'GIF results' })).toBeInTheDocument();
    });

    const gifItems = screen.getAllByRole('option');
    expect(gifItems).toHaveLength(2);
  });

  it('calls onSelect with full GIF URL when a GIF is clicked', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'GIF results' })).toBeInTheDocument();
    });

    const firstGif = screen.getAllByRole('option')[0];
    if (firstGif) {
      fireEvent.click(firstGif);
    }

    expect(onSelect).toHaveBeenCalledWith('https://media.giphy.com/media/gif1/giphy.gif');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error state when fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load GIFs. Please try again.')).toBeInTheDocument();
    });
  });

  it('shows clear button when search has text', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<GifPicker onSelect={onSelect} onClose={onClose} />);

    const searchInput = screen.getByPlaceholderText('Search GIPHY');
    fireEvent.change(searchInput, { target: { value: 'cats' } });

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });
});

describe('MessageInput - GIF picker integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_GIPHY_API_KEY', 'test-key');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_GIPHY_RESPONSE),
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('opens GIF picker when GIF button is clicked', async () => {
    renderWithStore(<MessageInput channelId="ch1" />);

    const gifButton = screen.getByRole('button', { name: 'Open GIF picker' });
    fireEvent.click(gifButton);

    expect(screen.getByRole('dialog', { name: 'GIF picker' })).toBeInTheDocument();
  });

  it('closes GIF picker when GIF button is clicked again', async () => {
    renderWithStore(<MessageInput channelId="ch1" />);

    const gifButton = screen.getByRole('button', { name: 'Open GIF picker' });
    fireEvent.click(gifButton);
    expect(screen.getByRole('dialog', { name: 'GIF picker' })).toBeInTheDocument();

    fireEvent.click(gifButton);
    expect(screen.queryByRole('dialog', { name: 'GIF picker' })).not.toBeInTheDocument();
  });

  it('does not show Coming Soon placeholder anymore', async () => {
    renderWithStore(<MessageInput channelId="ch1" />);

    const gifButton = screen.getByRole('button', { name: 'Open GIF picker' });
    fireEvent.click(gifButton);

    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
  });

  it('shows search input inside GIF picker', async () => {
    renderWithStore(<MessageInput channelId="ch1" />);

    const gifButton = screen.getByRole('button', { name: 'Open GIF picker' });
    fireEvent.click(gifButton);

    expect(screen.getByPlaceholderText('Search GIPHY')).toBeInTheDocument();
  });
});
