import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { addGuild, selectGuild } from '../../stores/guildsSlice';
import type { Guild } from '../../stores/guildsSlice';
import { setChannels, selectChannel } from '../../stores/channelsSlice';
import { api } from '../../api/rest';
import { cdnBase } from '../../utils/cdn';
import styles from './discoverModal.module.scss';

export interface DiscoverModalProps {
  onClose: () => void;
}

interface DiscoverGuildCard {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  member_count: number;
}

const SEARCH_DEBOUNCE_MS = 300;

/** ALREADY_EXISTS mapped by the API when the user tries to join a guild they're already in. */
const ALREADY_MEMBER_CODE = 30001;

export const DiscoverModal = ({ onClose }: DiscoverModalProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [guilds, setGuilds] = useState<DiscoverGuildCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGuilds = useCallback(async (searchQuery: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const results = await api.discoverGuilds(searchQuery ? { query: searchQuery } : undefined);
      setGuilds(results);
    } catch {
      setLoadError('Failed to load public servers. Please try again.');
      setGuilds([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load the initial (unfiltered) list on open.
  useEffect(() => {
    void fetchGuilds('');
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      void fetchGuilds(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getAcronym = (name: string): string => {
    return name
      .split(/\s+/)
      .map(word => word.charAt(0))
      .filter(Boolean)
      .slice(0, 3)
      .join('')
      .toUpperCase();
  };

  const handleJoin = async (card: DiscoverGuildCard) => {
    if (joiningId) return;
    setJoiningId(card.id);
    setJoinError(null);

    try {
      let guildData: Guild;
      try {
        const joined = await api.joinDiscoverableGuild(card.id);
        guildData = { ...joined, member_count: card.member_count };
      } catch (err: unknown) {
        const apiErr = err as { code?: number };
        if (apiErr?.code !== ALREADY_MEMBER_CODE) {
          throw err;
        }
        // Already a member -- fetch the full guild record instead of clobbering
        // whatever's already in the store with the partial discover-card fields,
        // then fall through to select/navigate exactly as a fresh join would.
        guildData = await api.getGuild(card.id);
      }

      // Mirrors CreateGuildModal's post-join dispatch sequence: add the guild,
      // seed its channels (and select the first text channel) when available,
      // select the guild, then route to it.
      dispatch(addGuild(guildData));

      try {
        const channels = await api.getGuildChannels(card.id);
        if (Array.isArray(channels) && channels.length > 0) {
          dispatch(setChannels(channels));
          const firstTextChannel = channels
            .filter((c: { type: number }) => c.type === 0)
            .sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0];
          if (firstTextChannel) {
            dispatch(selectChannel(firstTextChannel.id));
          }
        }
      } catch {
        // Non-fatal -- channels will also arrive via the GUILD_CREATE gateway event.
      }

      dispatch(selectGuild(card.id));
      navigate(`/channels/${card.id}`);
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setJoinError(apiErr?.message ?? 'Failed to join server. Please try again.');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Discover servers"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Discover Servers</h2>
          <p className={styles.subtitle}>Find a public community and join instantly -- no invite needed.</p>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
              />
            </svg>
          </button>
        </div>

        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search public servers"
            value={query}
            onChange={handleSearchChange}
            aria-label="Search public servers"
            autoFocus
          />
        </div>

        {joinError && (
          <div className={styles.joinError} role="alert">{joinError}</div>
        )}

        <div className={styles.body}>
          {isLoading ? (
            <div className={styles.stateMessage}>Loading public servers...</div>
          ) : loadError ? (
            <div className={styles.stateMessage}>{loadError}</div>
          ) : guilds.length === 0 ? (
            <div className={styles.stateMessage}>No public servers found yet.</div>
          ) : (
            <div className={styles.grid} role="list" aria-label="Public servers">
              {guilds.map(g => (
                <div key={g.id} className={styles.card} role="listitem">
                  <div className={styles.cardIcon} aria-hidden="true">
                    {g.icon ? (
                      <img
                        src={g.icon.startsWith('data:') ? g.icon : `${cdnBase()}/icons/${g.id}/${g.icon}.png`}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      getAcronym(g.name)
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardName}>{g.name}</div>
                    {g.description && (
                      <div className={styles.cardDescription}>{g.description}</div>
                    )}
                    <div className={styles.cardMemberCount}>
                      {g.member_count.toLocaleString()} {g.member_count === 1 ? 'member' : 'members'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.joinButton}
                    onClick={() => handleJoin(g)}
                    disabled={joiningId === g.id}
                  >
                    {joiningId === g.id ? 'Joining...' : 'Join'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
