import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { DMList } from './DMList';
import { dmSlice } from '../../stores/dmSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { authSlice } from '../../stores/authSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { presenceSlice } from '../../stores/presenceSlice';

const mockGetDmChannels = vi.fn();
const mockCreateDm = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getDmChannels: () => mockGetDmChannels(),
    createDm: (...args: unknown[]) => mockCreateDm(...args),
  },
}));

function createTestStore(dmChannels: Array<{
  id: string;
  type: number;
  recipients: Array<{ id: string; username: string; avatar: string | null }>;
  last_message_id: string | null;
}> = []) {
  return configureStore({
    reducer: {
      dm: dmSlice.reducer,
      channels: channelsSlice.reducer,
      notifications: notificationsSlice.reducer,
      auth: authSlice.reducer,
      voice: voiceSlice.reducer,
      presence: presenceSlice.reducer,
    },
    preloadedState: {
      dm: {
        dmChannels,
        selectedDmChannelId: null,
      },
      channels: {
        channels: {},
        selectedChannelId: null,
      },
      notifications: {
        unreadByChannel: {},
        mentionsByChannel: {},
      },
      auth: {
        token: 'test-token',
        user: { id: '1', username: 'TestUser', avatar: null, email: 'test@test.com' },
        isAuthenticated: true, status: 'online' as const, customStatus: null,
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
        speakingUsers: [],
        voiceUsersByChannel: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
        voiceChannelStatuses: {},
      },
      presence: {
        presences: {},
        selfStatus: 'online' as const,
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

describe('DMList', () => {
  const onOpenSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDmChannels.mockResolvedValue([]);
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the search input placeholder', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    expect(screen.getByPlaceholderText('Find or start a conversation')).toBeInTheDocument();
  });

  it('renders the Friends nav item', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    expect(screen.getByText('Friends')).toBeInTheDocument();
  });

  it('renders the Direct Messages section header', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    expect(screen.getByText('Direct Messages')).toBeInTheDocument();
  });

  it('renders DM channels from store', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
      { id: 'dm2', type: 1, recipients: [{ id: '11', username: 'Bob', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('selects a DM channel on click', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Alice'));
    expect(store.getState().dm.selectedDmChannelId).toBe('dm1');
  });

  it('shows close button and removes DM on click', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    const closeBtn = screen.getByLabelText('Close DM with Alice');
    fireEvent.click(closeBtn);
    expect(store.getState().dm.dmChannels).toHaveLength(0);
  });

  it('renders avatar fallback with first letter', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Zara', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  // Search functionality tests
  it('filters DM list as user types in search', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
      { id: 'dm2', type: 1, recipients: [{ id: '11', username: 'Bob', avatar: null }], last_message_id: null },
      { id: 'dm3', type: 1, recipients: [{ id: '12', username: 'Charlie', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );

    const searchInput = screen.getByPlaceholderText('Find or start a conversation');
    fireEvent.change(searchInput, { target: { value: 'Ali' } });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.queryByText('Charlie')).toBeNull();
  });

  it('shows all DMs when search is empty', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
      { id: 'dm2', type: 1, recipients: [{ id: '11', username: 'Bob', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );

    const searchInput = screen.getByPlaceholderText('Find or start a conversation');
    fireEvent.change(searchInput, { target: { value: 'Alice' } });
    expect(screen.queryByText('Bob')).toBeNull();

    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows start conversation option when username is not in DM list', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );

    const searchInput = screen.getByPlaceholderText('Find or start a conversation');
    fireEvent.change(searchInput, { target: { value: 'NewUser' } });

    expect(screen.getByLabelText('Start a conversation with NewUser')).toBeInTheDocument();
  });

  it('search is case-insensitive', () => {
    const dmChannels = [
      { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
    ];
    const store = createTestStore(dmChannels);
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );

    const searchInput = screen.getByPlaceholderText('Find or start a conversation');
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('search input is editable (not readonly)', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <DMList onOpenSettings={onOpenSettings} />
      </Provider>,
    );
    const searchInput = screen.getByPlaceholderText('Find or start a conversation');
    expect(searchInput).not.toHaveAttribute('readonly');
  });
});
