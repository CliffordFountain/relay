import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { closeModal } from '../../stores/uiSlice';
import { addDmChannel, selectDmChannel } from '../../stores/dmSlice';
import { addChannel, selectChannel } from '../../stores/channelsSlice';
import { markRead } from '../../stores/notificationsSlice';
import { RelationshipType } from '../../stores/relationshipsSlice';
import type { RelationshipUser } from '../../stores/relationshipsSlice';
import { api } from '../../api/rest';
import styles from './createGroupDMModal.module.scss';


export interface CreateGroupDMModalProps {
  onClose?: () => void;
}

export const CreateGroupDMModal = ({ onClose }: CreateGroupDMModalProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const relationships = useAppSelector(s => s.relationships.relationships);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const friends = useMemo(() => {
    return Object.values(relationships)
      .filter(r => r.type === RelationshipType.FRIEND)
      .map(r => r.user);
  }, [relationships]);

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.display_name && u.display_name.toLowerCase().includes(q))
    );
  }, [friends, searchQuery]);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    }
    dispatch(closeModal());
  }, [dispatch, onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const toggleUser = useCallback((userId: string) => {
    setSelectedUserIds(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      }
      // No cap — group DMs can include any number of friends.
      return [...prev, userId];
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (selectedUserIds.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      let channel: { id: string; type: number; recipients: Array<{ id: string; username: string; avatar: string | null }>; last_message_id: string | null };

      if (selectedUserIds.length === 1) {
        const soleUserId = selectedUserIds[0];
        if (!soleUserId) return;
        channel = await api.createDm(soleUserId);
      } else {
        channel = await api.createGroupDm(selectedUserIds);
      }

      dispatch(addDmChannel(channel));
      dispatch(addChannel({
        id: channel.id,
        guild_id: null,
        type: channel.type,
        name: channel.recipients.map(r => r.username).join(', '),
        topic: null,
        position: 0,
        parent_id: null,
      }));
      dispatch(selectDmChannel(channel.id));
      dispatch(selectChannel(channel.id));
      dispatch(markRead(channel.id));
      navigate(`/channels/@me/${channel.id}`);
      handleClose();
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError.message ?? 'Failed to create group DM');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedUserIds, isSubmitting, dispatch, navigate, handleClose]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleCreate();
  };

  const getSelectedNames = (): string => {
    return selectedUserIds
      .map(id => {
        const friend = friends.find(f => f.id === id);
        return friend?.display_name ?? friend?.username ?? 'Unknown';
      })
      .join(', ');
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Select Friends"
    >
      <div className={styles.modal}>
        <form onSubmit={handleFormSubmit}>
          <div className={styles.header}>
            <h2 className={styles.title}>Select Friends</h2>
            <p className={styles.subtitle}>
              {selectedUserIds.length > 0
                ? `${selectedUserIds.length} friend${selectedUserIds.length === 1 ? '' : 's'} selected.`
                : 'Select friends to add to the group.'}
            </p>
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleClose}
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

          <div className={styles.body}>
            <div className={styles.searchContainer}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Type the username of a friend"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search friends"
                autoFocus
              />
            </div>

            {selectedUserIds.length > 0 && (
              <div className={styles.selectedTags} aria-label="Selected friends">
                {selectedUserIds.map(id => {
                  const friend = friends.find(f => f.id === id);
                  if (!friend) return null;
                  return (
                    <span key={id} className={styles.selectedTag}>
                      {friend.display_name ?? friend.username}
                      <button
                        type="button"
                        className={styles.removeTag}
                        onClick={() => toggleUser(id)}
                        aria-label={`Remove ${friend.display_name ?? friend.username}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                        </svg>
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className={styles.friendList} role="listbox" aria-label="Friends list">
              {filteredFriends.length === 0 ? (
                <div className={styles.emptyState}>
                  {friends.length === 0
                    ? 'You have no friends to add.'
                    : 'No friends found matching your search.'}
                </div>
              ) : (
                filteredFriends.map(friend => (
                  <FriendRow
                    key={friend.id}
                    friend={friend}
                    selected={selectedUserIds.includes(friend.id)}
                    disabled={false}
                    onToggle={toggleUser}
                  />
                ))
              )}
            </div>

            {error && <p className={styles.error}>{error}</p>}
          </div>

          <div className={styles.footer}>
            {selectedUserIds.length > 0 && (
              <span className={styles.footerInfo}>
                Going to: {getSelectedNames()}
              </span>
            )}
            <button
              type="submit"
              className={styles.createButton}
              disabled={selectedUserIds.length === 0 || isSubmitting}
            >
              {isSubmitting
                ? 'Creating...'
                : selectedUserIds.length <= 1
                  ? 'Create DM'
                  : 'Create Group DM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface FriendRowProps {
  friend: RelationshipUser;
  selected: boolean;
  disabled: boolean;
  onToggle: (userId: string) => void;
}

const FriendRow = ({ friend, selected, disabled, onToggle }: FriendRowProps) => {
  return (
    <div
      className={`${styles.friendRow} ${selected ? styles.friendRowSelected : ''} ${disabled ? styles.friendRowDisabled : ''}`}
      onClick={() => {
        if (!disabled || selected) {
          onToggle(friend.id);
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!disabled || selected) {
            onToggle(friend.id);
          }
        }
      }}
    >
      <div className={styles.friendAvatar}>
        {friend.avatar ? (
          <img
            src={friend.avatar}
            alt=""
            className={styles.friendAvatarImage}
            loading="lazy"
          />
        ) : (
          <div className={styles.friendAvatarFallback}>
            {friend.username.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <span className={styles.friendName}>
        {friend.display_name ?? friend.username}
      </span>
      <span className={styles.friendUsername}>
        {friend.username}
      </span>
      <div className={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}>
        {selected && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.99991 16.17L4.82991 12L3.40991 13.41L8.99991 19L20.9999 7L19.5899 5.59L8.99991 16.17Z" />
          </svg>
        )}
      </div>
    </div>
  );
};
