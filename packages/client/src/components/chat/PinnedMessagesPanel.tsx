import { useEffect, useState, useCallback } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { closePinnedMessagesPanel } from '../../stores/uiSlice';
import { api } from '../../api/rest';
import { MarkdownContent } from '../../markdown';
import styles from './pinnedMessagesPanel.module.scss';

interface PinnedMessage {
  id: string;
  channel_id: string;
  author: { id: string; username: string; avatar: string | null };
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  pinned: boolean;
}

export interface PinnedMessagesPanelProps {
  channelId: string;
  onJumpToMessage: (messageId: string) => void;
}

const formatPinnedTimestamp = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }) + ' ' + d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const PinnedMessagesPanel = ({ channelId, onJumpToMessage }: PinnedMessagesPanelProps) => {
  const dispatch = useAppDispatch();
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    api.getPinnedMessages(channelId)
      .then((msgs) => {
        if (!cancelled) {
          setPinnedMessages(msgs as PinnedMessage[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load pinned messages.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const handleClose = useCallback(() => {
    dispatch(closePinnedMessagesPanel());
  }, [dispatch]);

  const handleJump = useCallback((messageId: string) => {
    onJumpToMessage(messageId);
    dispatch(closePinnedMessagesPanel());
  }, [onJumpToMessage, dispatch]);

  return (
    <div className={styles.panel} role="complementary" aria-label="Pinned Messages">
      <div className={styles.header}>
        <h2 className={styles.title}>Pinned Messages</h2>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close pinned messages"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
      </div>

      <div className={styles.content}>
        {isLoading && (
          <div className={styles.loadingState}>
            <div className={styles.skeletonItem} />
            <div className={styles.skeletonItem} />
            <div className={styles.skeletonItem} />
          </div>
        )}

        {error && (
          <div className={styles.errorState} role="alert">
            {error}
          </div>
        )}

        {!isLoading && !error && pinnedMessages.length === 0 && (
          <div className={styles.emptyState}>
            <svg className={styles.emptyIcon} width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M22 12.41L13.59 4 12 5.59l1.59 1.59-5.89 5.89-1.18-1.18L5.12 13.3l3.54 3.53-4.24 4.24 1.42 1.41 4.24-4.24 3.53 3.54 1.41-1.42-1.18-1.18 5.89-5.89L21.41 14 22 12.41z" />
            </svg>
            <p className={styles.emptyText}>
              This channel doesn&apos;t have any pinned messages... yet.
            </p>
          </div>
        )}

        {!isLoading && !error && pinnedMessages.length > 0 && (
          <ul className={styles.messagesList} role="list">
            {pinnedMessages.map((msg) => (
              <li key={msg.id} className={styles.pinnedItem}>
                <div className={styles.pinnedHeader}>
                  <div className={styles.pinnedAvatar}>
                    {msg.author.username.charAt(0).toUpperCase()}
                  </div>
                  <span className={styles.pinnedUsername}>{msg.author.username}</span>
                  <span className={styles.pinnedTimestamp}>{formatPinnedTimestamp(msg.timestamp)}</span>
                </div>
                <div className={styles.pinnedContent}>
                  <MarkdownContent content={msg.content} />
                </div>
                <button
                  className={styles.jumpButton}
                  onClick={() => handleJump(msg.id)}
                  type="button"
                  aria-label={`Jump to pinned message by ${msg.author.username}`}
                >
                  Jump
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
