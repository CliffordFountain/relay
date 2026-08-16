import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setDmChannels, selectDmChannel, removeDmChannel, addDmChannel } from '../../stores/dmSlice';
import { selectChannel, addChannel, clearSelectedChannel } from '../../stores/channelsSlice';
import { openModal } from '../../stores/uiSlice';
import { markRead } from '../../stores/notificationsSlice';
import { selectPresences } from '../../stores/selectors';
import type { Activity } from '../../stores/presenceSlice';
import { api } from '../../api/rest';
import styles from './dmList.module.scss';

export interface DMListProps {
  onOpenSettings?: () => void;
}

export const DMList = (_props: DMListProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const dmChannels = useAppSelector(s => s.dm.dmChannels);
  const selectedDmChannelId = useAppSelector(s => s.dm.selectedDmChannelId);
  const unreadByChannel = useAppSelector(s => s.notifications.unreadByChannel);
  const mentionsByChannel = useAppSelector(s => s.notifications.mentionsByChannel);
  const presences = useAppSelector(selectPresences);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getDmChannels().then(channels => {
      dispatch(setDmChannels(channels));
    }).catch(() => {
      // Failed to load DM channels
    });
  }, [dispatch]);

  // Filter DM channels based on search query
  const filteredDmChannels = useMemo(() => {
    if (!searchQuery.trim()) return dmChannels;

    const lowerQuery = searchQuery.toLowerCase().trim();
    return dmChannels.filter(dm => {
      const recipient = dm.recipients[0];
      if (!recipient) return false;
      return recipient.username.toLowerCase().includes(lowerQuery);
    });
  }, [dmChannels, searchQuery]);

  // Check if the typed username matches an existing DM recipient
  const hasExactMatch = useMemo(() => {
    if (!searchQuery.trim()) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return dmChannels.some(dm => {
      const recipient = dm.recipients[0];
      return recipient && recipient.username.toLowerCase() === lowerQuery;
    });
  }, [dmChannels, searchQuery]);

  // Show "start a conversation" option when search doesn't match any existing DM
  const showStartConversation = searchQuery.trim().length > 0 && filteredDmChannels.length === 0 && !hasExactMatch;

  // Total items for keyboard navigation
  const totalItems = filteredDmChannels.length + (showStartConversation ? 1 : 0);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchQuery]);

  const handleSelectDm = useCallback((channelId: string) => {
    const dm = dmChannels.find(d => d.id === channelId);
    if (dm) {
      dispatch(addChannel({
        id: dm.id,
        guild_id: null,
        type: dm.type,
        name: dm.recipients[0]?.username ?? 'Direct Message',
        topic: null,
        position: 0,
        parent_id: null,
      }));
    }
    dispatch(selectDmChannel(channelId));
    dispatch(selectChannel(channelId));
    dispatch(markRead(channelId));
    navigate(`/channels/@me/${channelId}`);
    setSearchQuery('');
    setSearchFocused(false);
  }, [dmChannels, dispatch, navigate]);

  const handleStartConversation = useCallback(async (username: string) => {
    try {
      // Try to create a DM by searching for the user by username.
      // The API's createDm expects a recipient_id, so we need to
      // use a username-based endpoint if available, or fall back.
      // For now, attempt to use the username as an identifier.
      const dm = await api.createDm(username);
      dispatch(addDmChannel(dm));
      dispatch(addChannel({
        id: dm.id,
        guild_id: null,
        type: dm.type,
        name: dm.recipients[0]?.username ?? 'Direct Message',
        topic: null,
        position: 0,
        parent_id: null,
      }));
      dispatch(selectDmChannel(dm.id));
      dispatch(selectChannel(dm.id));
      navigate(`/channels/@me/${dm.id}`);
      setSearchQuery('');
      setSearchFocused(false);
    } catch {
      // Could not start conversation - user might not exist
    }
  }, [dispatch, navigate]);

  const handleCloseDm = (e: React.MouseEvent, channelId: string) => {
    e.stopPropagation();
    dispatch(removeDmChannel(channelId));
  };

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => (prev < totalItems - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => (prev > 0 ? prev - 1 : totalItems - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showStartConversation && selectedSearchIndex === 0) {
        handleStartConversation(searchQuery.trim());
      } else {
        const adjustedIndex = showStartConversation ? selectedSearchIndex - 1 : selectedSearchIndex;
        const dm = filteredDmChannels[adjustedIndex];
        if (dm) {
          handleSelectDm(dm.id);
        }
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchFocused(false);
      searchInputRef.current?.blur();
    }
  }, [totalItems, showStartConversation, selectedSearchIndex, filteredDmChannels, searchQuery, handleSelectDm, handleStartConversation]);

  return (
    <div className={styles.sidebar} role="navigation" aria-label="Direct Messages">
      <div className={styles.header}>
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Find or start a conversation"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => {
            // Delay blur to allow click events on results
            setTimeout(() => setSearchFocused(false), 200);
          }}
          onKeyDown={handleSearchKeyDown}
          aria-label="Find or start a conversation"
        />
      </div>

      <div className={styles.navItems}>
        <div
          className={`${styles.navItem} ${!selectedDmChannelId ? styles.navItemActive : ''}`}
          onClick={() => {
            dispatch(selectDmChannel(null));
            dispatch(clearSelectedChannel());
            navigate('/channels/@me');
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              dispatch(selectDmChannel(null));
              dispatch(clearSelectedChannel());
              navigate('/channels/@me');
            }
          }}
          aria-label="Friends"
        >
          <svg className={styles.navSvgIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
            <path d="M3 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0ZM7.5 12c-3.59 0-6.5 1.69-6.5 3.75V18h13v-2.25C14 13.69 11.09 12 7.5 12ZM13 13c-1.23 0-2.38.22-3.4.6A5.1 5.1 0 0 1 12 17v1h10v-1.5c0-2.03-3.69-3.5-9-3.5Z" />
          </svg>
          <span className={styles.navLabel}>Friends</span>
        </div>
      </div>

      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Direct Messages</span>
        <button
          className={styles.createDmButton}
          onClick={() => dispatch(openModal({ modal: 'createGroupDM' }))}
          aria-label="Create DM"
          title="Create DM"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 7H11V11H7V13H11V17H13V13H17V11H13V7Z" />
          </svg>
        </button>
      </div>

      <div className={styles.dmList}>
        {showStartConversation && (
          <div
            className={`${styles.dmItem} ${selectedSearchIndex === 0 ? styles.searchHighlight : ''}`}
            onClick={() => handleStartConversation(searchQuery.trim())}
            role="button"
            tabIndex={0}
            aria-label={`Start a conversation with ${searchQuery.trim()}`}
          >
            <div className={styles.avatar}>
              <div className={styles.avatarFallback}>+</div>
            </div>
            <div className={styles.dmInfo}>
              <span className={styles.dmName}>Start a conversation with &quot;{searchQuery.trim()}&quot;</span>
            </div>
          </div>
        )}

        {filteredDmChannels.map((dm, index) => {
          const recipient = dm.recipients[0];
          if (!recipient) return null;

          const isGroupDm = dm.type === 3;
          const unreadCount = unreadByChannel[dm.id] ?? 0;
          const mentionCount = mentionsByChannel[dm.id] ?? 0;
          const isSelected = selectedDmChannelId === dm.id;
          const recipientPresence = presences[recipient.id];
          const recipientStatus = recipientPresence?.status ?? 'offline';
          const searchIdx = showStartConversation ? index + 1 : index;
          const isSearchHighlighted = searchFocused && searchQuery.trim() && searchIdx === selectedSearchIndex;

          // Get game/app activity for the recipient (type 0 = Playing)
          const gameActivity = recipientPresence?.activities?.find(
            (a: Activity) => a.type === 0 || a.type === 1 || a.type === 2 || a.type === 3,
          );
          const activityName = gameActivity?.name ?? null;

          // Build display name for group DMs
          const displayName = isGroupDm
            ? dm.recipients.map(r => r.username).join(', ')
            : recipient.username;

          return (
            <div
              key={dm.id}
              className={`${styles.dmItem} ${isSelected ? styles.active : ''} ${unreadCount > 0 ? styles.unread : ''} ${isSearchHighlighted ? styles.searchHighlight : ''}`}
              onClick={() => handleSelectDm(dm.id)}
              role="button"
              tabIndex={0}
              aria-label={isGroupDm ? `Group DM: ${displayName}` : `Direct message with ${recipient.username}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSelectDm(dm.id);
              }}
            >
              <div className={styles.avatar}>
                {recipient.avatar ? (
                  <img
                    src={recipient.avatar}
                    alt=""
                    className={styles.avatarImage}
                    loading="lazy"
                  />
                ) : (
                  <div className={styles.avatarFallback}>
                    {isGroupDm ? dm.recipients.length.toString() : recipient.username.charAt(0).toUpperCase()}
                  </div>
                )}
                {!isGroupDm && (
                  <div
                    className={styles.statusDot}
                    style={{
                      backgroundColor:
                        recipientStatus === 'online' ? '#28aa5e' :
                        recipientStatus === 'idle' ? '#f5b737' :
                        recipientStatus === 'dnd' ? '#f74448' :
                        '#858993',
                    }}
                    aria-label={recipientStatus}
                  />
                )}
              </div>
              <div className={styles.dmInfo}>
                <span className={styles.dmName}>{displayName}</span>
                {isGroupDm ? (
                  <span className={styles.dmSubtext}>{dm.recipients.length} Members</span>
                ) : activityName ? (
                  <span className={styles.dmSubtext}>{activityName}</span>
                ) : null}
              </div>
              {mentionCount > 0 && (
                <span className={styles.mentionBadge}>{mentionCount}</span>
              )}
              <button
                className={styles.closeBtn}
                onClick={(e) => handleCloseDm(e, dm.id)}
                aria-label={isGroupDm ? `Close group DM` : `Close DM with ${recipient.username}`}
                type="button"
              >
                &times;
              </button>
            </div>
          );
        })}

        {searchQuery.trim() && filteredDmChannels.length === 0 && !showStartConversation && (
          <div className={styles.noResults}>
            No results found
          </div>
        )}
      </div>

    </div>
  );
};
