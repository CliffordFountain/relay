import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { CreateForumPost } from './CreateForumPost';
import { forumSlice } from '../../stores/forumSlice';
import { uiSlice } from '../../stores/uiSlice';
import { authSlice } from '../../stores/authSlice';

const mockCreateForumPost = vi.fn();
const mockGetForumTags = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    createForumPost: (...args: unknown[]) => mockCreateForumPost(...args),
    getForumTags: (...args: unknown[]) => mockGetForumTags(...args),
  },
}));

function createTestStore(options?: {
  tags?: Array<{ id: string; name: string; emoji_name?: string }>;
}) {
  return configureStore({
    reducer: {
      forum: forumSlice.reducer,
      ui: uiSlice.reducer,
      auth: authSlice.reducer,
    },
    preloadedState: {
      forum: {
        byChannel: {
          'forum-1': {
            posts: [],
            hasMore: false,
            isLoading: false,
            sortOrder: 'latest_activity' as const,
            layout: 'list' as const,
            activeTagFilter: null,
            tags: options?.tags ?? [],
          },
        },
      },
      ui: {
        activeModal: 'createForumPost',
        modalProps: { channelId: 'forum-1' },
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
      },
      auth: {
        user: { id: 'user-1', username: 'testuser', avatar: null, email: 'test@test.com', global_name: null, bio: null, accent_color: null, pronouns: '' },
        token: 'test-token',
        isAuthenticated: true, status: 'online' as const, customStatus: null,
      },
    },
  });
}

describe('CreateForumPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetForumTags.mockResolvedValue([]);
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the Create Post title', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByText('Create Post')).toBeInTheDocument();
  });

  it('renders title and content inputs', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/content/i)).toBeInTheDocument();
  });

  it('disables Post button when title or content is empty', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    const postBtn = screen.getByRole('button', { name: /^post$/i });
    expect(postBtn).toBeDisabled();
  });

  it('enables Post button when both title and content are filled', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My Post' } });
    fireEvent.change(screen.getByLabelText(/content/i), { target: { value: 'Some content' } });
    const postBtn = screen.getByRole('button', { name: /^post$/i });
    expect(postBtn).not.toBeDisabled();
  });

  it('calls api.createForumPost on submit', async () => {
    mockCreateForumPost.mockResolvedValue({ id: 'thread-1', type: 11, guild_id: 'guild-1' });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My Post' } });
    fireEvent.change(screen.getByLabelText(/content/i), { target: { value: 'Some content' } });
    fireEvent.click(screen.getByRole('button', { name: /^post$/i }));

    await waitFor(() => {
      expect(mockCreateForumPost).toHaveBeenCalledWith('forum-1', {
        name: 'My Post',
        message: { content: 'Some content' },
        applied_tags: [],
      });
    });
  });

  it('closes modal after successful post creation', async () => {
    mockCreateForumPost.mockResolvedValue({ id: 'thread-1', type: 11, guild_id: 'guild-1' });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My Post' } });
    fireEvent.change(screen.getByLabelText(/content/i), { target: { value: 'Some content' } });
    fireEvent.click(screen.getByRole('button', { name: /^post$/i }));

    await waitFor(() => {
      expect(store.getState().ui.activeModal).toBeNull();
    });
  });

  it('shows error on API failure', async () => {
    mockCreateForumPost.mockRejectedValue({ message: 'Failed to create thread' });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My Post' } });
    fireEvent.change(screen.getByLabelText(/content/i), { target: { value: 'Some content' } });
    fireEvent.click(screen.getByRole('button', { name: /^post$/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to create thread')).toBeInTheDocument();
    });
  });

  it('does not offer tag selection (tags do not persist server-side)', () => {
    const store = createTestStore({
      tags: [
        { id: 'tag-1', name: 'Bug' },
        { id: 'tag-2', name: 'Feature' },
      ],
    });
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    expect(screen.queryByText('Bug')).not.toBeInTheDocument();
    expect(screen.queryByText('Feature')).not.toBeInTheDocument();
  });

  it('closes modal when Cancel is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('closes modal when Escape is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(store.getState().ui.activeModal).toBeNull();
  });

  it('closes modal when overlay backdrop is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <CreateForumPost channelId="forum-1" />
      </Provider>,
    );
    // Click on the overlay directly (not the modal content)
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(store.getState().ui.activeModal).toBeNull();
  });
});
