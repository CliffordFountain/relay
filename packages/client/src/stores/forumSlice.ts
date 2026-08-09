import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface ForumTag {
  id: string;
  name: string;
  emoji_name?: string;
  emoji_id?: string;
}

export interface ForumPostAuthor {
  id: string;
  username: string;
  avatar: string | null;
}

export interface ForumPost {
  id: string;
  guild_id: string | null;
  type: number;
  name: string | null;
  parent_id: string | null;
  owner_id: string | null;
  last_message_id: string | null;
  message_count: number;
  member_count: number;
  thread_metadata: {
    archived: boolean;
    auto_archive_duration: number;
    archive_timestamp: string | null;
    locked: boolean;
    create_timestamp: string;
  } | null;
  author?: ForumPostAuthor;
  applied_tags: string[];
  last_activity: string | null;
}

export type ForumSortOrder = 'latest_activity' | 'creation_date';
export type ForumLayout = 'list' | 'grid';

interface ForumChannelState {
  posts: ForumPost[];
  hasMore: boolean;
  isLoading: boolean;
  sortOrder: ForumSortOrder;
  layout: ForumLayout;
  activeTagFilter: string | null;
  tags: ForumTag[];
}

interface ForumState {
  byChannel: Record<string, ForumChannelState>;
}

const initialState: ForumState = {
  byChannel: {},
};

const defaultChannelState: ForumChannelState = {
  posts: [],
  hasMore: true,
  isLoading: false,
  sortOrder: 'latest_activity',
  layout: 'list',
  activeTagFilter: null,
  tags: [],
};

export const forumSlice = createSlice({
  name: 'forum',
  initialState,
  reducers: {
    setForumPosts: (state, action: PayloadAction<{ channelId: string; posts: ForumPost[]; hasMore: boolean }>) => {
      const { channelId, posts, hasMore } = action.payload;
      const existing = state.byChannel[channelId] ?? { ...defaultChannelState };
      existing.posts = posts;
      existing.hasMore = hasMore;
      existing.isLoading = false;
      state.byChannel[channelId] = existing;
    },
    appendForumPosts: (state, action: PayloadAction<{ channelId: string; posts: ForumPost[]; hasMore: boolean }>) => {
      const { channelId, posts, hasMore } = action.payload;
      const existing = state.byChannel[channelId] ?? { ...defaultChannelState };
      const existingIds = new Set(existing.posts.map(p => p.id));
      const newPosts = posts.filter(p => !existingIds.has(p.id));
      existing.posts = [...existing.posts, ...newPosts];
      existing.hasMore = hasMore;
      existing.isLoading = false;
      state.byChannel[channelId] = existing;
    },
    addForumPost: (state, action: PayloadAction<{ channelId: string; post: ForumPost }>) => {
      const { channelId, post } = action.payload;
      const existing = state.byChannel[channelId] ?? { ...defaultChannelState };
      if (!existing.posts.find(p => p.id === post.id)) {
        existing.posts.unshift(post);
      }
      state.byChannel[channelId] = existing;
    },
    setForumLoading: (state, action: PayloadAction<{ channelId: string; loading: boolean }>) => {
      const existing = state.byChannel[action.payload.channelId] ?? { ...defaultChannelState };
      existing.isLoading = action.payload.loading;
      state.byChannel[action.payload.channelId] = existing;
    },
    setForumSortOrder: (state, action: PayloadAction<{ channelId: string; sortOrder: ForumSortOrder }>) => {
      const existing = state.byChannel[action.payload.channelId] ?? { ...defaultChannelState };
      existing.sortOrder = action.payload.sortOrder;
      state.byChannel[action.payload.channelId] = existing;
    },
    setForumLayout: (state, action: PayloadAction<{ channelId: string; layout: ForumLayout }>) => {
      const existing = state.byChannel[action.payload.channelId] ?? { ...defaultChannelState };
      existing.layout = action.payload.layout;
      state.byChannel[action.payload.channelId] = existing;
    },
    setForumTagFilter: (state, action: PayloadAction<{ channelId: string; tagId: string | null }>) => {
      const existing = state.byChannel[action.payload.channelId] ?? { ...defaultChannelState };
      existing.activeTagFilter = action.payload.tagId;
      state.byChannel[action.payload.channelId] = existing;
    },
    setForumTags: (state, action: PayloadAction<{ channelId: string; tags: ForumTag[] }>) => {
      const existing = state.byChannel[action.payload.channelId] ?? { ...defaultChannelState };
      existing.tags = action.payload.tags;
      state.byChannel[action.payload.channelId] = existing;
    },
  },
});

export const {
  setForumPosts,
  appendForumPosts,
  addForumPost,
  setForumLoading,
  setForumSortOrder,
  setForumLayout,
  setForumTagFilter,
  setForumTags,
} = forumSlice.actions;
