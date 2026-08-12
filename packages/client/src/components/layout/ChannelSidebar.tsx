import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setChannels, selectChannel, removeChannel, addChannel } from '../../stores/channelsSlice';
import { joinVoice, addVoiceUser, removeVoiceUser } from '../../stores/voiceSlice';
import { markRead } from '../../stores/notificationsSlice';
import { openModal } from '../../stores/uiSlice';
import { removeGuild } from '../../stores/guildsSlice';
import { toggleHideMutedChannels } from '../../stores/settingsSlice';
import { selectChannelsForSelectedGuild } from '../../stores/selectors';
import { store } from '../../stores/store';
import { api } from '../../api/rest';
import { gateway } from '../../api/gateway';
import { ContextMenu, useContextMenu, getChannelContextItems } from '../ui/ContextMenu';
import { ConfirmModal } from '../modals/ConfirmModal';
import { ChannelNameRenderer } from '../ui/ChannelNameRenderer';
import { VoiceConnectedBar } from '../voice/VoiceConnectedBar';
import { usePermissions, PermissionBits } from '../../hooks/usePermissions';
import { selectThread, setThreads } from '../../stores/threadsSlice';
import type { Thread } from '../../stores/threadsSlice';
import { playJoinSound } from '../../utils/sounds';
import { cdnBase } from '../../utils/cdn';
import styles from './channelSidebar.module.scss';

export interface ChannelSidebarProps {
  onOpenSettings: () => void;
  onOpenServerSettings?: () => void;
  onOpenChannelSettings?: (channelId: string) => void;
}

// ─── Server Header Dropdown ───

interface ServerHeaderDropdownProps {
  guildId: string;
  guildName: string;
  anchorRect: DOMRect;
  onClose: () => void;
  onOpenSettings: () => void;
  canManageGuild: boolean;
  canManageChannels: boolean;
  canCreateInvite: boolean;
  canManageEvents: boolean;
  isOwner: boolean;
  hideMutedChannels: boolean;
  developerMode: boolean;
  defaultInviteChannelId: string;
}

