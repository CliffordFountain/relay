import { useMemo, useState, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { selectMessagesByChannel } from '../../stores/selectors';
import { openLightbox } from '../../stores/uiSlice';
import type { Message, Attachment } from '../../stores/messagesSlice';
import styles from './mediaGridView.module.scss';

type MediaType = 'image' | 'video' | 'gif';
type FilterType = 'all' | MediaType;
type SortOrder = 'newest' | 'oldest';

interface MediaItem {
  /** Stable React key */
  key: string;
  type: MediaType;
  /** Full-resolution URL (lightbox / open) */
  url: string;
  /** Thumbnail URL (proxy when available) */
  thumbUrl: string;
  filename: string;
  size?: number;
  message: Message;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/** Bare GIF picker URLs (Tenor / Giphy) are sent as message content, not attachments. */
const GIF_URL_REGEX = /^https:\/\/((?:media\d*|c|i)\.tenor\.com|(?:media\d*|i)\.giphy\.com)\/[^\s]+\.(gif|mp4|webp)(\?[^\s]*)?$/i;
const isBareGifUrl = (content: string): boolean => GIF_URL_REGEX.test(content.trim());

/** True when a URL points at a playable video file (drives <video> vs <img> and lightbox vs new-tab). */
const isVideoUrl = (url: string): boolean => /\.(mp4|webm|mov)(\?|$)/i.test(url);

function getMediaType(a: Attachment): MediaType | null {
  const ct = a.content_type;
  if (ct === 'image/gif' || /\.gif$/i.test(a.filename)) return 'gif';
  if ((ct && IMAGE_TYPES.includes(ct)) || /\.(png|jpe?g|webp|avif)$/i.test(a.filename)) return 'image';
  if ((ct && VIDEO_TYPES.includes(ct)) || /\.(mp4|webm|mov)$/i.test(a.filename)) return 'video';
  return null;
}

const TYPE_LABEL: Record<MediaType, string> = {
  image: 'Image',
  video: 'Video',
  gif: 'GIF',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}

function cardTitle(item: MediaItem): string {
  const content = item.message.content?.trim();
  if (content && !isBareGifUrl(content)) {
    return content.length > 70 ? `${content.slice(0, 70)}…` : content;
  }
  return item.filename;
}

export interface MediaGridViewProps {
  channelId: string;
}

export const MediaGridView = ({ channelId }: MediaGridViewProps) => {
  const dispatch = useAppDispatch();
  const messages = useAppSelector(s => selectMessagesByChannel(s, channelId));

  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortOrder>('newest');

  // Derive every image/video/gif from the channel's loaded messages (real store data).
  const items = useMemo<MediaItem[]>(() => {
    const out: MediaItem[] = [];
    for (const msg of messages) {
      if (msg._pending || msg._failed) continue;

      if (msg.attachments) {
        for (const a of msg.attachments) {
          const type = getMediaType(a);
          if (!type) continue;
          out.push({
            key: a.id,
            type,
            url: a.url,
            thumbUrl: a.proxy_url || a.url,
            filename: a.filename,
            size: a.size,
            message: msg,
          });
        }
      }

      // GIFs sent via the picker arrive as a bare media URL in the message content.
      if (msg.content && isBareGifUrl(msg.content)) {
        const u = msg.content.trim();
        out.push({
          key: `${msg.id}:gif`,
          type: 'gif',
          url: u,
          thumbUrl: u,
          filename: 'GIF',
          message: msg,
        });
      }
    }
    return out;
  }, [messages]);

  const counts = useMemo(() => {
    const c = { all: items.length, image: 0, video: 0, gif: 0 };
    for (const item of items) c[item.type] += 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const filtered = filter === 'all' ? items : items.filter(i => i.type === filter);
    const sorted = [...filtered].sort((a, b) => {
      const ta = new Date(a.message.timestamp).getTime();
      const tb = new Date(b.message.timestamp).getTime();
      return sort === 'newest' ? tb - ta : ta - tb;
    });
    return sorted;
  }, [items, filter, sort]);

  const handleOpen = useCallback((item: MediaItem) => {
    if (item.type === 'video' || isVideoUrl(item.url)) {
      // Lightbox is image-only; open the clip in a new tab (reuses the browser viewer).
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } else {
      dispatch(openLightbox(item.url));
    }
  }, [dispatch]);

  const filterChips: { id: FilterType; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'image', label: 'Images', count: counts.image },
    { id: 'video', label: 'Videos', count: counts.video },
    { id: 'gif', label: 'GIFs', count: counts.gif },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="tablist" aria-label="Filter media by type">
          {filterChips.map(chip => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={filter === chip.id}
              className={`${styles.chip} ${filter === chip.id ? styles.chipActive : ''}`}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className={styles.chipCount}>{chip.count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.sortButton}
          onClick={() => setSort(prev => (prev === 'newest' ? 'oldest' : 'newest'))}
          aria-label={`Sort by ${sort === 'newest' ? 'oldest' : 'newest'} first`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 6h11v2H3V6zm0 5h8v2H3v-2zm0 5h5v2H3v-2zm15-9v9.17l2.59-2.58L22 15l-5 5-5-5 1.41-1.41L16 16.17V7h2z" />
          </svg>
          {sort === 'newest' ? 'Newest' : 'Oldest'}
        </button>
      </div>

      <div className={styles.scroll}>
        {visible.length === 0 ? (
          <div className={styles.emptyState}>
            <svg className={styles.emptyIcon} width="64" height="64" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21 3H3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zm-1 15.38l-4.5-6-3.5 4.51-2.5-3.01L5.5 18H4V5h16v13.38z" />
              <circle cx="8" cy="8.5" r="1.6" />
            </svg>
            <h2 className={styles.emptyTitle}>No media yet</h2>
            <p className={styles.emptyDescription}>
              {filter === 'all'
                ? 'Images, videos, and GIFs shared in this channel will show up here as a gallery.'
                : `No ${filter === 'gif' ? 'GIFs' : `${filter}s`} in the messages loaded so far.`}
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {visible.map(item => {
              const useVideoThumb = item.type === 'video' || isVideoUrl(item.thumbUrl);
              const title = cardTitle(item);
              const reactions = item.message.reactions;
              return (
                <div
                  key={item.key}
                  className={styles.card}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpen(item);
                    }
                  }}
                  aria-label={`Open ${TYPE_LABEL[item.type].toLowerCase()}: ${title}`}
                >
                  <div className={styles.thumb}>
                    {useVideoThumb ? (
                      <video
                        className={styles.thumbMedia}
                        src={item.thumbUrl}
                        preload="metadata"
                        muted
                        playsInline
                        tabIndex={-1}
                        aria-hidden="true"
                      >
                        <track kind="captions" />
                      </video>
                    ) : (
                      <img
                        className={styles.thumbMedia}
                        src={item.thumbUrl}
                        alt={title}
                        loading="lazy"
                      />
                    )}

                    <span className={styles.typeTag} data-type={item.type}>
                      <span className={styles.typeDot} aria-hidden="true" />
                      {TYPE_LABEL[item.type]}
                    </span>

                    {item.type === 'video' && (
                      <div className={styles.playButton} aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    )}

                    {item.type === 'video' && item.size !== undefined && (
                      <span className={styles.durationChip}>{formatFileSize(item.size)}</span>
                    )}
                  </div>

                  <div className={styles.meta}>
                    <div className={styles.title} title={title}>{title}</div>
                    <div className={styles.authorRow}>
                      <div className={styles.avatar} aria-hidden="true">
                        {item.message.author.username.charAt(0).toUpperCase()}
                      </div>
                      <span className={styles.author}>{item.message.author.username}</span>
                      <span className={styles.sepDot} aria-hidden="true">&middot;</span>
                      <span className={styles.time}>{formatRelativeTime(item.message.timestamp)}</span>
                    </div>

                    {reactions && reactions.length > 0 && (
                      <div className={styles.reactions}>
                        {reactions.slice(0, 4).map((r, i) => (
                          <span
                            key={`${item.key}-r-${i}`}
                            className={`${styles.reactionChip} ${r.me ? styles.reactionChipMine : ''}`}
                          >
                            <span className={styles.reactionEmoji}>{typeof r.emoji === 'string' ? r.emoji : r.emoji.name}</span>
                            <span className={styles.reactionCount}>{r.count}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
