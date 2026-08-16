import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { FriendsPage } from './FriendsPage';
import { relationshipsSlice, RelationshipType } from '../../stores/relationshipsSlice';
import { dmSlice } from '../../stores/dmSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';
import { presenceSlice } from '../../stores/presenceSlice';
import { uiSlice } from '../../stores/uiSlice';
import { api } from '../../api/rest';

// Mock the API module
vi.mock('../../api/rest', () => ({
  api: {
    getRelationships: vi.fn().mockResolvedValue([]),
    sendFriendRequest: vi.fn().mockResolvedValue(undefined),
    acceptFriendRequest: vi.fn().mockResolvedValue(undefined),
    removeRelationship: vi.fn().mockResolvedValue(undefined),
    blockUser: vi.fn().mockResolvedValue(undefined),
    createDm: vi.fn().mockResolvedValue({
      id: '999',
      type: 1,
      recipients: [{ id: '200', username: 'TestUser', avatar: null }],
      last_message_id: null,
    }),
  },
}));

const mockApi = api as unknown as {
  getRelationships: ReturnType<typeof vi.fn>;
  sendFriendRequest: ReturnType<typeof vi.fn>;
  acceptFriendRequest: ReturnType<typeof vi.fn>;
  removeRelationship: ReturnType<typeof vi.fn>;
  blockUser: ReturnType<typeof vi.fn>;
  createDm: ReturnType<typeof vi.fn>;
};

const mockFriend = {
  id: '100',
  type: RelationshipType.FRIEND,
  user: { id: '200', username: 'FriendUser', avatar: null },
};

const mockIncoming = {
  id: '101',
  type: RelationshipType.INCOMING_REQUEST,
  user: { id: '201', username: 'IncomingUser', avatar: null },
};

const mockOutgoing = {
  id: '103',
  type: RelationshipType.OUTGOING_REQUEST,
  user: { id: '203', username: 'OutgoingUser', avatar: null },
};

const mockBlocked = {
  id: '102',
  type: RelationshipType.BLOCKED,
  user: { id: '202', username: 'BlockedUser', avatar: null },
};

