import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { CreateGroupDMModal } from './CreateGroupDMModal';
import { uiSlice } from '../../stores/uiSlice';
import { relationshipsSlice, RelationshipType } from '../../stores/relationshipsSlice';
import { dmSlice } from '../../stores/dmSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { authSlice } from '../../stores/authSlice';

const mockCreateDm = vi.fn();
const mockCreateGroupDm = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    createDm: (...args: unknown[]) => mockCreateDm(...args),
    createGroupDm: (...args: unknown[]) => mockCreateGroupDm(...args),
  },
}));

function createTestStore(friends: Array<{ id: string; username: string; avatar: string | null; display_name?: string }> = []) {
  const relationships: Record<string, { id: string; type: number; user: { id: string; username: string; avatar: string | null; display_name?: string } }> = {};
  for (const f of friends) {
    relationships[f.id] = {
      id: f.id,
      type: RelationshipType.FRIEND,
      user: f,
    };
  }

  return configureStore({
    reducer: {
      ui: uiSlice.reducer,
      relationships: relationshipsSlice.reducer,
      dm: dmSlice.reducer,
      channels: channelsSlice.reducer,
      notifications: notificationsSlice.reducer,
      auth: authSlice.reducer,
    },
    preloadedState: {
      ui: {
        activeModal: 'createGroupDM',
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
        inboxPanelOpen: false,
        inboxPanelTab: 'forYou' as const,
      },
      relationships: {
        relationships,
        isLoading: false,
      },
      dm: {
        dmChannels: [],
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
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
      },
    },
  });
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      {ui}
    </MemoryRouter>
  );
}

describe('CreateGroupDMModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the title "Select Friends"', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Select Friends')).toBeInTheDocument();
  });

  it('renders search input', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByPlaceholderText('Type the username of a friend')).toBeInTheDocument();
  });

  it('renders friends list from relationships', () => {
    const friends = [
      { id: '10', username: 'Alice', avatar: null },
      { id: '11', username: 'Bob', avatar: null },
    ];
    const store = createTestStore(friends);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bob').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no friends', () => {
    const store = createTestStore([]);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('You have no friends to add.')).toBeInTheDocument();
  });

  it('disables Create DM button when no friends selected', () => {
    const friends = [{ id: '10', username: 'Alice', avatar: null }];
    const store = createTestStore(friends);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    const createBtn = screen.getByRole('button', { name: /Create DM/i });
    expect(createBtn).toBeDisabled();
  });

  it('enables Create DM button when a friend is selected', () => {
    const friends = [{ id: '10', username: 'Alice', avatar: null }];
    const store = createTestStore(friends);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getAllByText('Alice')[0]!);
    const createBtn = screen.getByRole('button', { name: /Create DM/i });
    expect(createBtn).not.toBeDisabled();
  });

  it('toggles friend selection on click', () => {
    const friends = [{ id: '10', username: 'Alice', avatar: null }];
    const store = createTestStore(friends);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    // Select - click the friend option item
    const friendOption = screen.getByRole('option', { name: /alice/i });
    fireEvent.click(friendOption);
    expect(screen.getByRole('button', { name: /Create DM/i })).not.toBeDisabled();
    // Deselect - click the friend option item again
    fireEvent.click(friendOption);
    expect(screen.getByRole('button', { name: /Create DM/i })).toBeDisabled();
  });

  it('changes button text to "Create Group DM" when 2+ friends selected', () => {
    const friends = [
      { id: '10', username: 'Alice', avatar: null },
      { id: '11', username: 'Bob', avatar: null },
    ];
    const store = createTestStore(friends);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getAllByText('Alice')[0]!);
    fireEvent.click(screen.getAllByText('Bob')[0]!);
    expect(screen.getByRole('button', { name: /Create Group DM/i })).toBeInTheDocument();
  });

  it('filters friends by search query', () => {
    const friends = [
      { id: '10', username: 'Alice', avatar: null },
      { id: '11', username: 'Bob', avatar: null },
    ];
    const store = createTestStore(friends);
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    const searchInput = screen.getByPlaceholderText('Type the username of a friend');
    fireEvent.change(searchInput, { target: { value: 'Ali' } });
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('calls createDm for single friend selection', async () => {
    const friends = [{ id: '10', username: 'Alice', avatar: null }];
    const store = createTestStore(friends);
    const mockChannel = { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null };
    mockCreateDm.mockResolvedValue(mockChannel);

    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );

    fireEvent.click(screen.getAllByText('Alice')[0]!);
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockCreateDm).toHaveBeenCalledWith('10');
    });
  });

  it('calls createGroupDm for multiple friend selection', async () => {
    const friends = [
      { id: '10', username: 'Alice', avatar: null },
      { id: '11', username: 'Bob', avatar: null },
    ];
    const store = createTestStore(friends);
    const mockChannel = { id: 'dm2', type: 3, recipients: [{ id: '10', username: 'Alice', avatar: null }, { id: '11', username: 'Bob', avatar: null }], last_message_id: null };
    mockCreateGroupDm.mockResolvedValue(mockChannel);

    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );

    fireEvent.click(screen.getAllByText('Alice')[0]!);
    fireEvent.click(screen.getAllByText('Bob')[0]!);
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockCreateGroupDm).toHaveBeenCalledWith(['10', '11']);
    });
  });

  it('closes modal when Escape is pressed', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('closes modal when backdrop is clicked', () => {
    const store = createTestStore();
    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('shows error message on API failure', async () => {
    const friends = [{ id: '10', username: 'Alice', avatar: null }];
    const store = createTestStore(friends);
    mockCreateDm.mockRejectedValue({ message: 'User not found' });

    renderWithRouter(
      <Provider store={store}>
        <CreateGroupDMModal onClose={onClose} />
      </Provider>,
    );

    fireEvent.click(screen.getAllByText('Alice')[0]!);
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText('User not found')).toBeInTheDocument();
    });
  });
});
