import { useCallback, useState, useRef, useEffect, type MouseEvent } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { addReaction, removeReaction, reactionEmojiKey } from '../../stores/messagesSlice';
import type { Reaction } from '../../stores/messagesSlice';
import { api } from '../../api/rest';
import { emojiUrl } from '../../utils/cdn';
import styles from './reactionBar.module.scss';

/**
 * Render a reaction emoji: the glyph for Unicode, or an <img> for a custom emoji.
 * The backend sends unicode as { name: "👍", id: null } and custom as { name, id }, so the
 * `id` — NOT typeof — decides which. NEVER drop the emoji object straight into JSX; that
 * throws "Objects are not valid as a React child" and crashes the whole message list.
 */
function renderEmoji(emoji: Reaction['emoji']) {
  if (typeof emoji === 'object' && emoji !== null) {
    // Unicode emoji have no id — render the glyph, not a broken <img src=.../null.png>.
    if (!emoji.id) return emoji.name;
    return (
      <img
        className={styles.customEmoji}
        src={emojiUrl(emoji.id, emoji.animated)}
        alt={`:${emoji.name}:`}
        loading="lazy"
        draggable={false}
      />
    );
  }
  return emoji;
}

interface ReactorUser {
  id: string;
  username: string;
  avatar: string | null;
}

// Simple in-memory cache for reaction users
const reactorCache = new Map<string, { users: ReactorUser[]; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

function getCacheKey(channelId: string, messageId: string, emoji: string): string {
  return `${channelId}:${messageId}:${emoji}`;
}

export interface ReactionBarProps {
  channelId: string;
  messageId: string;
  reactions: Reaction[];
  onAddReaction?: (e?: MouseEvent) => void;
}

export const ReactionBar = ({ channelId, messageId, reactions, onAddReaction }: ReactionBarProps) => {
  const dispatch = useAppDispatch();
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const [reactors, setReactors] = useState<ReactorUser[]>([]);
  const [loadingReactors, setLoadingReactors] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const fetchReactors = useCallback(async (emoji: string) => {
    const key = getCacheKey(channelId, messageId, emoji);
    const cached = reactorCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setReactors(cached.users);
      return;
    }

    setLoadingReactors(true);
    try {
      const users = await api.getReactions(channelId, messageId, emoji);
      reactorCache.set(key, { users, fetchedAt: Date.now() });
      setReactors(users);
    } catch {
      setReactors([]);
    } finally {
      setLoadingReactors(false);
    }
  }, [channelId, messageId]);

  const handleReactionHover = useCallback((emoji: string) => {
    // Small delay before fetching to avoid spamming on quick mouse movements
    hoverTimerRef.current = setTimeout(() => {
      setHoveredEmoji(emoji);
      void fetchReactors(emoji);
    }, 200);
  }, [fetchReactors]);

  const handleReactionLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredEmoji(null);
    setReactors([]);
  }, []);

  const handleReactionClick = useCallback((reaction: Reaction) => {
    const emoji = reactionEmojiKey(reaction.emoji); // string key; works for custom emoji too
    // Invalidate cache on toggle
    const key = getCacheKey(channelId, messageId, emoji);
    reactorCache.delete(key);

    if (reaction.me) {
      dispatch(removeReaction({ channelId, messageId, emoji, me: true }));
      api.removeReaction(channelId, messageId, emoji).catch(() => {
        dispatch(addReaction({ channelId, messageId, emoji, me: true }));
      });
    } else {
      dispatch(addReaction({ channelId, messageId, emoji, me: true }));
      api.addReaction(channelId, messageId, emoji).catch(() => {
        dispatch(removeReaction({ channelId, messageId, emoji, me: true }));
      });
    }
  }, [channelId, messageId, dispatch]);

  if (reactions.length === 0) return null;

  return (
    <div className={styles.reactions} role="group" aria-label="Reactions">
      {reactions.map((reaction) => {
        const eKey = reactionEmojiKey(reaction.emoji);
        return (
        <div
          key={eKey}
          className={styles.pillWrapper}
          onMouseEnter={() => handleReactionHover(eKey)}
          onMouseLeave={handleReactionLeave}
        >
          <button
            className={`${styles.pill} ${reaction.me ? styles.active : ''}`}
            onClick={() => handleReactionClick(reaction)}
            aria-label={`${eKey} ${reaction.count}, ${reaction.me ? 'remove' : 'add'} reaction`}
            title={`${eKey} ${reaction.count}`}
          >
            <span className={styles.emoji}>{renderEmoji(reaction.emoji)}</span>
            <span className={styles.count}>{reaction.count}</span>
          </button>
          {hoveredEmoji === eKey && (
            <div className={styles.reactorTooltip} role="tooltip" aria-label="Users who reacted">
              {loadingReactors ? (
                <span className={styles.reactorLoading}>Loading...</span>
              ) : reactors.length > 0 ? (
                <>
                  <div className={styles.reactorEmoji}>{renderEmoji(reaction.emoji)}</div>
                  <div className={styles.reactorList}>
                    {reactors.slice(0, 10).map(user => (
                      <span key={user.id} className={styles.reactorName}>{user.username}</span>
                    ))}
                    {reactors.length > 10 && (
                      <span className={styles.reactorMore}>and {reactors.length - 10} more...</span>
                    )}
                  </div>
                </>
              ) : (
                <span className={styles.reactorLoading}>{renderEmoji(reaction.emoji)} {reaction.count}</span>
              )}
            </div>
          )}
        </div>
        );
      })}
      <button
        className={styles.addButton}
        onClick={onAddReaction}
        aria-label="Add reaction"
        title="Add Reaction"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            fill="currentColor"
            d="M12.001 2C6.478 2 2.001 6.477 2.001 12s4.477 10 10 10 10-4.477 10-10-4.477-10-10-10zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm5.5-9c.828 0 1.5-.672 1.5-1.5S18.329 8 17.501 8s-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm-7 0c.828 0 1.5-.672 1.5-1.5S11.329 8 10.501 8s-1.5.672-1.5 1.5.672 1.5 1.5 1.5zM12 17.5c2.33 0 4.32-1.45 5.116-3.5H6.884A5.508 5.508 0 0 0 12 17.5z"
          />
        </svg>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={styles.plusIcon}>
          <path fill="currentColor" d="M6.5 1h-1v4.5H1v1h4.5V11h1V6.5H11v-1H6.5V1z" />
        </svg>
      </button>
    </div>
  );
};
