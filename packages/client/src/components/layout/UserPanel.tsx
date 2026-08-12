import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { toggleMute, toggleDeaf } from '../../stores/voiceSlice';
import { useMediaStreams, getMediaState } from '../../hooks/useMediaStreams';
import { playMuteSound, playUnmuteSound, playDeafenSound, playUndeafenSound } from '../../utils/sounds';
import { cdnBase } from '../../utils/cdn';
import { StatusSelector } from './StatusSelector';
import { DeviceSelector } from '../voice/DeviceSelector';
import { Tooltip } from '../ui/Tooltip';
import styles from './userPanel.module.scss';

interface UserPanelProps {
  onOpenSettings: () => void;
}

export const UserPanel = ({ onOpenSettings }: UserPanelProps) => {
  const user = useAppSelector(s => s.auth.user);
  const presenceStatus = useAppSelector(s => s.auth.status);
  const customStatus = useAppSelector(s => s.auth.customStatus);
  const selfMute = useAppSelector(s => s.voice.selfMute);
  const selfDeaf = useAppSelector(s => s.voice.selfDeaf);
  const connected = useAppSelector(s => s.voice.connected);
  const dispatch = useAppDispatch();

  const { startAudio } = useMediaStreams();

  const [showStatusSelector, setShowStatusSelector] = useState(false);
  const [showInputDevices, setShowInputDevices] = useState(false);
  const [showOutputDevices, setShowOutputDevices] = useState(false);
  const userInfoRef = useRef<HTMLDivElement>(null);
  const inputOptionsRef = useRef<HTMLButtonElement>(null);
  const outputOptionsRef = useRef<HTMLButtonElement>(null);
  // Device selection is triggered via chevron buttons adjacent to mute/deafen

  const handleToggleMute = async () => {
    if (selfMute) {
      playUnmuteSound();
    } else {
      playMuteSound();
    }
    if (selfMute && connected) {
      // Unmuting while in voice - ensure audio stream exists
      const media = getMediaState();
      if (!media.audioStream) {
        dispatch(toggleMute());
        await startAudio();
        return;
      }
    }
    dispatch(toggleMute());
  };

  const handleToggleDeaf = () => {
    if (selfDeaf) {
      playUndeafenSound();
    } else {
      playDeafenSound();
    }
    dispatch(toggleDeaf());
  };

  const handleUserInfoClick = () => {
    setShowStatusSelector(prev => !prev);
  };

  const handleCloseStatusSelector = useCallback(() => {
    setShowStatusSelector(false);
  }, []);

  // Close status selector on Escape
  useEffect(() => {
    if (!showStatusSelector) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowStatusSelector(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showStatusSelector]);

  return (
    <section className={styles.panel} role="region" aria-label="User status and settings">
      <div className={styles.panelInner}>
      <div
        className={styles.userInfo}
        ref={userInfoRef}
        onClick={handleUserInfoClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleUserInfoClick(); }}
        aria-label="Manage profile and status"
        aria-haspopup="true"
        aria-expanded={showStatusSelector}
      >
        <div className={styles.avatar}>
          {user?.avatar ? (
            <img
              src={user.avatar.startsWith('data:') ? user.avatar : `${cdnBase()}/avatars/${user.id}/${user.avatar}.png`}
              alt={user.username}
              className={styles.avatarImage}
              loading="lazy"
            />
          ) : (
            user?.username?.charAt(0).toUpperCase()
          )}
          <div className={`${styles.statusDot} ${styles[`statusDot_${presenceStatus}`] ?? ''}`} />
        </div>
        <div className={styles.info}>
          <div className={styles.username}>{user?.global_name || user?.username}</div>
          <div className={styles.status}>
            {customStatus || (presenceStatus === 'dnd' ? 'Do Not Disturb' : presenceStatus === 'invisible' ? 'Invisible' : presenceStatus.charAt(0).toUpperCase() + presenceStatus.slice(1))}
          </div>
        </div>
      </div>
      {showStatusSelector && (
        <StatusSelector
          anchorRef={userInfoRef}
          onClose={handleCloseStatusSelector}
        />
      )}
      <div className={styles.actions}>
        <div className={styles.actionBtnGroup}>
          <Tooltip text={selfMute ? 'Unmute' : 'Mute'}>
            <button
              className={`${styles.actionBtn} ${selfMute ? styles.actionBtnActive : ''}`}
              onClick={handleToggleMute}
              aria-label="Mute"
              role="switch"
              aria-checked={selfMute}
              type="button"
            >
              {selfMute ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.7 11H5C5 12.19 5.34 13.3 5.9 14.28L7.13 13.05C6.86 12.43 6.7 11.74 6.7 11Z" />
                  <path d="M9.01 11.085C9.015 11.1125 9.02 11.14 9.02 11.17L15 5.18V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 11.03 9.005 11.0575 9.01 11.085Z" />
                  <path d="M11.7237 16.0927L10.9632 16.8531L10.2533 17.5688C10.8074 17.8436 11.3907 18.0372 12 18.1V22H14V18.1C17.41 17.6 20 14.41 20 11H18.3C18.3 14 15.76 16.1 13 16.1C12.5468 16.1 12.1145 16.0505 11.7237 16.0927Z" />
                  <path d="M21 2.27L19.73 1L1 19.73L2.27 21L8.46 14.81L9.69 13.58L14.82 8.45L19 4.27L21 2.27Z" fillRule="evenodd" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V21H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1Z" />
                </svg>
              )}
            </button>
          </Tooltip>
          <button
            ref={inputOptionsRef}
            className={styles.chevronBtn}
            onClick={() => { setShowInputDevices(prev => !prev); setShowOutputDevices(false); }}
            aria-label="Input Options"
            type="button"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5H7z" />
            </svg>
          </button>
          {showInputDevices && (
            <DeviceSelector
              mode="input"
              anchorRef={inputOptionsRef}
              onClose={() => setShowInputDevices(false)}
            />
          )}
        </div>
        <div className={styles.actionBtnGroup}>
          <Tooltip text={selfDeaf ? 'Undeafen' : 'Deafen'}>
            <button
              className={`${styles.actionBtn} ${selfDeaf ? styles.actionBtnActive : ''}`}
              onClick={handleToggleDeaf}
              aria-label="Deafen"
              role="switch"
              aria-checked={selfDeaf}
              type="button"
            >
              {selfDeaf ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z" />
                  <path d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z" />
                  <path d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.00305C6.486 2.00305 2 6.48805 2 12.0031V20.0031C2 21.1071 2.895 22.0031 4 22.0031H6C7.104 22.0031 8 21.1071 8 20.0031V17.0031C8 15.8991 7.104 15.0031 6 15.0031H4V12.0031C4 7.59105 7.589 4.00305 12 4.00305C16.411 4.00305 20 7.59105 20 12.0031V15.0031H18C16.896 15.0031 16 15.8991 16 17.0031V20.0031C16 21.1071 16.896 22.0031 18 22.0031H20C21.105 22.0031 22 21.1071 22 20.0031V12.0031C22 6.48805 17.514 2.00305 12 2.00305Z" />
                </svg>
              )}
            </button>
          </Tooltip>
          <button
            ref={outputOptionsRef}
            className={styles.chevronBtn}
            onClick={() => { setShowOutputDevices(prev => !prev); setShowInputDevices(false); }}
            aria-label="Output Options"
            type="button"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5H7z" />
            </svg>
          </button>
          {showOutputDevices && (
            <DeviceSelector
              mode="output"
              anchorRef={outputOptionsRef}
              onClose={() => setShowOutputDevices(false)}
            />
          )}
        </div>
        <Tooltip text="User Settings">
          <button
            className={styles.actionBtn}
            onClick={onOpenSettings}
            aria-label="User Settings"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
          </button>
        </Tooltip>
      </div>{/* close actions */}
      </div>{/* close panelInner */}
    </section>
  );
};
