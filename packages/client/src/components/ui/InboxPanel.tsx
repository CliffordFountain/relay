import { useState, useCallback, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { closeInboxPanel, setInboxPanelTab } from '../../stores/uiSlice';
import { api } from '../../api/rest';
import type { Guild } from '../../stores/guildsSlice';
import type { Channel } from '../../stores/channelsSlice';
import styles from './inboxPanel.module.scss';

interface MentionItem {
  id: string;
  guildId: string;
  guildName: string;
  guildIcon: string | null;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  timestamp: string;
  read: boolean;
}

// Shape returned by api.getMentions(): a full serialized message with an
// extra guild_id field. Everything else is untyped on the wire, so fields
// are pulled out defensively below.
type RawMention = Record<string, unknown> & { guild_id: string | null };

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const mapRawMention = (
  raw: RawMention,
  guildsById: Record<string, Guild>,
  channelsById: Record<string, Channel>
): MentionItem | null => {
  const id = asString(raw.id);
  const channelId = asString(raw.channel_id);
  // Without an id or channel we can't render or navigate to this mention.
  if (!id || !channelId) return null;

  const guildId = raw.guild_id ?? '';
  const guild = guildId ? guildsById[guildId] : undefined;
  const channel = channelsById[channelId];

  const authorRaw = raw.author;
  const author = authorRaw && typeof authorRaw === 'object'
    ? authorRaw as Record<string, unknown>
    : {};
  const username = asString(author.username);
  const globalName = asString(author.global_name);

  return {
    id,
    guildId,
    guildName: guildId ? guild?.name ?? 'Unknown Server' : 'Direct Message',
    guildIcon: guild?.icon ?? null,
    channelId,
    channelName: channel?.name ?? 'unknown-channel',
    authorId: asString(author.id) ?? '',
    authorName: globalName || username || 'Unknown User',
    authorAvatar: asString(author.avatar),
    content: asString(raw.content) ?? '',
    timestamp: asString(raw.timestamp) ?? new Date().toISOString(),
    read: false,
  };
};

const formatTimestamp = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60000) {
    return 'Just now';
  }
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getGuildAcronym = (name: string | null | undefined): string => {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

export interface InboxPanelProps {
  onNavigateToMessage?: (guildId: string, channelId: string, messageId: string) => void;
}

export const InboxPanel = ({ onNavigateToMessage }: InboxPanelProps) => {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector(s => s.ui.inboxPanelOpen);
  const activeTab = useAppSelector(s => s.ui.inboxPanelTab);
  const guildsById = useAppSelector(s => s.guilds.guilds);
  const channelsById = useAppSelector(s => s.channels.channels);

  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    api.getMentions()
      .then(data => {
        if (cancelled) return;
        const items = data
          .map(raw => mapRawMention(raw, guildsById, channelsById))
          .filter((item): item is MentionItem => item !== null);
        setMentions(items);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load your mentions. Try again later.");
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
    // Refetch only when the panel opens/closes. Guild/channel names are
    // resolved from whatever is in the store at fetch time (with fallbacks),
    // so store updates alone shouldn't trigger another network call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = useCallback(() => {
    dispatch(closeInboxPanel());
  }, [dispatch]);

  const handleTabChange = useCallback((tab: 'forYou' | 'unreads') => {
    dispatch(setInboxPanelTab(tab));
  }, [dispatch]);

  const handleMarkAsRead = useCallback((mentionId: string) => {
    setMentions(prev => prev.map(m =>
      m.id === mentionId ? { ...m, read: true } : m
    ));
  }, []);

  const handleMarkAllRead = useCallback(() => {
    setMentions(prev => prev.map(m => ({ ...m, read: true })));
  }, []);

  const handleItemClick = useCallback((item: MentionItem) => {
    if (onNavigateToMessage) {
      onNavigateToMessage(item.guildId, item.channelId, item.id);
    }
    handleMarkAsRead(item.id);
  }, [onNavigateToMessage, handleMarkAsRead]);

  if (!isOpen) return null;

  const unreadMentions = mentions.filter(m => !m.read);
  const displayMentions = activeTab === 'unreads' ? unreadMentions : mentions;

  return (
    <div className={styles.panel} role="complementary" aria-label="Inbox panel">
      <div className={styles.header}>
        <h2 className={styles.title}>Inbox</h2>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close inbox"
          title="Close inbox"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          className={`${styles.tab} ${activeTab === 'forYou' ? styles.activeTab : ''}`}
          onClick={() => handleTabChange('forYou')}
          role="tab"
          aria-selected={activeTab === 'forYou'}
          type="button"
        >
          For You
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'unreads' ? styles.activeTab : ''}`}
          onClick={() => handleTabChange('unreads')}
          role="tab"
          aria-selected={activeTab === 'unreads'}
          type="button"
        >
          Unreads
          {unreadMentions.length > 0 && (
            <span className={styles.badge}>{unreadMentions.length}</span>
          )}
        </button>
      </div>

      {!isLoading && !error && displayMentions.length > 0 && (
        <div className={styles.actions}>
          <button
            className={styles.markAllRead}
            onClick={handleMarkAllRead}
            type="button"
          >
            Mark All as Read
          </button>
        </div>
      )}

      <div className={styles.content}>
        {isLoading ? (
          <div className={styles.skeleton}>
            {[0, 1, 2].map(i => (
              <div className={styles.skeletonItem} key={i}>
                <div className={styles.skeletonIcon} />
                <div className={styles.skeletonLines}>
                  <div className={styles.skeletonLine} />
                  <div className={styles.skeletonLineShort} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : displayMentions.length === 0 ? (
          <div className={styles.empty}>
            <svg
              className={styles.emptyIcon}
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H5Zm8.8 5.15a.5.5 0 0 0-.86-.02L10.47 11H8a1 1 0 1 0 0 2h3a.5.5 0 0 0 .43-.24l1.9-3.17 1.44 4.33A.5.5 0 0 0 15.24 14h.76a1 1 0 1 0 0-2h-.38l-1.82-4.85Z" />
            </svg>
            <p className={styles.emptyTitle}>
              {activeTab === 'unreads' ? "You're all caught up!" : 'No recent mentions'}
            </p>
            <p className={styles.emptyDescription}>
              {activeTab === 'unreads'
                ? 'You have no unread mentions.'
                : 'When someone @mentions you, it will show up here.'}
            </p>
          </div>
        ) : (
          <div className={styles.mentionList}>
            {displayMentions.map(item => (
              <button
                key={item.id}
                className={`${styles.mentionItem} ${item.read ? styles.read : ''}`}
                onClick={() => handleItemClick(item)}
                type="button"
              >
                <div className={styles.mentionGuildIcon}>
                  {item.guildIcon ? (
                    <img
                      src={item.guildIcon}
                      alt={item.guildName}
                      className={styles.guildIconImage}
                    />
                  ) : (
                    <span className={styles.guildIconFallback}>
                      {getGuildAcronym(item.guildName)}
                    </span>
                  )}
                </div>
                <div className={styles.mentionBody}>
                  <div className={styles.mentionMeta}>
                    <span className={styles.mentionGuildName}>{item.guildName}</span>
                    <span className={styles.mentionSep}>&gt;</span>
                    <span className={styles.mentionChannelName}>#{item.channelName}</span>
                    <span className={styles.mentionTimestamp}>
                      {formatTimestamp(item.timestamp)}
                    </span>
                  </div>
                  <div className={styles.mentionMessage}>
                    <span className={styles.mentionAuthor}>{item.authorName}</span>
                    <span className={styles.mentionContent}>{item.content}</span>
                  </div>
                </div>
                <button
                  className={styles.markReadBtn}
                  onClick={e => {
                    e.stopPropagation();
                    handleMarkAsRead(item.id);
                  }}
                  title="Mark as read"
                  aria-label={`Mark mention from ${item.authorName} as read`}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