const ServerHeaderDropdown = ({
  guildId,
  guildName,
  anchorRect,
  onClose,
  onOpenSettings,
  canManageGuild,
  canManageChannels,
  canCreateInvite,
  canManageEvents,
  isOwner,
  hideMutedChannels,
  developerMode,
  defaultInviteChannelId,
}: ServerHeaderDropdownProps) => {
  const dispatch = useAppDispatch();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleItem = (action: () => void) => {
    action();
    onClose();
  };

  return createPortal(
    <div
      className={styles.serverDropdown}
      ref={dropdownRef}
      style={{
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        width: anchorRect.width,
      }}
      role="menu"
      aria-label={`${guildName} options`}
    >
      {/* Invite People */}
      {canCreateInvite && (
        <button
          className={`${styles.dropdownItem} ${styles.dropdownHighlight}`}
          onClick={() => handleItem(() => {
            dispatch(openModal({
              modal: 'invite',
              props: { channelId: defaultInviteChannelId, serverName: guildName },
            }));
          })}
          role="menuitem"
          type="button"
        >
          <span>Invite to Server</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 14v-2.5h-2.5V9H19V6.5h2V9h2.5v2.5H21V14h-2zM15 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 8.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0zM0 20c0-2.21 3.58-4 8-4s8 1.79 8 4v1H0v-1z" />
          </svg>
        </button>
      )}

      {/* Server Settings (requires MANAGE_GUILD) */}
      {canManageGuild && (
        <button
          className={styles.dropdownItem}
          onClick={() => handleItem(onOpenSettings)}
          role="menuitem"
          type="button"
        >
          <span>Server Settings</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>
      )}

      {/* Create Channel (requires MANAGE_CHANNELS) */}
      {canManageChannels && (
        <button
          className={styles.dropdownItem}
          onClick={() => handleItem(() => dispatch(openModal({ modal: 'createChannel' })))}
          role="menuitem"
          type="button"
        >
          <span>Create Channel</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11.1111H12.8889V4H11.1111V11.1111H4V12.8889H11.1111V20H12.8889V12.8889H20V11.1111Z" />
          </svg>
        </button>
      )}

      {/* Create Category (requires MANAGE_CHANNELS) */}
      {canManageChannels && (
        <button
          className={styles.dropdownItem}
          onClick={() => handleItem(() => dispatch(openModal({ modal: 'createChannel', props: { channelType: 4 } })))}
          role="menuitem"
          type="button"
        >
          <span>Create Category</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 5a2 2 0 0 1 2-2h5.379a2 2 0 0 1 1.414.586l1.828 1.828A1 1 0 0 0 13.328 6H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5zm10.414 9H14v-2h-3v-3h-2v3H6v2h3v3h2v-3h1.414z" />
          </svg>
        </button>
      )}

      {/* Create Event (requires MANAGE_EVENTS or MANAGE_GUILD) */}
      {(canManageEvents || canManageGuild) && (
        <button
          className={styles.dropdownItem}
          onClick={() => handleItem(() => dispatch(openModal({ modal: 'createEvent', props: { guildId } })))}
          role="menuitem"
          type="button"
        >
          <span>Create Event</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H7V1H9V3H15V1H17V3ZM4 9V19H20V9H4ZM6 11H8V13H6V11ZM6 15H8V17H6V15ZM10 11H12V13H10V11ZM10 15H12V17H10V15ZM14 11H16V13H14V11ZM14 15H16V17H14V15Z" />
          </svg>
        </button>
      )}

      <div className={styles.dropdownSeparator} />

      {/* Notification Settings */}
      <button
        className={styles.dropdownItem}
        onClick={() => handleItem(() => dispatch(openModal({ modal: 'notificationSettings', props: { guildId } })))}
        role="menuitem"
        type="button"
      >
        <span>Notification Settings</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C10.9 2 10 2.9 10 4C10 4.04 10 4.08 10.01 4.12C7.13 4.96 5 7.58 5 10.5V16L3 18V19H21V18L19 16V10.5C19 7.58 16.87 4.96 13.99 4.12C14 4.08 14 4.04 14 4C14 2.9 13.1 2 12 2ZM10 20C10 21.1 10.9 22 12 22C13.1 22 14 21.1 14 20H10Z" />
        </svg>
      </button>

      <div className={styles.dropdownSeparator} />

      {/* Edit Server Profile */}
      <button
        className={styles.dropdownItem}
        onClick={() => handleItem(() => dispatch(openModal({ modal: 'editServerProfile', props: { guildId } })))}
        role="menuitem"
        type="button"
      >
        <span>Edit Per-server Profile</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64703 16.2301 2.64703 14.818 4.05892L5.15197 13.7249C4.79267 14.0843 4.55124 14.5462 4.46176 15.0482L3.86736 18.1837C3.73385 18.9258 4.38081 19.5728 5.12294 19.4393L8.25845 18.8449C8.76049 18.7554 9.2224 18.514 9.58171 18.1547L19.2929 9.8299Z" />
        </svg>
      </button>

      {/* Hide Muted Channels (checkbox) */}
      <button
        className={styles.dropdownItem}
        onClick={() => {
          dispatch(toggleHideMutedChannels(guildId));
        }}
        role="menuitemcheckbox"
        aria-checked={hideMutedChannels}
        type="button"
      >
        <span>Hide Muted Channels</span>
        <div className={`${styles.dropdownCheckbox} ${hideMutedChannels ? styles.dropdownCheckboxChecked : ''}`}>
          {hideMutedChannels && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8.99991 16.17L4.82991 12L3.40991 13.41L8.99991 19L20.9999 7.00003L19.5899 5.59003L8.99991 16.17Z" />
            </svg>
          )}
        </div>
      </button>

      <div className={styles.dropdownSeparator} />

      {/* Leave Server (danger) - hide for owner */}
      {!isOwner && (
        <button
          className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
          onClick={() => handleItem(() => {
            // Tell the server we left (was local-only, so it came back on refresh).
            void api.leaveGuild(guildId);
            dispatch(removeGuild(guildId));
          })}
          role="menuitem"
          type="button"
        >
          <span>Leave Server</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.418 13L12.708 15.294L11.292 16.706L6.586 12L11.292 7.29401L12.706 8.70601L10.414 11H21.998V13H10.418ZM3 3H12V5H5V19H12V21H3V3Z" />
          </svg>
        </button>
      )}

      {/* Copy Server ID (developer mode only) */}
      {developerMode && (
        <>
          <div className={styles.dropdownSeparator} />
          <button
            className={styles.dropdownItem}
            onClick={() => handleItem(() => {
              void navigator.clipboard.writeText(guildId);
            })}
            role="menuitem"
            type="button"
          >
            <span>Copy Server ID</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 5C7 3.34 8.34 2 10 2H18C19.66 2 21 3.34 21 5V15C21 16.66 19.66 18 18 18H10C8.34 18 7 16.66 7 15V5ZM10 4C9.45 4 9 4.45 9 5V15C9 15.55 9.45 16 10 16H18C18.55 16 19 15.55 19 15V5C19 4.45 18.55 4 18 4H10ZM3 7C3 6.45 3.45 6 4 6C4.55 6 5 6.45 5 7V19C5 19.55 5.45 20 6 20H16C16.55 20 17 20.45 17 21C17 21.55 16.55 22 16 22H6C4.34 22 3 20.66 3 19V7Z" />
            </svg>
          </button>
        </>
      )}
    </div>,
    document.body
  );
};

