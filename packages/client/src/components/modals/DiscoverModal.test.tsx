import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { DiscoverModal } from './DiscoverModal';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';

const mockDiscoverGuilds = vi.fn();
const mockJoinDiscoverableGuild = vi.fn();
const mockGetGuildChannels = vi.fn();
const mockGetGuild = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    discoverGuilds: (...args: unknown[]) => mockDiscoverGuilds(...args),
    joinDiscoverableGuild: (...args: unknown[]) => mockJoinDiscoverableGuild(...args),
    getGuildChannels: (...args: unknown[]) => mockGetGuildChannels(...args),
    getGuild: (...args: unknown[]) => mockGetGuild(...args),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: {},
        selectedGuildId: null,
        folders: [],
      },
      channels: {
        channels: {},
        selectedChannelId: null,
      },
    },
  });
}

function renderModal(store: ReturnType<typeof createTestStore>, onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <Provider store={store}>
        <MemoryRouter>
          <DiscoverModal onClose={onClose} />
        </MemoryRouter>
      </Provider>,
    ),
  };
}

describe('DiscoverModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGuildChannels.mockResolvedValue([]);
  });

  it('renders without crashing', () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    const { container } = renderModal(store);
    expect(container).toBeTruthy();
  });

  it('renders the title and search box', () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderModal(store);
    expect(screen.getByText('Discover Servers')).toBeInTheDocument();
    expect(screen.getByLabelText('Search public servers')).toBeInTheDocument();
  });

  it('calls api.discoverGuilds on mount', async () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderModal(store);
    await waitFor(() => {
      expect(mockDiscoverGuilds).toHaveBeenCalledWith(undefined);
    });
  });

  it('shows the empty state when no servers are returned', async () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderModal(store);
    await waitFor(() => {
      expect(screen.getByText('No public servers found yet.')).toBeInTheDocument();
    });
  });

  it('renders a card for each discovered guild', async () => {
    mockDiscoverGuilds.mockResolvedValue([
      { id: 'g1', name: 'Cool Server', icon: null, description: 'A cool place', member_count: 42 },
    ]);
    const store = createTestStore();
    renderModal(store);
    await waitFor(() => {
      expect(screen.getByText('Cool Server')).toBeInTheDocument();
    });
    expect(screen.getByText('A cool place')).toBeInTheDocument();
    expect(screen.getByText('42 members')).toBeInTheDocument();
  });

  it('debounces search input and re-queries with the query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    renderModal(store);

    await vi.waitFor(() => expect(mockDiscoverGuilds).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('Search public servers');
    fireEvent.change(input, { target: { value: 'gaming' } });

    // Not called again until the debounce timer fires
    expect(mockDiscoverGuilds).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);

    await vi.waitFor(() => {
      expect(mockDiscoverGuilds).toHaveBeenCalledWith({ query: 'gaming' });
    });

    vi.useRealTimers();
  });

  it('joins a guild, adds it to the store, and closes the modal', async () => {
    mockDiscoverGuilds.mockResolvedValue([
      { id: 'g1', name: 'Cool Server', icon: null, description: null, member_count: 5 },
    ]);
    mockJoinDiscoverableGuild.mockResolvedValue({
      id: 'g1', name: 'Cool Server', icon: null, owner_id: 'owner-1', description: null,
    });
    const store = createTestStore();
    const { onClose } = renderModal(store);

    await waitFor(() => {
      expect(screen.getByText('Cool Server')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      expect(mockJoinDiscoverableGuild).toHaveBeenCalledWith('g1');
    });

    await waitFor(() => {
      expect(store.getState().guilds.guilds['g1']).toBeTruthy();
    });
    expect(store.getState().guilds.selectedGuildId).toBe('g1');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error message when joining fails', async () => {
    mockDiscoverGuilds.mockResolvedValue([
      { id: 'g1', name: 'Cool Server', icon: null, description: null, member_count: 5 },
    ]);
    mockJoinDiscoverableGuild.mockRejectedValue({ message: 'This server is not open to public joining.' });
    const store = createTestStore();
    renderModal(store);

    await waitFor(() => {
      expect(screen.getByText('Cool Server')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      expect(screen.getByText('This server is not open to public joining.')).toBeInTheDocument();
    });
  });

  it('still navigates when the join fails because the user is already a member', async () => {
    mockDiscoverGuilds.mockResolvedValue([
      { id: 'g1', name: 'Cool Server', icon: null, description: null, member_count: 5 },
    ]);
    mockJoinDiscoverableGuild.mockRejectedValue({ code: 30001, message: 'Resource already exists' });
    mockGetGuild.mockResolvedValue({ id: 'g1', name: 'Cool Server', icon: null, owner_id: 'owner-1', member_count: 5 });
    const store = createTestStore();
    const { onClose } = renderModal(store);

    await waitFor(() => {
      expect(screen.getByText('Cool Server')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => {
      expect(mockGetGuild).toHaveBeenCalledWith('g1');
    });
    await waitFor(() => {
      expect(store.getState().guilds.guilds['g1']).toBeTruthy();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Close button is clicked', async () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    const { onClose } = renderModal(store);
    await waitFor(() => expect(mockDiscoverGuilds).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    const { onClose } = renderModal(store);
    await waitFor(() => expect(mockDiscoverGuilds).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    mockDiscoverGuilds.mockResolvedValue([]);
    const store = createTestStore();
    const { onClose } = renderModal(store);
    await waitFor(() => expect(mockDiscoverGuilds).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
