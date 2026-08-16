import { useCallback } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { selectChannel } from '../../stores/channelsSlice';
import type { ForumPost, ForumTag, ForumLayout } from '../../stores/forumSlice';
import { cdnBase } from '../../utils/cdn';
import styles from './forumPostList.module.scss';

export interface ForumPostListProps {
  posts: ForumPost[];
  layout: ForumLayout;
  tags: ForumTag[];
  channelId: string;
}

function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${String(diffMins)}m ago`;
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  if (diffDays < 30) return `${String(diffDays)}d ago`;

  return date.toLocaleDateString();
}

function getTagsForPost(appliedTagIds: string[] | undefined, availableTags: ForumTag[]): ForumTag[] {
  if (!appliedTagIds || appliedTagIds.length === 0) return [];
  return appliedTagIds.map(id => availableTags.find(t => t.id === id)).filter((t): t is ForumTag => t !== undefined);
}

function getAvatarUrl(avatar: string | null, userId: string): string | null {
  if (!avatar) return null;
  // Avatars are stored as data: URLs — use them directly. Only fall back to the CDN path
  // scheme for legacy hash-style avatars.
  if (avatar.startsWith('data:')) return avatar;
  const cdnUrl = cdnBase();
  return `${cdnUrl}/avatars/${userId}/${avatar}.png`;
}

function getInitial(name: string | undefined): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

export const ForumPostList = ({ posts: rawPosts, layout, tags, channelId: _channelId }: ForumPostListProps) => {
  const dispatch = useAppDispatch();
  const posts = rawPosts ?? [];

  const handlePostClick = useCallback((postId: string) => {
    // Navigate to the thread (forum post) by selecting it as the active channel
    dispatch(selectChannel(postId));
  }, [dispatch]);

  if (layout === 'grid') {
    return (
      <div className={styles.gridContainer} data-testid="forum-post-grid" role="list" aria-label="Forum posts">
        {posts.map(post => {
          const postTags = getTagsForPost(post.applied_tags, tags);
          const avatarUrl = post.author ? getAvatarUrl(post.author.avatar, post.author.id) : null;

          return (
            <div
              key={post.id}
              className={styles.gridCard}
              onClick={() => handlePostClick(post.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlePostClick(post.id);
                }
              }}
              role="listitem"
              tabIndex={0}
              aria-label={`Forum post: ${post.name ?? 'Untitled'}`}
            >
              <div className={styles.gridTitle}>{post.name ?? 'Untitled'}</div>

              {postTags.length > 0 && (
                <div className={styles.gridTags}>
                  {postTags.map(tag => (
                    <span key={tag.id} className={styles.tagPill}>
                      {tag.emoji_name ? `${tag.emoji_name} ` : ''}{tag.name}
                    </span>
                  ))}
                </div>
              )}

              <div className={styles.gridPreview}>
                {/* Preview text is not available from thread data; show reply count as context */}
                {post.message_count > 0 ? `${String(post.message_count)} message${post.message_count === 1 ? '' : 's'}` : 'No messages yet'}
              </div>

              <div className={styles.gridFooter}>
                <div className={styles.gridAuthor}>
                  {avatarUrl ? (
                    <img
                      className={styles.gridAuthorAvatar}
                      src={avatarUrl}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.gridAuthorAvatarFallback}>
                      {getInitial(post.author?.username)}
                    </span>
                  )}
                  <span>{post.author?.username ?? 'Unknown'}</span>
                </div>
                <div className={styles.gridStats}>
                  <span>{post.message_count} replies</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // List view (default)
  return (
    <div className={styles.listContainer} data-testid="forum-post-list" role="list" aria-label="Forum posts">
      {posts.map(post => {
        const postTags = getTagsForPost(post.applied_tags, tags);
        const avatarUrl = post.author ? getAvatarUrl(post.author.avatar, post.author.id) : null;

        return (
          <div
            key={post.id}
            className={styles.listItem}
            onClick={() => handlePostClick(post.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handlePostClick(post.id);
              }
            }}
            role="listitem"
            tabIndex={0}
            aria-label={`Forum post: ${post.name ?? 'Untitled'}`}
          >
            {avatarUrl ? (
              <img
                className={styles.listAvatar}
                src={avatarUrl}
                alt=""
                loading="lazy"
              />
            ) : (
              <span className={styles.listAvatarFallback}>
                {getInitial(post.author?.username)}
              </span>
            )}

            <div className={styles.listContent}>
              <div className={styles.listTitle}>{post.name ?? 'Untitled'}</div>

              {postTags.length > 0 && (
                <div className={styles.listTags}>
                  {postTags.map(tag => (
                    <span key={tag.id} className={styles.tagPill}>
                      {tag.emoji_name ? `${tag.emoji_name} ` : ''}{tag.name}
                    </span>
                  ))}
                </div>
              )}

              <div className={styles.listMeta}>
                <span className={styles.listAuthor}>
                  {post.author?.username ?? 'Unknown'}
                </span>
                <span className={styles.listReplies}>
                  <svg className={styles.listRepliesIcon} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
                  </svg>
                  {post.message_count}
                </span>
                <span className={styles.listActivity}>
                  {formatRelativeTime(post.last_activity)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
