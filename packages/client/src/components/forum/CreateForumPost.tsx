import { useState, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { closeModal } from '../../stores/uiSlice';
import { addForumPost } from '../../stores/forumSlice';
import type { ForumPost } from '../../stores/forumSlice';
import { api } from '../../api/rest';
import styles from './createForumPost.module.scss';

export interface CreateForumPostProps {
  channelId: string;
}

export const CreateForumPost = ({ channelId }: CreateForumPostProps) => {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(s => s.auth.user);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tag selection is intentionally not offered here: the server does not yet
  // persist a forum channel's tag catalog (see get/set_forum_tags), so any
  // tag a user picked would silently fail to stick after the post is created.
  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.createForumPost(channelId, {
        name: title.trim(),
        message: { content: content.trim() },
        applied_tags: [],
      });

      // Add the new post to the forum state
      const newPost: ForumPost = {
        id: String(response['id'] ?? ''),
        guild_id: String(response['guild_id'] ?? '') || null,
        type: Number(response['type'] ?? 11),
        name: title.trim(),
        parent_id: channelId,
        owner_id: currentUser?.id ?? null,
        last_message_id: null,
        message_count: 1,
        member_count: 1,
        thread_metadata: {
          archived: false,
          auto_archive_duration: 1440,
          archive_timestamp: null,
          locked: false,
          create_timestamp: new Date().toISOString(),
        },
        author: currentUser ? {
          id: currentUser.id,
          username: currentUser.username,
          avatar: currentUser.avatar ?? null,
        } : undefined,
        applied_tags: [],
        last_activity: new Date().toISOString(),
      };

      dispatch(addForumPost({ channelId, post: newPost }));
      dispatch(closeModal());
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message ?? 'Failed to create post');
    } finally {
      setIsSubmitting(false);
    }
  }, [title, content, channelId, currentUser, dispatch]);

  const handleClose = useCallback(() => {
    dispatch(closeModal());
  }, [dispatch]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleClose]);

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Create a forum post"
      aria-modal="true"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create Post</h2>
        </div>

        <div className={styles.body}>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="forum-post-title">
              Title<span className={styles.labelRequired}>*</span>
            </label>
            <input
              id="forum-post-title"
              className={styles.input}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Enter a title for your post"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="forum-post-content">
              Content<span className={styles.labelRequired}>*</span>
            </label>
            <textarea
              id="forum-post-content"
              className={styles.textarea}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Write your post content..."
              maxLength={2000}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={handleClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.submitButton}
            onClick={handleSubmit}
            type="button"
            disabled={isSubmitting || !title.trim() || !content.trim()}
          >
            {isSubmitting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
};