function createTestStore() {
  return configureStore({
    reducer: {
      relationships: relationshipsSlice.reducer,
      dm: dmSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
      presence: presenceSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
}

function renderWithProviders(
  ui: React.ReactElement,
  store: ReturnType<typeof createTestStore>,
) {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </Provider>,
  );
}

describe('FriendsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRelationships.mockResolvedValue([]);
  });

  it('renders without crashing', async () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);
    expect(screen.getByText('Friends')).toBeInTheDocument();
  });

  it('renders always-visible tab buttons', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    expect(screen.getByRole('tab', { name: /online/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /add friend/i })).toBeInTheDocument();
  });

  it('hides Pending tab when no pending requests', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    expect(screen.queryByRole('tab', { name: /pending/i })).not.toBeInTheDocument();
  });

  it('hides Blocked tab when no blocked users', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    expect(screen.queryByRole('tab', { name: /blocked/i })).not.toBeInTheDocument();
  });

  it('defaults to Online tab', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    const onlineTab = screen.getByRole('tab', { name: /online/i });
    expect(onlineTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows empty state message when no friends', async () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    await waitFor(() => {
      expect(screen.getByText('No one is online right now.')).toBeInTheDocument();
    });
  });

  it('switches tabs on click', async () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    const allTab = screen.getByRole('tab', { name: /^all$/i });
    fireEvent.click(allTab);
    expect(allTab).toHaveAttribute('aria-selected', 'true');

    await waitFor(() => {
      expect(screen.getByText("You don't have any friends yet.")).toBeInTheDocument();
    });
  });

  it('shows blocked empty state via initialTab', async () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="blocked" />, store);

    await waitFor(() => {
      expect(screen.getByText("You haven't blocked anyone.")).toBeInTheDocument();
    });
  });

  it('shows pending empty state via initialTab', async () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="pending" />, store);

    await waitFor(() => {
      expect(screen.getByText('There are no pending friend requests.')).toBeInTheDocument();
    });
  });

  it('renders friends in All tab', async () => {
    mockApi.getRelationships.mockResolvedValue([mockFriend]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="all" />, store);

    await waitFor(() => {
      expect(screen.getByText('FriendUser')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Message FriendUser')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove FriendUser')).toBeInTheDocument();
  });

  it('renders incoming pending requests with Accept and Decline buttons', async () => {
    mockApi.getRelationships.mockResolvedValue([mockIncoming]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="pending" />, store);

    await waitFor(() => {
      expect(screen.getByText('IncomingUser')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Accept IncomingUser')).toBeInTheDocument();
    expect(screen.getByLabelText('Decline IncomingUser')).toBeInTheDocument();
  });

  it('accepting an incoming request calls the API and updates state', async () => {
    const incoming = {
      id: '101',
      type: RelationshipType.INCOMING_REQUEST,
      user: { id: '201', username: 'IncomingUser', avatar: null },
    };
    const nowFriend = {
      id: '101',
      type: RelationshipType.FRIEND,
      user: { id: '201', username: 'IncomingUser', avatar: null },
    };
    // Mount fetch returns the pending request; the post-accept re-fetch returns
    // the same relationship now flipped to FRIEND.
    mockApi.getRelationships.mockResolvedValueOnce([incoming]);
    mockApi.getRelationships.mockResolvedValueOnce([nowFriend]);
    mockApi.acceptFriendRequest.mockResolvedValue(undefined);

    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="pending" />, store);

    await waitFor(() => {
      expect(screen.getByText('IncomingUser')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Accept IncomingUser'));

    // Accept is wired to the REST accept call with the requester's user id...
    await waitFor(() => {
      expect(mockApi.acceptFriendRequest).toHaveBeenCalledWith('201');
    });

    // ...and state is refreshed so the request no longer appears as pending.
    await waitFor(() => {
      expect(screen.getByText('There are no pending friend requests.')).toBeInTheDocument();
    });
  });

  it('declining an incoming request calls remove and updates state', async () => {
    const incoming = {
      id: '101',
      type: RelationshipType.INCOMING_REQUEST,
      user: { id: '201', username: 'IncomingUser', avatar: null },
    };
    mockApi.getRelationships.mockResolvedValueOnce([incoming]);
    mockApi.removeRelationship.mockResolvedValue(undefined);

    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="pending" />, store);

    await waitFor(() => {
      expect(screen.getByText('IncomingUser')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Decline IncomingUser'));

    await waitFor(() => {
      expect(mockApi.removeRelationship).toHaveBeenCalledWith('201');
    });
    await waitFor(() => {
      expect(screen.getByText('There are no pending friend requests.')).toBeInTheDocument();
    });
  });

  it('renders outgoing pending requests with Cancel button', async () => {
    mockApi.getRelationships.mockResolvedValue([mockOutgoing]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="pending" />, store);

    await waitFor(() => {
      expect(screen.getByText('OutgoingUser')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Cancel request to OutgoingUser')).toBeInTheDocument();
  });

  it('renders blocked users with Unblock button', async () => {
    mockApi.getRelationships.mockResolvedValue([mockBlocked]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="blocked" />, store);

    await waitFor(() => {
      expect(screen.getByText('BlockedUser')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Unblock BlockedUser')).toBeInTheDocument();
  });

  it('shows Add Friend form with username input and button', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="add" />, store);

    expect(screen.getByText('ADD FRIEND')).toBeInTheDocument();
    expect(screen.getByText('You can add friends with their Relay username.')).toBeInTheDocument();
    expect(screen.getByLabelText('Add friend by username')).toBeInTheDocument();
    expect(screen.getByText('Send Friend Request')).toBeInTheDocument();
  });

  it('disables Send Friend Request button when input is empty', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="add" />, store);

    const button = screen.getByText('Send Friend Request');
    expect(button).toBeDisabled();
  });

  it('enables Send Friend Request button when input has text', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="add" />, store);

    const input = screen.getByLabelText('Add friend by username');
    fireEvent.change(input, { target: { value: 'johndoe' } });

    const button = screen.getByText('Send Friend Request');
    expect(button).not.toBeDisabled();
  });

  it('sends friend request by username and shows success message', async () => {
    mockApi.sendFriendRequest.mockResolvedValue(undefined);
    mockApi.getRelationships.mockResolvedValue([]);
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="add" />, store);

    const input = screen.getByLabelText('Add friend by username');
    fireEvent.change(input, { target: { value: 'johndoe' } });
    fireEvent.click(screen.getByText('Send Friend Request'));

    await waitFor(() => {
      expect(mockApi.sendFriendRequest).toHaveBeenCalledWith('johndoe');
    });

    await waitFor(() => {
      expect(screen.getByText('Success! Your friend request to johndoe was sent.')).toBeInTheDocument();
    });
  });

  it('shows error message when friend request fails', async () => {
    mockApi.sendFriendRequest.mockRejectedValue({
      detail: { message: "Hm, that didn't work. Double-check that the username is correct." },
    });
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="add" />, store);

    const input = screen.getByLabelText('Add friend by username');
    fireEvent.change(input, { target: { value: 'nonexistent' } });
    fireEvent.click(screen.getByText('Send Friend Request'));

    await waitFor(() => {
      expect(screen.getByText("Hm, that didn't work. Double-check that the username is correct.")).toBeInTheDocument();
    });
  });

  it('submits friend request on Enter key', async () => {
    mockApi.sendFriendRequest.mockResolvedValue(undefined);
    mockApi.getRelationships.mockResolvedValue([]);
    const store = createTestStore();
    renderWithProviders(<FriendsPage initialTab="add" />, store);

    const input = screen.getByLabelText('Add friend by username');
    fireEvent.change(input, { target: { value: 'johndoe' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApi.sendFriendRequest).toHaveBeenCalledWith('johndoe');
    });
  });

  it('shows pending badge count in tab', async () => {
    mockApi.getRelationships.mockResolvedValue([mockIncoming, mockOutgoing]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage />, store);

    await waitFor(() => {
      const pendingTab = screen.getByRole('tab', { name: /pending/i });
      expect(within(pendingTab).getByText('2')).toBeInTheDocument();
    });
  });

  it('shows Incoming and Outgoing section headers in Pending tab', async () => {
    mockApi.getRelationships.mockResolvedValue([mockIncoming, mockOutgoing]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="pending" />, store);

    await waitFor(() => {
      expect(screen.getByText(/^Incoming \u2014/)).toBeInTheDocument();
      expect(screen.getByText(/^Outgoing \u2014/)).toBeInTheDocument();
    });
  });

  it('renders avatar fallback with first letter of username', async () => {
    mockApi.getRelationships.mockResolvedValue([mockFriend]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="all" />, store);

    await waitFor(() => {
      expect(screen.getByText('F')).toBeInTheDocument();
    });
  });

  it('has proper accessibility attributes', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    expect(screen.getByRole('main', { name: /friends/i })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /friends tabs/i })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('calls getRelationships on mount', () => {
    const store = createTestStore();
    renderWithProviders(<FriendsPage />, store);

    expect(mockApi.getRelationships).toHaveBeenCalledTimes(1);
  });

  it('displays display_name and username separately when both exist', async () => {
    const friendWithDisplayName = {
      id: '104',
      type: RelationshipType.FRIEND,
      user: { id: '204', username: 'cooluser', avatar: null, display_name: 'Cool User' },
    };
    mockApi.getRelationships.mockResolvedValue([friendWithDisplayName]);
    const store = createTestStore();

    renderWithProviders(<FriendsPage initialTab="all" />, store);

    await waitFor(() => {
      expect(screen.getByText('Cool User')).toBeInTheDocument();
      expect(screen.getByText('cooluser')).toBeInTheDocument();
    });
  });
});
