import { useEffect, useCallback, useState, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  setForumPosts,
  setForumLoading,
  setForumSortOrder,
  setForumLayout,
  setForumTagFilter,
  setForumTags,
} from '../../stores/forumSlice';
import type { ForumSortOrder, ForumLayout, ForumPost } from '../../stores/forumSlice';
import { openModal } from '../../stores/uiSlice';
import { setChannels } from '../../stores/channelsSlice';
import { api } from '../../api/rest';
import { ForumPostList } from './ForumPostList';
import styles from './forumView.module.scss';

export interface ForumViewProps {
  channelId: string;
  channelName: string;
  channelTopic?: string | null;
}

export const ForumView = ({ channelId, channelName, channelTopic }: ForumViewProps) => {
  const dispatch = useAppDispatch();
  const forumState = useAppSelector(s => s.forum.byChannel[channelId]);
  const posts = forumState?.posts ?? [];
  const isLoading = forumState?.isLoading ?? false;
  const sortOrder = forumState?.sortOrder ?? 'latest_activity';
  const layout = forumState?.layout ?? 'list';
  const activeTagFilter = forumState?.activeTagFilter ?? null;
  const tags = forumState?.tags ?? [];

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Load forum posts on mount or when sort/filter changes
  useEffect(() => {
    dispatch(setForumLoading({ channelId, loading: true }));
    api.getForumThreads(channelId, {
      sort: sortOrder,
      tag_id: activeTagFilter ?? undefined,
      limit: 25,
    }).then(data => {
      const threads: ForumPost[] = data.threads ?? [];
      dispatch(setForumPosts({
        channelId,
        posts: threads,
        hasMore: data.has_more ?? false,
      }));
      // Register thread channels in the channels store so navigation works
      if (threads.length > 0) {
        dispatch(setChannels(threads.map(t => ({
          id: t.id,
          guild_id: t.guild_id,
          type: t.type,
          name: t.name,
          topic: null,
          position: 0,
          parent_id: t.parent_id,
        }))));
      }
    }).catch(() => {
      dispatch(setForumPosts({ channelId, posts: [], hasMore: false }));
    });
  }, [channelId, sortOrder, activeTagFilter, dispatch]);

  // Load tags
  useEffect(() => {
    api.getForumTags(channelId).then(tagsData => {
      dispatch(setForumTags({ channelId, tags: tagsData }));
    }).catch(() => {
      // Tags may not exist yet
    });
  }, [channelId, dispatch]);

  // Close sort dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSortChange = useCallback((order: ForumSortOrder) => {
    dispatch(setForumSortOrder({ channelId, sortOrder: order }));
    setSortDropdownOpen(false);
  }, [channelId, dispatch]);

  const handleLayoutChange = useCallback((newLayout: ForumLayout) => {
    dispatch(setForumLayout({ channelId, layout: newLayout }));
  }, [channelId, dispatch]);

  const handleTagFilter = useCallback((tagId: string | null) => {
    dispatch(setForumTagFilter({ channelId, tagId }));
  }, [channelId, dispatch]);

  const handleNewPost = useCallback(() => {
    dispatch(openModal({ modal: 'createForumPost', props: { channelId } }));
  }, [channelId, dispatch]);

  const sortLabel = sortOrder === 'latest_activity' ? 'Latest Activity' : 'Creation Date';

  return (
    <div className={styles.container} data-testid="forum-view">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <svg className={styles.forumIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.91 12.98a5.45 5.45 0 0 1 2.18 6.2c-.1.33-.09.68.1.96l.83 1.32a.3.3 0 0 1-.33.46l-1.9-.38c-.3-.06-.62 0-.87.18a5.48 5.48 0 0 1-5.38.37 5.81 5.81 0 0 1-1.36-.92 5.85 5.85 0 0 0 6.73-8.19ZM14.91 2a5.5 5.5 0 0 1 3.37 9.86l.01.03a5.49 5.49 0 0 1-6.57 4.03 5.4 5.4 0 0 1-1.17-.38c-.26-.13-.56-.18-.85-.12l-1.9.38a.3.3 0 0 1-.34-.46l.84-1.32c.18-.28.2-.63.09-.96A5.49 5.49 0 0 1 9.41 2h5.5Z" />
          </svg>
          <span className={styles.channelName}>{channelName}</span>
          {channelTopic && <span className={styles.topic}>{channelTopic}</span>}
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.newPostButton}
            onClick={handleNewPost}
            type="button"
            aria-label="New Post"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.486 2 2 6.486 2 12C2 17.514 6.486 22 12 22C17.514 22 22 17.514 22 12C22 6.486 17.514 2 12 2ZM17 13H13V17H11V13H7V11H11V7H13V11H17V13Z" />
            </svg>
            New Post
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        {/* Tag filters */}
        <div className={styles.tagFilters}>
          {tags.length > 0 && (
            <>
              <button
                className={`${styles.tagPill} ${activeTagFilter === null ? styles.tagPillActive : ''}`}
                onClick={() => handleTagFilter(null)}
                type="button"
              >
                All
              </button>
              {tags.map(tag => (
                <button
                  key={tag.id}
                  className={`${styles.tagPill} ${activeTagFilter === tag.id ? styles.tagPillActive : ''}`}
                  onClick={() => handleTagFilter(tag.id)}
                  type="button"
                >
                  {tag.emoji_name ? `${tag.emoji_name} ` : ''}{tag.name}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Sort dropdown */}
        <div className={styles.sortDropdown} ref={sortRef}>
          <button
            className={styles.sortButton}
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            type="button"
            aria-label="Sort order"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
            </svg>
            {sortLabel}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
            </svg>
          </button>
          {sortDropdownOpen && (
            <div className={styles.sortDropdownMenu} role="listbox" aria-label="Sort options">
              <button
                className={`${styles.sortOption} ${sortOrder === 'latest_activity' ? styles.sortOptionActive : ''}`}
                onClick={() => handleSortChange('latest_activity')}
                type="button"
                role="option"
                aria-selected={sortOrder === 'latest_activity'}
              >
                Latest Activity
              </button>
              <button
                className={`${styles.sortOption} ${sortOrder === 'creation_date' ? styles.sortOptionActive : ''}`}
                onClick={() => handleSortChange('creation_date')}
                type="button"
                role="option"
                aria-selected={sortOrder === 'creation_date'}
              >
                Creation Date
              </button>
            </div>
          )}
        </div>

        {/* Layout toggle */}
        <div className={styles.layoutToggle}>
          <button
            className={`${styles.layoutButton} ${layout === 'list' ? styles.layoutButtonActive : ''}`}
            onClick={() => handleLayoutChange('list')}
            type="button"
            aria-label="List view"
            title="List view"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z" />
            </svg>
          </button>
          <button
            className={`${styles.layoutButton} ${layout === 'grid' ? styles.layoutButtonActive : ''}`}
            onClick={() => handleLayoutChange('grid')}
            type="button"
            aria-label="Grid view"
            title="Grid view"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className={styles.loadingContainer} aria-label="Loading forum posts">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`skeleton-${String(i)}`} className={styles.skeleton} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className={styles.emptyState}>
          <svg className={styles.emptyIcon} width="64" height="64" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.91 12.98a5.45 5.45 0 0 1 2.18 6.2c-.1.33-.09.68.1.96l.83 1.32a.3.3 0 0 1-.33.46l-1.9-.38c-.3-.06-.62 0-.87.18a5.48 5.48 0 0 1-5.38.37 5.81 5.81 0 0 1-1.36-.92 5.85 5.85 0 0 0 6.73-8.19ZM14.91 2a5.5 5.5 0 0 1 3.37 9.86l.01.03a5.49 5.49 0 0 1-6.57 4.03 5.4 5.4 0 0 1-1.17-.38c-.26-.13-.56-.18-.85-.12l-1.9.38a.3.3 0 0 1-.34-.46l.84-1.32c.18-.28.2-.63.09-.96A5.49 5.49 0 0 1 9.41 2h5.5Z" />
          </svg>
          <span className={styles.emptyTitle}>No posts yet</span>
          <span className={styles.emptyDescription}>
            Be the first to start a discussion in this forum channel.
          </span>
        </div>
      ) : (
        <div className={styles.content}>
          <ForumPostList
            posts={posts}
            layout={layout}
            tags={tags}
            channelId={channelId}
          />
        </div>
      )}
    </div>
  );
};
