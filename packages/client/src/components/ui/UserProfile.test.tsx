import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { UserProfile } from './UserProfile';
import { relationshipsSlice, RelationshipType } from '../../stores/relationshipsSlice';
import { presenceSlice } from '../../stores/presenceSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { membersSlice } from '../../stores/membersSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { authSlice } from '../../stores/authSlice';
import { api } from '../../api/rest';

vi.mock('../../api/rest', () => ({
  api: {
    getUserProfile: vi.fn(),
  },
}));

const mockGetUserProfile = vi.mocked(api.getUserProfile);

function createTestStore() {
  const store = configureStore({
    reducer: {
      relationships: relationshipsSlice.reducer,
      presence: presenceSlice.reducer,
      guilds: guildsSlice.reducer,
      members: membersSlice.reducer,
      roles: rolesSlice.reducer,
      auth: authSlice.reducer,
    },
  });
  store.dispatch(
    relationshipsSlice.actions.setRelationships([
      {
        id: '100',
        type: RelationshipType.FRIEND,
        user: { id: '200', username: 'TestUser', avatar: null, display_name: 'Test User' },
      },
    ]),
  );
  return store;
}

describe('UserProfile', () => {
  beforeEach(() => {
    mockGetUserProfile.mockResolvedValue({
      id: '200',
      username: 'TestUser',
      global_name: 'Test User',
      avatar: null,
      banner: null,
      bio: null,
      accent_color: null,
      pronouns: '',
      mutual_guilds: [],
      mutual_friends_count: 0,
    });
  });

  it('renders without crashing', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByRole('dialog', { name: /test user profile/i })).toBeInTheDocument();
  });

  it('displays username and display name', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('TestUser')).toBeInTheDocument();
  });

  it('shows avatar fallback initial when no avatar', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Close profile'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Member Since section', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Member Since')).toBeInTheDocument();
  });

  it('shows Note section with textarea', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Click to add a note')).toBeInTheDocument();
  });

  it('calls onClose when overlay background is clicked', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    const overlay = screen.getByRole('dialog', { name: /test user profile/i });
    // Click on the overlay (not the card itself)
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows ESC hint', () => {
    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('ESC')).toBeInTheDocument();
  });

  it('fetches and displays mutual servers from API', async () => {
    mockGetUserProfile.mockResolvedValue({
      id: '200',
      username: 'TestUser',
      global_name: 'Test User',
      avatar: null,
      banner: null,
      bio: 'Hello world',
      accent_color: null,
      pronouns: '',
      mutual_guilds: [
        { id: '9001', name: 'Cool Server', icon: null },
        { id: '9002', name: 'Another Server', icon: null },
      ],
      mutual_friends_count: 5,
    });

    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );

    expect(mockGetUserProfile).toHaveBeenCalledWith('200');

    await waitFor(() => {
      expect(screen.getByText(/Mutual Servers/)).toBeInTheDocument();
    });

    expect(screen.getByText('Cool Server')).toBeInTheDocument();
    expect(screen.getByText('Another Server')).toBeInTheDocument();
  });

  it('fetches and displays mutual friends count from API', async () => {
    mockGetUserProfile.mockResolvedValue({
      id: '200',
      username: 'TestUser',
      global_name: 'Test User',
      avatar: null,
      banner: null,
      bio: null,
      accent_color: null,
      pronouns: '',
      mutual_guilds: [],
      mutual_friends_count: 3,
    });

    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Mutual Friends -- 3/)).toBeInTheDocument();
    });
  });

  it('displays bio from API when available', async () => {
    mockGetUserProfile.mockResolvedValue({
      id: '200',
      username: 'TestUser',
      global_name: 'Test User',
      avatar: null,
      banner: null,
      bio: 'This is my bio',
      accent_color: null,
      pronouns: '',
      mutual_guilds: [],
      mutual_friends_count: 0,
    });

    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('About Me')).toBeInTheDocument();
    });
    expect(screen.getByText('This is my bio')).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    mockGetUserProfile.mockRejectedValue(new Error('Network error'));

    const onClose = vi.fn();
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserProfile userId="200" onClose={onClose} />
      </Provider>,
    );

    // Should still render the basic profile without crashing
    expect(screen.getByRole('dialog', { name: /test user profile/i })).toBeInTheDocument();
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });
});
