import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ForumPostList } from './ForumPostList';
import { channelsSlice } from '../../stores/channelsSlice';
import type { ForumPost, ForumTag } from '../../stores/forumSlice';

vi.mock('../../api/rest', () => ({
  api: {},
}));

function createTestStore() {
  return configureStore({
    reducer: {
      channels: channelsSlice.reducer,
    },
    preloadedState: {
      channels: { channels: {}, selectedChannelId: null },
    },
  });
}

const mockTags: ForumTag[] = [
  { id: 'tag-1', name: 'Bug' },
  { id: 'tag-2', name: 'Feature', emoji_name: 'sparkles' },
];

const mockPosts: ForumPost[] = [
  {
    id: 'thread-1',
    guild_id: 'guild-1',
    type: 11,
    name: 'First Post',
    parent_id: 'forum-1',
    owner_id: 'user-1',
    last_message_id: null,
    message_count: 5,
    member_count: 3,
    thread_metadata: null,
    author: { id: 'user-1', username: 'alice', avatar: null },
    applied_tags: ['tag-1'],
    last_activity: new Date().toISOString(),
  },
  {
    id: 'thread-2',
    guild_id: 'guild-1',
    type: 11,
    name: 'Second Post',
    parent_id: 'forum-1',
    owner_id: 'user-2',
    last_message_id: null,
    message_count: 0,
    member_count: 1,
    thread_metadata: null,
    author: { id: 'user-2', username: 'bob', avatar: null },
    applied_tags: ['tag-2'],
    last_activity: null,
  },
];

describe('ForumPostList', () => {
  it('renders without crashing in list layout', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders without crashing in grid layout', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="grid" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders post titles in list view', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByText('First Post')).toBeInTheDocument();
    expect(screen.getByText('Second Post')).toBeInTheDocument();
  });

  it('renders post titles in grid view', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="grid" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByText('First Post')).toBeInTheDocument();
    expect(screen.getByText('Second Post')).toBeInTheDocument();
  });

  it('renders author names in list view', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('renders tag pills for posts with applied tags', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByText('Bug')).toBeInTheDocument();
    // tag-2 has emoji_name so it renders as "sparkles Feature"
    expect(screen.getByText(/Feature/)).toBeInTheDocument();
  });

  it('renders reply counts in list view', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    // message_count 5 for first post
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('dispatches selectChannel when a post is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    const firstPost = screen.getByLabelText('Forum post: First Post');
    fireEvent.click(firstPost);
    expect(store.getState().channels.selectedChannelId).toBe('thread-1');
  });

  it('dispatches selectChannel when a post is clicked in grid view', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="grid" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    const firstPost = screen.getByLabelText('Forum post: First Post');
    fireEvent.click(firstPost);
    expect(store.getState().channels.selectedChannelId).toBe('thread-1');
  });

  it('renders the list container with correct test id in list mode', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByTestId('forum-post-list')).toBeInTheDocument();
  });

  it('renders the grid container with correct test id in grid mode', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="grid" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    expect(screen.getByTestId('forum-post-grid')).toBeInTheDocument();
  });

  it('renders avatar fallback letter when no avatar URL', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    // Alice's initial is "A", Bob's is "B"
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('supports keyboard navigation with Enter key', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ForumPostList posts={mockPosts} layout="list" tags={mockTags} channelId="forum-1" />
      </Provider>,
    );
    const firstPost = screen.getByLabelText('Forum post: First Post');
    fireEvent.keyDown(firstPost, { key: 'Enter' });
    expect(store.getState().channels.selectedChannelId).toBe('thread-1');
  });
});
