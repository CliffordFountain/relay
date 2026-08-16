import { useEffect, useCallback } from 'react';
import { shallowEqual } from 'react-redux';

const EMPTY_ARRAY: never[] = [];
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setThreads, selectThread } from '../../stores/threadsSlice';
import { closeThreadsPanel } from '../../stores/uiSlice';
import type { Thread } from '../../stores/threadsSlice';
import { api } from '../../api/rest';
import styles from './threadsPanel.module.scss';

export interface ThreadsPanelProps {
  channelId: string;
}

export const ThreadsPanel = ({ channelId }: ThreadsPanelProps) => {
  const dispatch = useAppDispatch();
  const threadIds = useAppSelector(s => s.threads.threadsByParent[channelId] ?? EMPTY_ARRAY);
  const threads = useAppSelector(s => {
    return threadIds
      .map(id => s.threads.entities[id])
      .filter((t): t is Thread => t !== undefined && !(t.thread_metadata?.archived));
  }, shallowEqual);

  useEffect(() => {
    api.getActiveThreads(channelId).then(res => {
      const threadData = res.threads as unknown as Thread[];
      dispatch(setThreads(threadData));
    }).catch(() => {
      // Silently handle failure
    });
  }, [channelId, dispatch]);

  const handleClose = useCallback(() => {
    dispatch(closeThreadsPanel());
  }, [dispatch]);

  const handleSelectThread = useCallback((threadId: string) => {
    dispatch(selectThread(threadId));
  }, [dispatch]);

  return (
    <div className={styles.panel} role="complementary" aria-label="Active threads">
      <div className={styles.header}>
        <span className={styles.headerTitle}>Threads</span>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close threads panel"
          title="Close"
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
      </div>

      <div className={styles.list}>
        {threads.length === 0 ? (
          <div className={styles.empty}>No active threads in this channel.</div>
        ) : (
          threads.map(thread => (
            <div
              key={thread.id}
              className={styles.threadItem}
              onClick={() => handleSelectThread(thread.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSelectThread(thread.id); }}
              aria-label={`Thread: ${thread.name ?? 'Unnamed'}`}
            >
              <span className={styles.threadItemName}>{thread.name}</span>
              <div className={styles.threadItemMeta}>
                <span className={styles.threadItemStat}>
                  <svg className={styles.threadItemIcon} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
                  </svg>
                  {thread.message_count}
                </span>
                <span className={styles.threadItemStat}>
                  <svg className={styles.threadItemIcon} width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.795 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006Z" />
                  </svg>
                  {thread.member_count}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
