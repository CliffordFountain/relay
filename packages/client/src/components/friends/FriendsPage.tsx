import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  setRelationships,
  removeRelationship,
  setRelationshipsLoading,
  RelationshipType,
  type Relationship,
} from '../../stores/relationshipsSlice';
import { addDmChannel, selectDmChannel } from '../../stores/dmSlice';
import { selectChannel, addChannel } from '../../stores/channelsSlice';
import { selectPresences } from '../../stores/selectors';
import type { Activity } from '../../stores/presenceSlice';
import { api } from '../../api/rest';
import { ActiveNowPanel } from './ActiveNowPanel';
import styles from './friendsPage.module.scss';

type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

export interface FriendsPageProps {
  initialTab?: FriendsTab;
}

export const FriendsPage = ({ initialTab = 'online' }: FriendsPageProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const relationships = useAppSelector(s => s.relationships.relationships);
  const isLoading = useAppSelector(s => s.relationships.isLoading);
  const presences = useAppSelector(selectPresences);

  const [activeTab, setActiveTab] = useState<FriendsTab>(initialTab);
  const [addFriendInput, setAddFriendInput] = useState('');
  const [addFriendStatus, setAddFriendStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    dispatch(setRelationshipsLoading(true));
    api.getRelationships()
      .then(rels => {
        dispatch(setRelationships(rels.map(r => ({
          id: r.id,
          type: r.type as RelationshipType,
          user: r.user,
        }))));
      })
      .catch(() => {
        // Failed to load relationships
      })
      .finally(() => {
        dispatch(setRelationshipsLoading(false));
      });
  }, [dispatch]);

  const allRelationships = Object.values(relationships);
  const friends = allRelationships.filter(r => r.type === RelationshipType.FRIEND);
  const pendingIncoming = allRelationships.filter(r => r.type === RelationshipType.INCOMING_REQUEST);
  const pendingOutgoing = allRelationships.filter(r => r.type === RelationshipType.OUTGOING_REQUEST);
  const pending = allRelationships.filter(
    r => r.type === RelationshipType.INCOMING_REQUEST || r.type === RelationshipType.OUTGOING_REQUEST,
  );
  const blocked = allRelationships.filter(r => r.type === RelationshipType.BLOCKED);

  const getFilteredList = (): Relationship[] => {
    let list: Relationship[];
    switch (activeTab) {
      case 'online':
        list = friends.filter(r => {
          const presence = presences[r.user.id];
          return presence && presence.status !== 'offline';
        });
        break;
      case 'all':
        list = friends;
        break;
      case 'pending':
        list = pending;
        break;
      case 'blocked':
        list = blocked;
        break;
      default:
        list = [];
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(r => {
        const displayName = r.user.display_name ?? r.user.username;
        return (
          r.user.username.toLowerCase().includes(query) ||
          displayName.toLowerCase().includes(query)
        );
      });
    }

    return list;
  };

  const handleAcceptRequest = useCallback(async (userId: string) => {
    setActionError(null);
    try {
      await api.acceptFriendRequest(userId);
      const rels = await api.getRelationships();
      dispatch(setRelationships(rels.map(r => ({
        id: r.id,
        type: r.type as RelationshipType,
        user: r.user,
      }))));
    } catch {
      setActionError('Failed to accept friend request');
    }
  }, [dispatch]);

  const handleDeclineRequest = useCallback(async (userId: string) => {
    setActionError(null);
    try {
      await api.removeRelationship(userId);
      dispatch(removeRelationship(userId));
    } catch {
      setActionError('Failed to decline friend request');
    }
  }, [dispatch]);

  const handleCancelRequest = useCallback(async (userId: string) => {
    setActionError(null);
    try {
      await api.removeRelationship(userId);
      dispatch(removeRelationship(userId));
    } catch {
      setActionError('Failed to cancel friend request');
    }
  }, [dispatch]);

  const handleRemoveFriend = useCallback(async (userId: string) => {
    setActionError(null);
    try {
      await api.removeRelationship(userId);
      dispatch(removeRelationship(userId));
    } catch {
      setActionError('Failed to remove friend');
    }
  }, [dispatch]);

  const handleBlockUser = useCallback(async (userId: string) => {
    setActionError(null);
    try {
      await api.blockUser(userId);
      const rels = await api.getRelationships();
      dispatch(setRelationships(rels.map(r => ({
        id: r.id,
        type: r.type as RelationshipType,
        user: r.user,
      }))));
    } catch {
      setActionError('Failed to block user');
    }
  }, [dispatch]);

  const handleUnblockUser = useCallback(async (userId: string) => {
    setActionError(null);
    try {
      await api.removeRelationship(userId);
      dispatch(removeRelationship(userId));
    } catch {
      setActionError('Failed to unblock user');
    }
  }, [dispatch]);

  const handleMessageUser = useCallback(async (userId: string) => {
    try {
      const dm = await api.createDm(userId);
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
    } catch {
      setActionError('Failed to open DM');
    }
  }, [dispatch, navigate]);

  const handleAddFriend = useCallback(async () => {
    if (!addFriendInput.trim()) return;

    const username = addFriendInput.trim();
    setAddFriendStatus(null);
    try {
      await api.sendFriendRequest(username);
      setAddFriendStatus({
        type: 'success',
        message: `Success! Your friend request to ${username} was sent.`,
      });
      setAddFriendInput('');
      // Re-fetch relationships
      const rels = await api.getRelationships();
      dispatch(setRelationships(rels.map(r => ({
        id: r.id,
        type: r.type as RelationshipType,
        user: r.user,
      }))));
    } catch (err: unknown) {
      const message = (err && typeof err === 'object' && 'detail' in err)
        ? (() => {
            const detail = (err as { detail: unknown }).detail;
            if (typeof detail === 'object' && detail !== null && 'message' in detail) {
              return String((detail as { message: string }).message);
            }
            if (typeof detail === 'string') {
              return detail;
            }
            return "Hm, that didn't work. Double-check that the username is correct.";
          })()
        : (err && typeof err === 'object' && 'message' in err)
          ? String((err as { message: string }).message)
          : "Hm, that didn't work. Double-check that the username is correct.";
      setAddFriendStatus({ type: 'error', message });
    }
  }, [addFriendInput, dispatch]);

  const getCustomStatusText = (userId: string): string | null => {
    const presence = presences[userId];
    if (!presence?.activities) return null;
    const customActivity = presence.activities.find((a: Activity) => a.type === 4);
    return customActivity?.state ?? null;
  };

  const filteredList = getFilteredList();
  const pendingCount = pending.length;

  return (
    <div className={styles.outerContainer}>
    <div className={styles.container} role="main" aria-label="Friends">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <svg className={styles.friendsIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-2-4a2 2 0 1 1 4 0 2 2 0 0 1-4 0Z" />
            <path d="M3 6a4 4 0 1 1 8 0 4 4 0 0 1-8 0Zm4-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
            <path d="M20 22v-1c0-3.87-3.13-7-7-7h-2c-3.87 0-7 3.13-7 7v1h2v-1c0-2.76 2.24-5 5-5h2c2.76 0 5 2.24 5 5v1h2Z" />
            <path d="M7 22v-1c0-.55-.09-1.08-.26-1.57A5.53 5.53 0 0 0 2 14v8h5Z" />
          </svg>
          <h2 className={styles.headerTitle}>Friends</h2>
          <div className={styles.headerDivider} aria-hidden="true" />
          <nav className={styles.tabBar} role="tablist" aria-label="Friends tabs">
            <button
              className={`${styles.tab} ${activeTab === 'online' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('online')}
              role="tab"
              aria-selected={activeTab === 'online'}
              type="button"
            >
              Online
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'all' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('all')}
              role="tab"
              aria-selected={activeTab === 'all'}
              type="button"
            >
              All
            </button>
            {(pendingCount > 0 || activeTab === 'pending') && (
              <button
                className={`${styles.tab} ${activeTab === 'pending' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('pending')}
                role="tab"
                aria-selected={activeTab === 'pending'}
                type="button"
              >
                Pending
                {pendingCount > 0 && (
                  <span className={styles.pendingBadge}>{pendingCount}</span>
                )}
              </button>
            )}
            {(blocked.length > 0 || activeTab === 'blocked') && (
              <button
                className={`${styles.tab} ${activeTab === 'blocked' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('blocked')}
                role="tab"
                aria-selected={activeTab === 'blocked'}
                type="button"
              >
                Blocked
              </button>
            )}
            <button
              className={`${styles.tabAddFriend} ${activeTab === 'add' ? styles.tabAddFriendActive : ''}`}
              onClick={() => setActiveTab('add')}
              role="tab"
              aria-selected={activeTab === 'add'}
              type="button"
            >
              Add Friend
            </button>
          </nav>
        </div>
      </header>

      <div className={styles.content} role="tabpanel">
        {actionError && (
          <div className={styles.errorBanner} role="alert">
            {actionError}
          </div>
        )}

        {activeTab !== 'add' && (
          <div className={styles.searchBar}>
            <input
              className={styles.searchInput}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search friends"
            />
            <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z" />
            </svg>
          </div>
        )}

        {activeTab === 'add' ? (
          <div className={styles.addFriendSection}>
            <h3 className={styles.addFriendTitle}>ADD FRIEND</h3>
            <p className={styles.addFriendDescription}>
              You can add friends with their Relay username.
            </p>
            <div className={`${styles.addFriendForm} ${addFriendStatus?.type === 'error' ? styles.addFriendFormError : ''} ${addFriendStatus?.type === 'success' ? styles.addFriendFormSuccess : ''}`}>
              <input
                className={styles.addFriendInput}
                type="text"
                value={addFriendInput}
                onChange={e => {
                  setAddFriendInput(e.target.value);
                  setAddFriendStatus(null);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleAddFriend();
                  }
                }}
                placeholder="You can add friends with their Relay username."
                aria-label="Add friend by username"
              />
              <button
                className={styles.addFriendButton}
                onClick={handleAddFriend}
                disabled={!addFriendInput.trim()}
                type="button"
              >
                Send Friend Request
              </button>
            </div>
            {addFriendStatus && (
              <p
                className={`${styles.addFriendStatusMessage} ${addFriendStatus.type === 'success' ? styles.statusSuccess : styles.statusError}`}
                role="status"
              >
                {addFriendStatus.message}
              </p>
            )}
          </div>
        ) : (
          <>
            {activeTab === 'pending' ? (
              <>
                {pendingIncoming.length > 0 && (
                  <>
                    <div className={styles.listHeader}>
                      <span className={styles.listHeaderText}>
                        {`Incoming \u2014 ${pendingIncoming.length}`}
                      </span>
                    </div>
                    <div className={styles.friendsList} role="list">
                      {pendingIncoming.map(rel => {
                        const friendPresence = presences[rel.user.id];
                        const friendStatus = friendPresence?.status ?? 'offline';
                        return (
                          <FriendListItem
                            key={rel.user.id}
                            relationship={rel}
                            presenceStatus={friendStatus}
                            customStatusText={getCustomStatusText(rel.user.id)}
                            onAccept={handleAcceptRequest}
                            onDecline={handleDeclineRequest}
                            onCancel={handleCancelRequest}
                            onRemove={handleRemoveFriend}
                            onBlock={handleBlockUser}
                            onUnblock={handleUnblockUser}
                            onMessage={handleMessageUser}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
                {pendingOutgoing.length > 0 && (
                  <>
                    <div className={styles.listHeader}>
                      <span className={styles.listHeaderText}>
                        {`Outgoing \u2014 ${pendingOutgoing.length}`}
                      </span>
                    </div>
                    <div className={styles.friendsList} role="list">
                      {pendingOutgoing.map(rel => {
                        const friendPresence = presences[rel.user.id];
                        const friendStatus = friendPresence?.status ?? 'offline';
                        return (
                          <FriendListItem
                            key={rel.user.id}
                            relationship={rel}
                            presenceStatus={friendStatus}
                            customStatusText={getCustomStatusText(rel.user.id)}
                            onAccept={handleAcceptRequest}
                            onDecline={handleDeclineRequest}
                            onCancel={handleCancelRequest}
                            onRemove={handleRemoveFriend}
                            onBlock={handleBlockUser}
                            onUnblock={handleUnblockUser}
                            onMessage={handleMessageUser}
                          />
                        );
                      })}
                    </div>
                  </>
                )}
                {pending.length === 0 && !isLoading && (
                  <div className={styles.emptyState}>
                    <svg className={styles.emptyIllustration} width="160" height="120" viewBox="0 0 160 120" fill="none" aria-hidden="true">
                      <rect x="40" y="20" width="80" height="55" rx="6" stroke="currentColor" strokeWidth="2" fill="none" />
                      <path d="M40 30 L80 55 L120 30" stroke="currentColor" strokeWidth="2" fill="none" />
                      <line x1="60" y1="90" x2="100" y2="90" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <line x1="70" y1="100" x2="90" y2="100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <p className={styles.emptyText}>
                      There are no pending friend requests.
                    </p>
                  </div>
                )}
                {isLoading && (
                  <div className={styles.loadingState}>
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.listHeader}>
                  <span className={styles.listHeaderText}>
                    {activeTab === 'online' && `Online \u2014 ${filteredList.length}`}
                    {activeTab === 'all' && `All Friends \u2014 ${filteredList.length}`}
                    {activeTab === 'blocked' && `Blocked \u2014 ${filteredList.length}`}
                  </span>
                </div>

                {isLoading ? (
                  <div className={styles.loadingState}>
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                    <div className={styles.skeleton} />
                  </div>
                ) : filteredList.length === 0 ? (
                  <div className={styles.emptyState}>
                    {activeTab === 'online' && (
                      <svg className={styles.emptyIllustration} width="160" height="120" viewBox="0 0 160 120" fill="none" aria-hidden="true">
                        {/* Sitting figure outline */}
                        <circle cx="80" cy="28" r="12" stroke="currentColor" strokeWidth="2" fill="none" />
                        <path d="M80 40 L80 70" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M80 50 L65 62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M80 50 L95 62" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M80 70 L65 90 L60 90" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        <path d="M80 70 L95 90 L100 90" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        <line x1="55" y1="90" x2="105" y2="90" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <line x1="65" y1="100" x2="95" y2="100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    {activeTab === 'all' && (
                      <svg className={styles.emptyIllustration} width="160" height="120" viewBox="0 0 160 120" fill="none" aria-hidden="true">
                        {/* Two people outlines */}
                        <circle cx="60" cy="30" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                        <path d="M45 65 Q45 45 60 45 Q75 45 75 65" stroke="currentColor" strokeWidth="2" fill="none" />
                        <circle cx="100" cy="30" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
                        <path d="M85 65 Q85 45 100 45 Q115 45 115 65" stroke="currentColor" strokeWidth="2" fill="none" />
                        <line x1="75" y1="55" x2="85" y2="55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />
                        <line x1="55" y1="80" x2="105" y2="80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <line x1="65" y1="90" x2="95" y2="90" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    {activeTab === 'blocked' && (
                      <svg className={styles.emptyIllustration} width="160" height="120" viewBox="0 0 160 120" fill="none" aria-hidden="true">
                        {/* Shield with check */}
                        <path d="M80 15 L110 30 L110 60 Q110 85 80 100 Q50 85 50 60 L50 30 Z" stroke="currentColor" strokeWidth="2" fill="none" />
                        <path d="M68 58 L76 66 L92 50" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                    <p className={styles.emptyText}>
                      {activeTab === 'online' && 'No one is online right now.'}
                      {activeTab === 'all' && "You don't have any friends yet."}
                      {activeTab === 'blocked' && "You haven't blocked anyone."}
                    </p>
                  </div>
                ) : (
                  <div className={styles.friendsList} role="list">
                    {filteredList.map(rel => {
                      const friendPresence = presences[rel.user.id];
                      const friendStatus = friendPresence?.status ?? 'offline';
                      return (
                        <FriendListItem
                          key={rel.user.id}
                          relationship={rel}
                          presenceStatus={friendStatus}
                          customStatusText={getCustomStatusText(rel.user.id)}
                          onAccept={handleAcceptRequest}
                          onDecline={handleDeclineRequest}
                          onCancel={handleCancelRequest}
                          onRemove={handleRemoveFriend}
                          onBlock={handleBlockUser}
                          onUnblock={handleUnblockUser}
                          onMessage={handleMessageUser}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
    <ActiveNowPanel />
    </div>
  );
};

const STATUS_COLORS: Record<string, string> = {
  online: '#28aa5e',
  idle: '#f5b737',
  dnd: '#f74448',
  offline: '#858993',
};

interface FriendListItemProps {
  relationship: Relationship;
  presenceStatus: string;
  customStatusText: string | null;
  onAccept: (userId: string) => void;
  onDecline: (userId: string) => void;
  onCancel: (userId: string) => void;
  onRemove: (userId: string) => void;
  onBlock: (userId: string) => void;
  onUnblock: (userId: string) => void;
  onMessage: (userId: string) => void;
}

const FriendListItem = ({
  relationship,
  presenceStatus,
  customStatusText,
  onAccept,
  onDecline,
  onCancel,
  onRemove,
  onBlock: _onBlock,
  onUnblock,
  onMessage,
}: FriendListItemProps) => {
  const { user, type } = relationship;
  const displayName = user.display_name ?? user.username;

  const getStatusText = (): string => {
    switch (type) {
      case RelationshipType.FRIEND: {
        const statusLabels: Record<string, string> = {
          online: 'Online',
          idle: 'Idle',
          dnd: 'Do Not Disturb',
          offline: 'Offline',
        };
        return statusLabels[presenceStatus] ?? 'Offline';
      }
      case RelationshipType.INCOMING_REQUEST:
        return 'Incoming Friend Request';
      case RelationshipType.OUTGOING_REQUEST:
        return 'Outgoing Friend Request';
      case RelationshipType.BLOCKED:
        return 'Blocked';
      default:
        return '';
    }
  };

  return (
    <div className={styles.friendItem} role="listitem" aria-label={`${user.username}`}>
      <div className={styles.friendInfo}>
        <div className={styles.friendAvatar}>
          {user.avatar ? (
            <img src={user.avatar} alt="" className={styles.friendAvatarImage} loading="lazy" />
          ) : (
            <div className={styles.friendAvatarFallback}>
              {user.username.charAt(0).toUpperCase()}
            </div>
          )}
          {type === RelationshipType.FRIEND && (
            <div
              className={styles.friendStatusDot}
              style={{ backgroundColor: STATUS_COLORS[presenceStatus] ?? STATUS_COLORS.offline }}
              aria-label={presenceStatus}
            />
          )}
        </div>
        <div className={styles.friendDetails}>
          <div className={styles.friendNameRow}>
            <span className={styles.friendDisplayName}>{displayName}</span>
            {displayName !== user.username && (
              <span className={styles.friendUsername}>{user.username}</span>
            )}
          </div>
          <span className={styles.friendStatus}>{getStatusText()}</span>
          {customStatusText && (
            <span className={styles.friendCustomStatus}>{customStatusText}</span>
          )}
        </div>
      </div>
      <div className={styles.friendActions}>
        {type === RelationshipType.FRIEND && (
          <>
            <button
              className={styles.actionButton}
              onClick={() => onMessage(user.id)}
              aria-label={`Message ${user.username}`}
              title="Message"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
              </svg>
            </button>
            <button
              className={`${styles.actionButton} ${styles.actionButtonDanger}`}
              onClick={() => onRemove(user.id)}
              aria-label={`Remove ${user.username}`}
              title="Remove Friend"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
              </svg>
            </button>
          </>
        )}
        {type === RelationshipType.INCOMING_REQUEST && (
          <>
            <button
              className={`${styles.actionButton} ${styles.actionButtonAccept}`}
              onClick={() => onAccept(user.id)}
              aria-label={`Accept ${user.username}`}
              title="Accept"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8.99991 16.17L4.82991 12L3.40991 13.41L8.99991 19L20.9999 7.00003L19.5899 5.59003L8.99991 16.17Z" />
              </svg>
            </button>
            <button
              className={`${styles.actionButton} ${styles.actionButtonDanger}`}
              onClick={() => onDecline(user.id)}
              aria-label={`Decline ${user.username}`}
              title="Decline"
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
              </svg>
            </button>
          </>
        )}
        {type === RelationshipType.OUTGOING_REQUEST && (
          <button
            className={`${styles.actionButton} ${styles.actionButtonDanger}`}
            onClick={() => onCancel(user.id)}
            aria-label={`Cancel request to ${user.username}`}
            title="Cancel"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        )}
        {type === RelationshipType.BLOCKED && (
          <button
            className={styles.actionButton}
            onClick={() => onUnblock(user.id)}
            aria-label={`Unblock ${user.username}`}
            title="Unblock"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.902 7.902 0 0 1 12 20zm6.31-3.1L7.1 5.69A7.902 7.902 0 0 1 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
