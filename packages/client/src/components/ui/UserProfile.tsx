import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { selectPresences } from '../../stores/selectors';
import type { GuildMember } from '../../stores/membersSlice';
import type { Role } from '../../stores/rolesSlice';
import { api } from '../../api/rest';
import { snowflakeToDate, isValidSnowflake } from '../../../../common/src/utils/snowflake';
import styles from './userProfile.module.scss';

export interface UserProfileProps {
  userId: string;
  guildId?: string;
  onClose: () => void;
}

interface MutualGuildData {
  id: string;
  name: string;
  icon: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
};

const STATUS_COLORS: Record<string, string> = {
  online: '#28aa5e',
  idle: '#f5b737',
  dnd: '#f74448',
  offline: '#858993',
};

export const UserProfile = ({ userId, guildId, onClose }: UserProfileProps) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [noteText, setNoteText] = useState('');

  // API-fetched profile data
  const [profileBio, setProfileBio] = useState<string | null>(null);
  const [profilePronouns, setProfilePronouns] = useState<string | null>(null);
  const [profileAccentColor, setProfileAccentColor] = useState<number | null>(null);
  const [apiMutualGuilds, setApiMutualGuilds] = useState<MutualGuildData[]>([]);
  const [apiMutualFriendsCount, setApiMutualFriendsCount] = useState(0);

  const relationships = useAppSelector(s => s.relationships.relationships);
  const presences = useAppSelector(selectPresences);
  const allMembers = useAppSelector(s => s.members.membersByGuild);
  const roles = useAppSelector(s => guildId ? s.roles.rolesByGuild[guildId] : undefined);

  // Find the user from relationships or member lists
  const relUser = relationships[userId]?.user;

  // Search member lists for additional data
  const memberUser = (() => {
    for (const memberList of Object.values(allMembers)) {
      const found = memberList.find((m: GuildMember) => m.user.id === userId);
      if (found) return found.user;
    }
    return null;
  })();

  const displayUsername = memberUser?.username ?? relUser?.username ?? 'Unknown User';
  const displayName = memberUser?.displayName ?? relUser?.display_name ?? displayUsername;
  const avatarUrl = memberUser?.avatar ?? relUser?.avatar ?? null;

  const bio = profileBio;
  const pronouns = profilePronouns;
  const bannerColor = profileAccentColor as number | null;

  // The account's creation date isn't stored separately -- it's encoded in the
  // Snowflake ID itself. Derive it directly
  // rather than showing a placeholder.
  const accountCreatedAt = isValidSnowflake(userId) ? snowflakeToDate(userId) : null;

  const presence = presences[userId];
  const statusStr = presence?.status ?? 'offline';

  // Find member info for the guild
  const guildMemberList = guildId ? allMembers[guildId] : undefined;
  const member: GuildMember | undefined = guildMemberList?.find(
    (m: GuildMember) => m.user.id === userId
  );

  // Fetch profile data from API on mount
  useEffect(() => {
    let cancelled = false;
    api.getUserProfile(userId).then(profile => {
      if (cancelled) return;
      setProfileBio(profile.bio);
      setProfilePronouns(profile.pronouns || null);
      setProfileAccentColor(profile.accent_color);
      setApiMutualGuilds(profile.mutual_guilds);
      setApiMutualFriendsCount(profile.mutual_friends_count);
    }).catch(() => {
      // Profile fetch failed -- display with local data only
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Member roles
  const memberRoles = member?.roles ?? [];
  const resolvedRoles = memberRoles
    .map(roleId => {
      if (!roles) return null;
      return roles.find((r: Role) => r.id === roleId) ?? null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }, [onClose]);

  // `!= null` (not truthy), so a stored accent_color of 0 (#000000, black) renders as black
  // instead of falling through to the default accent colour.
  const bannerStyle: React.CSSProperties = bannerColor != null
    ? { backgroundColor: typeof bannerColor === 'number' ? `#${bannerColor.toString(16).padStart(6, '0')}` : bannerColor }
    : { backgroundColor: '#3b82f6' };

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={handleOverlayClick}
      role="dialog"
      aria-label={`${displayName} profile`}
      aria-modal="true"
    >
      <div className={styles.profileContainer}>
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close profile"
          type="button"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
        <div className={styles.escHint}>
          <span>ESC</span>
        </div>

        <div className={styles.profileCard}>
          <div className={styles.banner} style={bannerStyle} data-testid="profile-banner" />

          <div className={styles.avatarSection}>
            <div className={styles.avatarBorder}>
              <div className={styles.avatar}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className={styles.avatarImage} loading="lazy" />
                ) : (
                  <span className={styles.avatarInitials}>
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div
                className={styles.statusIndicator}
                style={{ backgroundColor: STATUS_COLORS[statusStr] }}
                aria-label={STATUS_LABELS[statusStr] ?? 'Offline'}
              />
            </div>
          </div>

          <div className={styles.profileBody}>
            <div className={styles.nameSection}>
              <h2 className={styles.displayName}>{displayName}</h2>
              <p className={styles.username}>{displayUsername}</p>
              {pronouns && <p className={styles.pronouns}>{pronouns}</p>}
              {presence?.activities?.find(a => a.type === 4) && (
                <p className={styles.customStatus}>
                  {presence.activities.find(a => a.type === 4)?.state ?? ''}
                </p>
              )}
            </div>

            <div className={styles.divider} />

            {bio && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>About Me</h3>
                <p className={styles.sectionText}>{bio}</p>
              </div>
            )}

            {(accountCreatedAt || member) && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Member Since</h3>
                <div className={styles.memberSinceDates}>
                  {accountCreatedAt && (
                    <div className={styles.memberSinceItem}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#3b82f6" aria-hidden="true">
                        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8z" />
                      </svg>
                      <span className={styles.memberSinceDate}>
                        {accountCreatedAt.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                  {accountCreatedAt && member && (
                    <div className={styles.memberSinceSeparator} aria-hidden="true" />
                  )}
                  {member && (
                    <div className={styles.memberSinceItem}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M8 1C4.134 1 1 4.134 1 8s3.134 7 7 7 7-3.134 7-7-3.134-7-7-7z" />
                      </svg>
                      <span className={styles.memberSinceDate}>
                        {new Date(member.joinedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {resolvedRoles.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Roles</h3>
                <div className={styles.rolesList}>
                  {resolvedRoles.map(role => (
                    <span key={role.id} className={styles.rolePill}>
                      <span
                        className={styles.roleDot}
                        style={{
                          backgroundColor: role.color
                            ? `#${role.color.toString(16).padStart(6, '0')}`
                            : undefined,
                        }}
                      />
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {apiMutualGuilds.length > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Mutual Servers -- {apiMutualGuilds.length}
                </h3>
                <div className={styles.mutualList}>
                  {apiMutualGuilds.slice(0, 6).map(guild => (
                    <div key={guild.id} className={styles.mutualItem}>
                      {guild.icon ? (
                        <img
                          src={guild.icon}
                          alt=""
                          className={styles.mutualIcon}
                          loading="lazy"
                        />
                      ) : (
                        <div className={styles.mutualIconFallback}>
                          {guild.name.charAt(0)}
                        </div>
                      )}
                      <span className={styles.mutualName}>{guild.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {apiMutualFriendsCount > 0 && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Mutual Friends -- {apiMutualFriendsCount}
                </h3>
              </div>
            )}

            <div className={styles.divider} />

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Note</h3>
              <textarea
                className={styles.noteInput}
                placeholder="Click to add a note"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                aria-label={`Note about ${displayName}`}
                rows={2}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
