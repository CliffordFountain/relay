import { useEffect, useCallback, useState } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { selectThread } from '../../stores/threadsSlice';
import { setMessages, prependMessages, setHasMore, setLoadingMore } from '../../stores/messagesSlice';
import { selectMessagesByChannel } from '../../stores/selectors';
import { api } from '../../api/rest';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { TypingIndicator } from '../chat/TypingIndicator';
import { SkeletonMessageList } from '../ui/SkeletonMessage';
import styles from './threadView.module.scss';

export interface ThreadViewProps {
  threadId: string;
}

export const ThreadView = ({ threadId }: ThreadViewProps) => {
  const dispatch = useAppDispatch();
  const thread = useAppSelector(s => s.threads.entities[threadId]);
  const parentChannel = useAppSelector(s => {
    if (!thread?.parent_id) return null;
    return s.channels.channels[thread.parent_id] ?? null;
  });
  const messages = useAppSelector(s => selectMessagesByChannel(s, threadId));
  const hasMore = useAppSelector(s => s.messages.hasMoreByChannel[threadId] ?? true);
  const isLoadingMore = useAppSelector(s => s.messages.loadingMoreByChannel[threadId] ?? false);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const [isInitialLoading, setIsInitialLoading] = useState(false);

  useEffect(() => {
    setIsInitialLoading(true);
    api.getMessages(threadId, { limit: 50 }).then(msgs => {
      const reversed = [...msgs].reverse();
      dispatch(setMessages({ channelId: threadId, messages: reversed }));
      dispatch(setHasMore({ channelId: threadId, hasMore: msgs.length >= 50 }));
    }).catch(() => {
      dispatch(setMessages({ channelId: threadId, messages: [] }));
    }).finally(() => {
      setIsInitialLoading(false);
    });
  }, [threadId, dispatch]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    dispatch(setLoadingMore({ channelId: threadId, loading: true }));
    api.getMessages(threadId, { before: oldestMessage.id, limit: 50 })
      .then(msgs => {
        const reversed = [...msgs].reverse();
        dispatch(prependMessages({ channelId: threadId, messages: reversed }));
        dispatch(setHasMore({ channelId: threadId, hasMore: msgs.length >= 50 }));
      })
      .finally(() => {
        dispatch(setLoadingMore({ channelId: threadId, loading: false }));
      });
  }, [threadId, hasMore, isLoadingMore, messages, dispatch]);

  const handleClose = useCallback(() => {
    dispatch(selectThread(null));
  }, [dispatch]);

  const handleArchive = useCallback(() => {
    void api.updateThread(threadId, { archived: true });
  }, [threadId]);

  const handleLock = useCallback(() => {
    void api.updateThread(threadId, { locked: true });
  }, [threadId]);

  const isOwner = thread?.owner_id === currentUserId;
  const isArchived = thread?.thread_metadata?.archived ?? false;
  const isLocked = thread?.thread_metadata?.locked ?? false;

  if (!thread) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <svg className={styles.threadIcon} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2.81L15.22 3.73L12.34 5.64L14.22 8.98L10.89 8.47L9.98 11.81L7.74 9.15L5.01 11.38L5.83 7.97L2.65 7.07L5.7 5.36L4.17 2.15L7.31 3.12L8.67 0L10.25 3.05L12 2.81Z" />
          </svg>
          <span className={styles.threadName}>{thread.name}</span>
          {parentChannel && (
            <span className={styles.parentChannel}>
              #{parentChannel.name}
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close thread"
            title="Close thread"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.metaBar}>
        <div className={styles.metaItem}>
          <svg className={styles.metaIcon} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.795 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006Z" />
          </svg>
          <span>{thread.member_count} member{thread.member_count !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.metaItem}>
          <svg className={styles.metaIcon} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
          </svg>
          <span>{thread.message_count} message{thread.message_count !== 1 ? 's' : ''}</span>
        </div>
        {isArchived && (
          <div className={styles.metaItem}>
            <span>Archived</span>
          </div>
        )}
        {isLocked && (
          <div className={styles.metaItem}>
            <span>Locked</span>
          </div>
        )}
        {isOwner && !isArchived && (
          <div className={styles.actions}>
            <button
              className={styles.actionButton}
              onClick={handleArchive}
              type="button"
            >
              Archive
            </button>
            {!isLocked && (
              <button
                className={`${styles.actionButton} ${styles.actionButtonDanger}`}
                onClick={handleLock}
                type="button"
              >
                Lock
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.content}>
        {isInitialLoading ? (
          <SkeletonMessageList count={4} />
        ) : (
          <MessageList
            messages={messages}
            channelId={threadId}
            onLoadMore={handleLoadMore}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
          />
        )}
        <TypingIndicator channelId={threadId} />
        {!isArchived && !isLocked && (
          <MessageInput channelId={threadId} />
        )}
      </div>
    </div>
  );
};
