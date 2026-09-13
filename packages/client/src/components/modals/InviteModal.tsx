import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setRelationships, RelationshipType } from '../../stores/relationshipsSlice';
import { api } from '../../api/rest';
import styles from './inviteModal.module.scss';

export interface InviteModalProps {
  channelId: string;
  serverName: string;
  onClose: () => void;
}

interface InviteData {
  code: string;
  max_age: number;
  max_uses: number;
  uses: number;
}

const EXPIRY_LABELS: Record<number, string> = {
  1800: '30 minutes',
  3600: '1 hour',
  21600: '6 hours',
  43200: '12 hours',
  86400: '1 day',
  604800: '7 days',
  0: 'never',
};

export const InviteModal = ({ channelId, serverName, onClose }: InviteModalProps) => {
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sentInvites, setSentInvites] = useState<Set<string>>(new Set());
  const [showEditLink, setShowEditLink] = useState(false);
  const [maxAge, setMaxAge] = useState(604800); // 7 days default like Relay
  const [maxUses, setMaxUses] = useState(0);

  const dispatch = useAppDispatch();

  // Get channel name for subtitle
  const channels = useAppSelector(s => s.channels.channels);
  const channelName = channels[channelId]?.name ?? '';

  // Get friends list from relationships — fetch on mount if not loaded
  const relationships = useAppSelector(s => s.relationships.relationships);

  useEffect(() => {
    api.getRelationships()
      .then(rels => {
        dispatch(setRelationships(rels.map((r: { id: string; type: number; user: { id: string; username: string; avatar: string | null; display_name?: string } }) => ({
          id: r.id,
          type: r.type as RelationshipType,
          user: r.user,
        }))));
      })
      .catch(() => { /* ignore */ });
  }, [dispatch]);

  // Get guild members to know who's already in the server
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const membersByGuild = useAppSelector(s => s.members.membersByGuild);
  const guildMembers = selectedGuildId ? membersByGuild[selectedGuildId] ?? [] : [];
  const guildMemberIds = useMemo(
    () => new Set(guildMembers.map(m => m.user.id)),
    [guildMembers],
  );

  // Filter to friends only, excluding those already in the server
  const friends = useMemo(() => {
    return Object.values(relationships)
      .filter(r => r.type === RelationshipType.FRIEND)
      .filter(r => !guildMemberIds.has(r.user.id))
      .filter(r => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          r.user.username.toLowerCase().includes(q) ||
          (r.user.display_name ?? '').toLowerCase().includes(q)
        );
      });
  }, [relationships, guildMemberIds, searchQuery]);

  const createInvite = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.createInvite(channelId, {
        max_age: maxAge,
        max_uses: maxUses,
      });
      setInvite(result);
    } catch {
      setError('Failed to create invite link.');
    } finally {
      setIsLoading(false);
    }
  }, [channelId, maxAge, maxUses]);

  useEffect(() => {
    createInvite();
  }, [createInvite]);

  // Build invite URL — Relay uses relay.gg/{code} (no /invite/ path).
  // Otherwise use VITE_INVITE_BASE or fall back to {origin} directly.
  const inviteBase = import.meta.env.VITE_INVITE_BASE || window.location.origin;
  const inviteUrl = invite ? `${inviteBase}/${invite.code}` : '';

  // Expiry label for display
  const expiryLabel = EXPIRY_LABELS[invite?.max_age ?? maxAge] ?? `${maxAge}s`;

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSendInvite = (userId: string) => {
    // Mark as sent (UI only — a full implementation would DM the invite link)
    setSentInvites(prev => new Set(prev).add(userId));
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={`Invite friends to ${serverName}`}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Invite friends to {serverName}</h2>
            {channelName && (
              <div className={styles.subtitle}>
                Recipients will land in <span className={styles.channelRef}># {channelName}</span>
              </div>
            )}
          </div>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.error}>{error}</div>}

          {/* Search friends */}
          <div className={styles.searchWrapper}>
            <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16C6.691 16 4 13.309 4 10Z" />
            </svg>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search for friends"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search for friends"
            />
          </div>

          {/* Friends list */}
          <div className={styles.friendsList}>
            {friends.length === 0 && !searchQuery && (
              <div className={styles.emptyState}>
                All your friends are already in this server!
              </div>
            )}
            {friends.length === 0 && searchQuery && (
              <div className={styles.emptyState}>
                No friends found matching &quot;{searchQuery}&quot;
              </div>
            )}
            {friends.map(friend => (
              <div key={friend.user.id} className={styles.friendRow}>
                <div className={styles.friendAvatar}>
                  {friend.user.avatar ? (
                    <img src={friend.user.avatar} alt="" className={styles.avatarImg} />
                  ) : (
                    <div className={styles.avatarFallback}>
                      {(friend.user.display_name ?? friend.user.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className={styles.friendInfo}>
                  <span className={styles.friendName}>
                    {friend.user.display_name || friend.user.username}
                  </span>
                  <span className={styles.friendUsername}>{friend.user.username}</span>
                </div>
                <button
                  className={`${styles.inviteBtn} ${sentInvites.has(friend.user.id) ? styles.inviteSent : ''}`}
                  onClick={() => handleSendInvite(friend.user.id)}
                  disabled={sentInvites.has(friend.user.id)}
                  type="button"
                >
                  {sentInvites.has(friend.user.id) ? 'Sent' : 'Invite'}
                </button>
              </div>
            ))}
          </div>

          {/* Invite link section */}
          <div className={styles.linkSection}>
            <div className={styles.linkLabel}>Or send a server invite link to a friend</div>
            <div className={styles.linkRow}>
              <input
                className={styles.linkInput}
                type="text"
                value={isLoading ? 'Generating...' : inviteUrl}
                readOnly
                aria-label="Invite link"
              />
              <button
                className={`${styles.copyButton} ${copied ? styles.copied : ''}`}
                onClick={handleCopy}
                disabled={isLoading || !invite}
                type="button"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className={styles.expiryInfo}>
              Your invite link expires in {expiryLabel}.
              {' '}
              <button
                className={styles.editLinkBtn}
                onClick={() => setShowEditLink(prev => !prev)}
                type="button"
              >
                Edit invite link.
              </button>
            </div>

            {showEditLink && (
              <div className={styles.editSettings}>
                <div className={styles.settingsRow}>
                  <div className={styles.settingGroup}>
                    <label className={styles.settingLabel} htmlFor="invite-expiry">
                      EXPIRE AFTER
                    </label>
                    <select
                      id="invite-expiry"
                      className={styles.select}
                      value={maxAge}
                      onChange={(e) => setMaxAge(Number(e.target.value))}
                    >
                      <option value={1800}>30 minutes</option>
                      <option value={3600}>1 hour</option>
                      <option value={21600}>6 hours</option>
                      <option value={43200}>12 hours</option>
                      <option value={86400}>1 day</option>
                      <option value={604800}>7 days</option>
                      <option value={0}>Never</option>
                    </select>
                  </div>
                  <div className={styles.settingGroup}>
                    <label className={styles.settingLabel} htmlFor="invite-max-uses">
                      MAX NUMBER OF USES
                    </label>
                    <select
                      id="invite-max-uses"
                      className={styles.select}
                      value={maxUses}
                      onChange={(e) => setMaxUses(Number(e.target.value))}
                    >
                      <option value={0}>No limit</option>
                      <option value={1}>1 use</option>
                      <option value={5}>5 uses</option>
                      <option value={10}>10 uses</option>
                      <option value={25}>25 uses</option>
                      <option value={50}>50 uses</option>
                      <option value={100}>100 uses</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
