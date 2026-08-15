import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppSelector } from '../../hooks/useAppDispatch';
import type { GuildMember } from '../../stores/membersSlice';
import { UserProfile } from './UserProfile';
import styles from './userPopover.module.scss';

export interface UserPopoverProps {
  member: GuildMember;
  position: { top: number; left: number };
  guildId?: string;
  onClose: () => void;
}

function getInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

export const UserPopover = ({ member, position, guildId, onClose }: UserPopoverProps) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showFullProfile, setShowFullProfile] = useState(false);
  const presence = useAppSelector(s => s.presence.presences[member.user.id]);
  const customStatus = presence?.activities.find(a => a.type === 4);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClickOutside, handleKeyDown]);

  const handleViewProfile = useCallback(() => {
    setShowFullProfile(true);
  }, []);

  const handleCloseProfile = useCallback(() => {
    setShowFullProfile(false);
    onClose();
  }, [onClose]);

  // Calculate popover position to appear to the left of the member list
  const popoverStyle: React.CSSProperties = {
    position: 'fixed',
    top: Math.max(8, Math.min(position.top - 100, window.innerHeight - 380)),
    left: position.left - 340,
    zIndex: 1000,
  };

  const displayName = member.nick ?? member.user.displayName ?? member.user.username;
  const username = member.user.username;

  if (showFullProfile) {
    return (
      <UserProfile
        userId={member.user.id}
        guildId={guildId}
        onClose={handleCloseProfile}
      />
    );
  }

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      style={popoverStyle}
      role="dialog"
      aria-label={`${displayName} profile`}
    >
      <div className={styles.banner} />

      <div className={styles.avatarSection}>
        <div className={styles.avatarBorder}>
          <div className={styles.avatar} style={{ backgroundColor: '#3b82f6' }}>
            {member.user.avatar ? (
              <img
                src={member.user.avatar}
                alt=""
                className={styles.avatarImage}
                loading="lazy"
              />
            ) : (
              <span className={styles.avatarInitials}>
                {getInitials(displayName)}
              </span>
            )}
          </div>
        </div>
        <button
          className={styles.viewProfileButton}
          onClick={handleViewProfile}
          type="button"
          aria-label="View full profile"
        >
          View Profile
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.headerSection}>
          <h2 className={styles.displayName}>{displayName}</h2>
          <p className={styles.username}>{username}</p>
          {customStatus && (customStatus.state || customStatus.emoji) && (
            <p className={styles.customStatus}>
              {customStatus.emoji && (
                <span className={styles.customStatusEmoji}>{customStatus.emoji.name}</span>
              )}
              {customStatus.state && (
                <span className={styles.customStatusText}>{customStatus.state}</span>
              )}
            </p>
          )}
        </div>

        <div className={styles.divider} />

        {member.user.bot && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>About Me</h3>
            <p className={styles.sectionText}>Bot account</p>
          </div>
        )}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Member Since</h3>
          <p className={styles.sectionText}>
            {new Date(member.joinedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {member.roles.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Roles</h3>
            <div className={styles.rolesList}>
              {member.roles.map(roleId => (
                <span key={roleId} className={styles.rolePill}>
                  <span className={styles.roleDot} />
                  {roleId}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={styles.divider} />

        <div className={styles.messageSection}>
          <input
            type="text"
            className={styles.messageInput}
            placeholder={`Message @${displayName}`}
            aria-label={`Send message to ${displayName}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // DM creation would happen here
              }
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};