// ─── Voice Channel User Item ───

interface VoiceUserItemProps {
  username: string;
  avatar: string | null;
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isStreaming: boolean;
}

const VoiceUserItem = ({ username, avatar, isSpeaking, isMuted, isDeafened, isStreaming }: VoiceUserItemProps) => {
  return (
    <div className={styles.voiceUser} role="listitem">
      <div className={`${styles.voiceUserAvatarWrapper} ${isSpeaking ? styles.voiceUserSpeaking : ''}`}>
        {avatar ? (
          <img
            className={styles.voiceUserAvatar}
            src={avatar}
            alt={username}
          />
        ) : (
          <div className={styles.voiceUserAvatarFallback}>
            {username.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <span className={styles.voiceUserName}>{username}</span>
      <div className={styles.voiceUserIcons}>
        {isStreaming && (
          <>
            <svg className={styles.voiceUserStreamIcon} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="Streaming">
              <path d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H16V21.5H8V19.5H11V17.5H4C2.897 17.5 2 16.604 2 15.5V4.5ZM4 4.5V15.5H20V4.5H4Z" />
            </svg>
            <span className={styles.voiceUserLiveBadge}>LIVE</span>
          </>
        )}
        {isMuted && (
          <svg className={styles.voiceUserMuteIcon} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="Muted">
            <path d="M6.7 11H5C5 12.19 5.34 13.3 5.9 14.28L7.13 13.05C6.86 12.43 6.7 11.74 6.7 11Z" />
            <path d="M9.01 11.085C9.015 11.1125 9.02 11.14 9.02 11.17L15 5.18V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 11.03 9.005 11.0575 9.01 11.085Z" />
            <path d="M11.7237 16.0927L10.9632 16.8531L10.2533 17.5688C10.8074 17.8436 11.3907 18.0372 12 18.1V22H14V18.1C17.41 17.6 20 14.41 20 11H18.3C18.3 14 15.76 16.1 13 16.1C12.5468 16.1 12.1145 16.0505 11.7237 16.0927Z" />
            <path d="M21 2.27L19.73 1L1 19.73L2.27 21L8.46 14.81L9.69 13.58L14.82 8.45L19 4.27L21 2.27Z" fillRule="evenodd" />
          </svg>
        )}
        {isDeafened && (
          <svg className={styles.voiceUserMuteIcon} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="Deafened">
            <path d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z" />
            <path d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z" />
            <path d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z" />
          </svg>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───

// ─── Channel Type Icon Component ───

interface ChannelTypeIconProps {
  type: number;
}

const ChannelTypeIcon = ({ type }: ChannelTypeIconProps) => {
  switch (type) {
    case 2: // Voice
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H2C1.45 7.00304 1 7.45304 1 8.00304V16.003C1 16.553 1.45 17.003 2 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904ZM14 5.00304V7.00304C16.757 7.00304 19 9.24604 19 12.003C19 14.76 16.757 17.003 14 17.003V19.003C17.86 19.003 21 15.863 21 12.003C21 8.14304 17.86 5.00304 14 5.00304ZM14 9.00304V15.003C15.654 15.003 17 13.657 17 12.003C17 10.349 15.654 9.00304 14 9.00304Z" />
        </svg>
      );
    case 5: // Announcement
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3.9 8.26H2V15.2941H3.9V8.26ZM19.1 4V18.4708L16.5 16.8011L13.9 15.1314L11.3 13.4618V4.97877L13.9 3.30907L16.5 1.63938L19.1 0V4ZM14 7.09V10.4L20 7.22V3.33L14 7.09ZM14 12.14V15.45L20 18.63V14.74L14 12.14ZM6 8V14.5H10.5V8H6ZM10.5 15.5H6V22H7.98V18H10.5V15.5Z" />
        </svg>
      );
    case 13: // Stage
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.61 18.25a1.08 1.08 0 0 1-.07-1.33 9 9 0 1 0-15.07 0c.26.42.25.97-.08 1.33l-.02.02c-.41.44-1.12.43-1.46-.07a11 11 0 1 1 18.17 0c-.33.5-1.04.51-1.45.07l-.02-.02Z" />
          <path d="M16.83 15.23c.2-.45.11-.98-.2-1.34a5.5 5.5 0 1 0-9.25 0 1.11 1.11 0 0 1-.21 1.34c-.41.39-1.07.34-1.39-.13a7.5 7.5 0 1 1 12.44 0c-.31.47-.97.52-1.39.13Z" />
          <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        </svg>
      );
    case 15: // Forum
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.91 12.98a5.45 5.45 0 0 1 2.18 6.2c-.1.33-.09.68.1.96l.83 1.32a.3.3 0 0 1-.33.46l-1.9-.38c-.3-.06-.62 0-.87.18a5.48 5.48 0 0 1-5.38.37 5.81 5.81 0 0 1-1.36-.92 5.85 5.85 0 0 0 6.73-8.19ZM14.91 2a5.5 5.5 0 0 1 3.37 9.86l.01.03a5.49 5.49 0 0 1-6.57 4.03 5.4 5.4 0 0 1-1.17-.38c-.26-.13-.56-.18-.85-.12l-1.9.38a.3.3 0 0 1-.34-.46l.84-1.32c.18-.28.2-.63.09-.96A5.49 5.49 0 0 1 9.41 2h5.5Z" />
        </svg>
      );
    default: // Text (type 0) and fallback
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41001 9L8.35001 15H14.35L15.41 9H9.41001Z" />
        </svg>
      );
  }
};

export const ChannelSidebar = ({ onOpenSettings, onOpenServerSettings, onOpenChannelSettings }: ChannelSidebarProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const selectedGuild = useAppSelector(s => selectedGuildId ? s.guilds.guilds[selectedGuildId] : null);
  const channels = useAppSelector(selectChannelsForSelectedGuild);
  const selectedChannelId = useAppSelector(s => s.channels.selectedChannelId);
  const voiceChannelId = useAppSelector(s => s.voice.channelId);
  const voiceConnected = useAppSelector(s => s.voice.connected);
  const selfScreenShare = useAppSelector(s => s.voice.selfScreenShare);
  const voiceUsersByChannel = useAppSelector(s => s.voice.voiceUsersByChannel);
  const speakingUsers = useAppSelector(s => s.voice.speakingUsers);
  const unreadByChannel = useAppSelector(s => s.notifications.unreadByChannel);
  const mentionsByChannel = useAppSelector(s => s.notifications.mentionsByChannel);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const currentUser = useAppSelector(s => s.auth.user);
  const perms = usePermissions(selectedGuildId);
  const threadsByParent = useAppSelector(s => s.threads.threadsByParent);
  const threadEntities = useAppSelector(s => s.threads.entities);
  const selectedThreadId = useAppSelector(s => s.threads.selectedThreadId);
  const hideMutedChannels = useAppSelector(s =>
    selectedGuildId ? (s.settings.hideMutedChannelsByGuild[selectedGuildId] ?? false) : false
  );
  const developerMode = useAppSelector(s => s.settings.developerMode);

  const [headerDropdownOpen, setHeaderDropdownOpen] = useState(false);
  const [headerRect, setHeaderRect] = useState<DOMRect | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const headerRef = useRef<HTMLDivElement>(null);

  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const [deleteChannelTarget, setDeleteChannelTarget] = useState<{ id: string; name: string | null } | null>(null);

  useEffect(() => {
    if (!selectedGuildId) return;

    // Check if channels for this guild are already loaded (e.g., from startup)
    const existingChannels = Object.values(store.getState().channels.channels)
      .filter(c => c.guild_id === selectedGuildId);

    if (existingChannels.length > 0) {
      // Channels already in store - just auto-select if nothing is selected
      const currentSelection = store.getState().channels.selectedChannelId;
      const hasValidSelection = currentSelection && existingChannels.some(c => c.id === currentSelection);
      if (!hasValidSelection) {
        const textChannels = existingChannels
          .filter(c => c.type === 0)
          .sort((a, b) => a.position - b.position);
        const firstTextChannel = textChannels[0];
        if (firstTextChannel) {
          dispatch(selectChannel(firstTextChannel.id));
        }
      }
      return;
    }

    // No channels cached - fetch from API
    api.getGuildChannels(selectedGuildId).then(chs => {
      dispatch(setChannels(chs));
      // Auto-select the first text channel for this guild
      const textChannels = chs
        .filter((c: { type: number; guild_id: string | null }) => c.type === 0 && c.guild_id === selectedGuildId)
        .sort((a: { position: number }, b: { position: number }) => a.position - b.position);
      if (textChannels.length > 0) {
        dispatch(selectChannel(textChannels[0].id));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGuildId, dispatch]);

  // Fetch active threads for the guild
  useEffect(() => {
    if (!selectedGuildId) return;
    api.getGuildActiveThreads(selectedGuildId).then(res => {
      const threadData = res.threads as unknown as Thread[];
      dispatch(setThreads(threadData));
    }).catch(() => {
      // Silently handle failure
    });
  }, [selectedGuildId, dispatch]);

  // When joining a voice channel, add self to voice users
  useEffect(() => {
    if (voiceConnected && voiceChannelId && currentUser) {
      dispatch(addVoiceUser({
        channelId: voiceChannelId,
        user: {
          userId: currentUser.id,
          username: currentUser.username,
          avatar: currentUser.avatar,
          selfMute: false,
          selfDeaf: false,
          streaming: false,
        },
      }));
    }
    // Cleanup: remove self when disconnecting
    return () => {
      if (voiceChannelId && currentUser) {
        dispatch(removeVoiceUser({
          channelId: voiceChannelId,
          userId: currentUser.id,
        }));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceConnected, voiceChannelId]);

  const handleChannelClick = (e: React.MouseEvent, ch: { id: string; type: number; guild_id: string | null }) => {
    e.stopPropagation();
    if (ch.type === 2 || ch.type === 13) {
      // Voice or Stage channel: join voice AND select channel to show voice/stage view
      if (ch.guild_id) {
        // Only join if not already in this channel
        if (voiceChannelId !== ch.id) {
          playJoinSound();
          gateway.sendVoiceStateUpdate(ch.guild_id, ch.id);
          dispatch(joinVoice({ channelId: ch.id, guildId: ch.guild_id }));
        }
      }
      dispatch(selectChannel(ch.id));
      if (ch.guild_id) {
        navigate(`/channels/${ch.guild_id}/${ch.id}`);
      }
    } else {
      dispatch(selectChannel(ch.id));
      dispatch(markRead(ch.id));
      if (ch.guild_id) {
        navigate(`/channels/${ch.guild_id}/${ch.id}`);
      }
    }
  };

  const handleInviteClick = (e: React.MouseEvent, channelId: string) => {
    e.stopPropagation();
    dispatch(openModal({
      modal: 'invite',
      props: { channelId, serverName: selectedGuild?.name ?? '' },
    }));
  };

  const handleHeaderClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (headerRef.current) {
      setHeaderRect(headerRef.current.getBoundingClientRect());
    }
    setHeaderDropdownOpen(prev => !prev);
  }, []);

  const handleChannelContextMenu = useCallback((e: React.MouseEvent, ch: { id: string; name: string | null; type: number; topic?: string | null; nsfw?: boolean; rate_limit_per_user?: number; parent_id: string | null; guild_id: string | null }) => {
    e.preventDefault();
    e.stopPropagation();
    const canManageChannels = perms.canManageChannels;
    const items = getChannelContextItems(
      ch,
      {
        onMarkAsRead: () => dispatch(markRead(ch.id)),
        onCreateInvite: () => {
          dispatch(openModal({
            modal: 'invite',
            props: { channelId: ch.id, serverName: selectedGuild?.name ?? '' },
          }));
        },
        onMuteChannel: () => {
          // Toggle the channel's muted notification setting (persisted server-side).
          void api.getChannelNotificationSettings(ch.id)
            .then(s => api.updateChannelNotificationSettings(ch.id, { muted: !s.muted }))
            .catch(() => { /* ignore transient failure */ });
        },
        onEditChannel: canManageChannels ? () => {
          if (onOpenChannelSettings) {
            onOpenChannelSettings(ch.id);
          }
        } : undefined,
        onCloneChannel: canManageChannels && ch.guild_id ? () => {
          const cloneName = `clone-${ch.name ?? 'channel'}`;
          api.createChannel(ch.guild_id as string, {
            name: cloneName,
            type: ch.type,
            parent_id: ch.parent_id ?? undefined,
          }).then(newChannel => {
            dispatch(addChannel({
              ...newChannel,
              guild_id: ch.guild_id,
              topic: newChannel.topic ?? null,
              nsfw: ch.nsfw,
              rate_limit_per_user: ch.rate_limit_per_user,
            }));
          }).catch(() => {
            // Silently handle failure
          });
        } : undefined,
        onDeleteChannel: canManageChannels ? () => {
          setDeleteChannelTarget(ch);
        } : undefined,
      },
      { canManage: canManageChannels }
    );
    openContextMenu(e, items);
  }, [dispatch, selectedGuild, perms, openContextMenu, onOpenChannelSettings]);

  if (!selectedGuild) {
    return null;
  }

  return (
    <nav className={styles.sidebar} aria-label={`${selectedGuild.name} (server)`}>
      <header
        className={`${styles.header} ${headerDropdownOpen ? styles.headerOpen : ''}`}
        ref={headerRef}
      >
        <div
          className={styles.headerClickArea}
          onClick={handleHeaderClick}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          role="button"
          tabIndex={0}
          aria-label={`${selectedGuild.name} server options`}
          aria-expanded={headerDropdownOpen}
          onKeyDown={(e) => { if (e.key === 'Enter') handleHeaderClick(e as unknown as React.MouseEvent); }}
        >
          <span className={styles.headerName}>{selectedGuild.name}</span>
          <svg
            className={`${styles.headerArrow} ${headerDropdownOpen ? styles.headerArrowOpen : ''}`}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            {headerDropdownOpen ? (
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            ) : (
              <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
            )}
          </svg>
        </div>
        {perms.has(PermissionBits.CREATE_INSTANT_INVITE) && (
          <button
            className={styles.headerInviteBtn}
            onClick={(e) => {
              e.stopPropagation();
              const invChId = selectedChannelId || channels.filter(c => c.type === 0).sort((a, b) => a.position - b.position)[0]?.id || '';
              dispatch(openModal({
                modal: 'invite',
                props: { channelId: invChId, serverName: selectedGuild.name },
              }));
            }}
            aria-label="Invite to Server"
            title="Invite to Server"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 14v-2.5h-2.5V9H19V6.5h2V9h2.5v2.5H21V14h-2zM15 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 8.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0zM0 20c0-2.21 3.58-4 8-4s8 1.79 8 4v1H0v-1z" />
            </svg>
          </button>
        )}
      </header>

      {headerDropdownOpen && headerRect && (
        <ServerHeaderDropdown
          guildId={selectedGuild.id}
          guildName={selectedGuild.name}
          anchorRect={headerRect}
          onClose={() => setHeaderDropdownOpen(false)}
          onOpenSettings={onOpenServerSettings ?? onOpenSettings}
          canManageGuild={perms.canManageGuild}
          canManageChannels={perms.canManageChannels}
          canCreateInvite={perms.has(PermissionBits.CREATE_INSTANT_INVITE)}
          canManageEvents={perms.has(PermissionBits.MANAGE_EVENTS) || perms.has(PermissionBits.CREATE_EVENTS)}
          isOwner={perms.isOwner}
          hideMutedChannels={hideMutedChannels}
          developerMode={developerMode}
          defaultInviteChannelId={selectedChannelId || channels.filter(c => c.type === 0).sort((a, b) => a.position - b.position)[0]?.id || ''}
        />
      )}

      {selectedGuild.banner && (
        <div className={styles.bannerArea} aria-hidden="true">
          <img
            className={styles.bannerImage}
            src={`${cdnBase()}/banners/${selectedGuild.id}/${selectedGuild.banner}.png?size=480`}
            alt=""
            loading="lazy"
          />
          <div className={styles.bannerOverlay} />
        </div>
      )}

      <div className={styles.quickLinksSection}>
        <button
          className={styles.quickLinkItem}
          onClick={() => dispatch(openModal({ modal: 'guildEvents', props: { guildId: selectedGuild.id } }))}
          type="button"
          aria-label="Events"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className={styles.quickLinkIcon}>
            <path d="M17 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H7V1H9V3H15V1H17V3ZM4 9V19H20V9H4ZM6 11H8V13H6V11ZM6 15H8V17H6V15ZM10 11H12V13H10V11ZM10 15H12V17H10V15ZM14 11H16V13H14V11ZM14 15H16V17H14V15Z" />
          </svg>
          <span>Events</span>
        </button>
      </div>

      <h2 className={styles.srOnly}>Channels</h2>
      <ul role="list" aria-label="Channels" className={styles.channelList}>
        {(() => {
          const sorted = [...channels].sort((a, b) => a.position - b.position);
          // Separate categories, uncategorized channels, and categorized channels
          const categories = sorted.filter(c => c.type === 4);
          const uncategorized = sorted.filter(c => c.type !== 4 && !c.parent_id);
          const childrenByCategory = new Map<string, typeof sorted>();
          for (const ch of sorted) {
            if (ch.type !== 4 && ch.parent_id) {
              const existing = childrenByCategory.get(ch.parent_id) ?? [];
              existing.push(ch);
              childrenByCategory.set(ch.parent_id, existing);
            }
          }

          const toggleCategory = (categoryId: string) => {
            setCollapsedCategories(prev => {
              const next = new Set(prev);
              if (next.has(categoryId)) {
                next.delete(categoryId);
              } else {
                next.add(categoryId);
              }
              return next;
            });
          };

          const renderChannel = (ch: typeof sorted[0]) => {
            const isVoice = ch.type === 2;
            const isStage = ch.type === 13;
            const isVoiceOrStage = isVoice || isStage;
            const isActive = selectedChannelId === ch.id;
            const unreadCount = unreadByChannel[ch.id] ?? 0;
            const mentionCount = mentionsByChannel[ch.id] ?? 0;
            const hasUnread = unreadCount > 0 && !isActive;
            const voiceUsers = isVoiceOrStage ? (voiceUsersByChannel[ch.id] ?? []) : [];

            return (
              <li key={ch.id}>
                <div
                  className={`${styles.channel} ${isActive ? styles.active : ''} ${hasUnread ? styles.unread : ''}`}
                  onClick={(e) => handleChannelClick(e, ch)}
                  onContextMenu={(e) => handleChannelContextMenu(e, ch)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${isStage ? 'Stage channel' : isVoice ? 'Voice channel' : ch.type === 5 ? 'Announcement channel' : ch.type === 15 ? 'Forum channel' : 'Text channel'} ${ch.name ?? ''}`}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleChannelClick(e as unknown as React.MouseEvent, ch); }}
                >
                  {hasUnread && <div className={styles.unreadDot} />}
                  <span className={styles.hash}>
                    <ChannelTypeIcon type={ch.type} />
                  </span>
                  <span className={styles.name}>
                    <ChannelNameRenderer name={ch.name ?? ''} guildId={ch.guild_id} />
                  </span>
                  <div className={styles.channelActions}>
                    {mentionCount > 0 && (
                      <span className={styles.mentionBadge}>{mentionCount}</span>
                    )}
                    {isStage && voiceUsers.length > 0 && (
                      <span className={styles.stageParticipantCount}>{voiceUsers.length}</span>
                    )}
                    {isVoice && (ch.user_limit ?? 0) > 0 && (
                      <span
                        className={`${styles.voiceUserLimit} ${voiceUsers.length >= (ch.user_limit ?? 0) ? styles.voiceUserLimitFull : ''}`}
                        aria-label={`${voiceUsers.length} of ${ch.user_limit} user limit`}
                      >
                        {voiceUsers.length}/{ch.user_limit}
                      </span>
                    )}
                    {isVoice && (ch.user_limit ?? 0) === 0 && voiceUsers.length > 0 && (
                      <span
                        className={styles.voiceUserCount}
                        aria-label={`${voiceUsers.length} connected`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                        </svg>
                        {voiceUsers.length}
                      </span>
                    )}
                    {!isVoiceOrStage && (
                      <button
                        className={styles.inviteBtn}
                        onClick={(e) => handleInviteClick(e, ch.id)}
                        aria-label={`Create invite for ${ch.name ?? 'channel'}`}
                        type="button"
                        title="Create Invite"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M14 2.5a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0 0 1h4.793L2.146 13.146a.5.5 0 0 0 .708.708L13 3.707V8.5a.5.5 0 0 0 1 0v-6z" />
                        </svg>
                      </button>
                    )}
                    {perms.canManageChannels && (
                      <button
                        className={styles.inviteBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onOpenChannelSettings) {
                            onOpenChannelSettings(ch.id);
                          }
                        }}
                        aria-label={`Edit channel ${ch.name ?? ''}`}
                        type="button"
                        title="Edit Channel"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {isVoiceOrStage && voiceUsers.length > 0 && (
                  <div className={styles.voiceUserList} role="list" aria-label={`Users in ${ch.name ?? 'voice channel'}`}>
                    {voiceUsers.map(vu => {
                      const isSelfUser = vu.userId === currentUserId;
                      const isStreaming = isSelfUser ? selfScreenShare : vu.streaming;
                      return (
                        <VoiceUserItem
                          key={vu.userId}
                          username={vu.username}
                          avatar={vu.avatar}
                          isSpeaking={speakingUsers.includes(vu.userId)}
                          isMuted={vu.selfMute}
                          isDeafened={vu.selfDeaf}
                          isStreaming={isStreaming}
                        />
                      );
                    })}
                  </div>
                )}
                {/* Active threads under this channel */}
                {(threadsByParent[ch.id] ?? []).map(threadId => {
                  const thread = threadEntities[threadId];
                  if (!thread || thread.thread_metadata?.archived) return null;
                  const isThreadActive = selectedThreadId === thread.id;
                  return (
                    <div
                      key={thread.id}
                      className={`${styles.threadItem} ${isThreadActive ? styles.threadItemActive : ''}`}
                      onClick={() => dispatch(selectThread(thread.id))}
                      role="button"
                      tabIndex={0}
                      aria-label={`Thread: ${thread.name ?? 'Unnamed'}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') dispatch(selectThread(thread.id)); }}
                    >
                      <svg className={styles.threadItemIcon} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2.81L15.22 3.73L12.34 5.64L14.22 8.98L10.89 8.47L9.98 11.81L7.74 9.15L5.01 11.38L5.83 7.97L2.65 7.07L5.7 5.36L4.17 2.15L7.31 3.12L8.67 0L10.25 3.05L12 2.81Z" />
                      </svg>
                      <span className={styles.threadItemName}>{thread.name}</span>
                    </div>
                  );
                })}
              </li>
            );
          };

          return (
            <>
              {/* Channels with no parent category render at the top */}
              {uncategorized.map(renderChannel)}

              {/* Category groups */}
              {categories.map(cat => {
                const isCollapsed = collapsedCategories.has(cat.id);
                const children = childrenByCategory.get(cat.id) ?? [];

                return (
                  <div key={cat.id}>
                    <div
                      className={styles.category}
                      onClick={() => toggleCategory(cat.id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={!isCollapsed}
                      aria-label={`${cat.name ?? 'Category'}, ${isCollapsed ? 'collapsed' : 'expanded'}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') toggleCategory(cat.id); }}
                    >
                      <svg
                        className={`${styles.categoryArrow} ${isCollapsed ? styles.collapsed : ''}`}
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
                      </svg>
                      <span className={styles.categoryName}>{cat.name}</span>
                      {perms.canManageChannels && (
                        <span
                          className={styles.categoryAction}
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch(openModal({
                              modal: 'createChannel',
                              props: { parentId: cat.id },
                            }));
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`Create channel in ${cat.name ?? 'category'}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              dispatch(openModal({
                                modal: 'createChannel',
                                props: { parentId: cat.id },
                              }));
                            }
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20 11.1111H12.8889V4H11.1111V11.1111H4V12.8889H11.1111V20H12.8889V12.8889H20V11.1111Z" />
                          </svg>
                        </span>
                      )}
                    </div>
                    {!isCollapsed && children.map(renderChannel)}
                  </div>
                );
              })}
            </>
          );
        })()}
      </ul>

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {deleteChannelTarget && (
        <ConfirmModal
          title="Delete Channel"
          description={`Are you sure you want to delete #${deleteChannelTarget.name ?? 'channel'}? This cannot be undone.`}
          confirmLabel="Delete Channel"
          confirmDanger
          onConfirm={() => {
            dispatch(removeChannel(deleteChannelTarget.id));
            void api.deleteChannel(deleteChannelTarget.id);
            setDeleteChannelTarget(null);
          }}
          onCancel={() => setDeleteChannelTarget(null)}
        />
      )}

      <VoiceConnectedBar />
    </nav>
  );
};
