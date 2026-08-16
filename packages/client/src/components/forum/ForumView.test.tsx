import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ForumView } from './ForumView';
import { forumSlice } from '../../stores/forumSlice';
import { uiSlice } from '../../stores/uiSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';

const mockGetForumThreads = vi.fn();
const mockGetForumTags = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getForumThreads: (...args: unknown[]) => mockGetForumThreads(...args),
    getForumTags: (...args: unknown[]) => mockGetForumTags(...args),
  },
}));

function createTestStore(options?: {
  forumPosts?: Parameters<typeof forumSlice.reducer>[0];
}) {
  return configureStore({
    reducer: {
      forum: forumSlice.reducer,
      ui: uiSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
    },
    preloadedState: {
      forum: options?.forumPosts ?? { byChannel: {} },
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
      },
      channels: { channels: {}, selectedChannelId: null },
      auth: { user: null, token: null, isAuthenticated: false, status: 'online' as const, customStatus: null },
    },
  });
}

describe('ForumView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetForumThreads.mockResolvedValue({ threads: [], has_more: false });
    mockGetForumTags.mockResolvedValue([]);
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the forum channel name', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    expect(screen.getByText('feedback')).toBeInTheDocument();
  });

  it('renders the channel topic when provided', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" channelTopic="Share your feedback" />
      </Provider>,
    );
    expect(screen.getByText('Share your feedback')).toBeInTheDocument();
  });

  it('renders the New Post button', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /new post/i })).toBeInTheDocument();
  });

  it('opens create forum post modal when New Post is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /new post/i }));
    expect(store.getState().ui.activeModal).toBe('createForumPost');
    expect(store.getState().ui.modalProps).toEqual({ channelId: 'forum-1' });
  });

  it('shows empty state when no posts exist', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    await waitFor(() => {
      expect(screen.getByText('No posts yet')).toBeInTheDocument();
    });
  });

  it('renders sort dropdown with Latest Activity and Creation Date options', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );

    const sortButton = screen.getByRole('button', { name: /sort order/i });
    fireEvent.click(sortButton);

    expect(screen.getByRole('option', { name: 'Latest Activity' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Creation Date' })).toBeInTheDocument();
  });

  it('renders layout toggle buttons', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /list view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /grid view/i })).toBeInTheDocument();
  });

  it('calls getForumThreads on mount', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    await waitFor(() => {
      expect(mockGetForumThreads).toHaveBeenCalledWith('forum-1', {
        sort: 'latest_activity',
        tag_id: undefined,
        limit: 25,
      });
    });
  });

  it('renders forum posts when API returns data', async () => {
    const testPost = {
      id: 'thread-1',
      guild_id: 'guild-1',
      type: 11,
      name: 'Test Post',
      parent_id: 'forum-1',
      owner_id: 'user-1',
      last_message_id: null,
      message_count: 5,
      member_count: 3,
      thread_metadata: null,
      author: { id: 'user-1', username: 'testuser', avatar: null },
      applied_tags: [],
      last_activity: new Date().toISOString(),
    };
    mockGetForumThreads.mockResolvedValue({ threads: [testPost], has_more: false });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Test Post')).toBeInTheDocument();
    });
    expect(screen.getByText('testuser')).toBeInTheDocument();
  });

  it('renders loading skeleton when isLoading is true', () => {
    const store = createTestStore({
      forumPosts: {
        byChannel: {
          'forum-1': {
            posts: [],
            hasMore: false,
            isLoading: true,
            sortOrder: 'latest_activity',
            layout: 'list',
            activeTagFilter: null,
            tags: [],
          },
        },
      },
    });
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    expect(screen.getByLabelText('Loading forum posts')).toBeInTheDocument();
  });

  it('renders tag filter pills when tags exist', () => {
    const store = createTestStore({
      forumPosts: {
        byChannel: {
          'forum-1': {
            posts: [],
            hasMore: false,
            isLoading: false,
            sortOrder: 'latest_activity',
            layout: 'list',
            activeTagFilter: null,
            tags: [
              { id: 'tag-1', name: 'Bug' },
              { id: 'tag-2', name: 'Feature' },
            ],
          },
        },
      },
    });
    render(
      <Provider store={store}>
        <ForumView channelId="forum-1" channelName="feedback" />
      </Provider>,
    );
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
  });
});
