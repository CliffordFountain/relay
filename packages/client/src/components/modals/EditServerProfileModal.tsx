import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { updateMember } from '../../stores/membersSlice';
import { api } from '../../api/rest';
import { cdnBase } from '../../utils/cdn';
import styles from './editServerProfileModal.module.scss';

export interface EditServerProfileModalProps {
  guildId: string;
  onClose: () => void;
}

export const EditServerProfileModal = ({ guildId, onClose }: EditServerProfileModalProps) => {
  const dispatch = useAppDispatch();
  const guild = useAppSelector(s => s.guilds.guilds[guildId]);
  const currentUser = useAppSelector(s => s.auth.user);
  const members = useAppSelector(s => s.members.membersByGuild[guildId] ?? []);
  const currentMember = members.find(m => m.user.id === currentUser?.id);

  const [nickname, setNickname] = useState(currentMember?.nick ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === 'string') {
        setAvatarPreview(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!currentUser) return;

    setSaving(true);
    setError(null);

    try {
      const nickToSend = nickname.trim() || null;
      await api.updateMemberNick(guildId, currentUser.id, nickToSend);

      dispatch(updateMember({
        guildId,
        userId: currentUser.id,
        changes: { nick: nickToSend },
      }));

      onClose();
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError.message ?? 'Failed to update server profile');
    } finally {
      setSaving(false);
    }
  };

  const currentAvatarUrl = currentUser?.avatar
    ? `${cdnBase()}/avatars/${currentUser.id}/${currentUser.avatar}.png?size=128`
    : null;

  const displayAvatar = avatarPreview ?? currentAvatarUrl;

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Edit Server Profile"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Edit Server Profile</h2>
          <p className={styles.subtitle}>{guild?.name ?? 'Server'}</p>
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

        <div className={styles.body}>
          <div className={styles.avatarSection}>
            <div
              className={styles.avatarWrapper}
              onClick={handleAvatarClick}
              role="button"
              tabIndex={0}
              aria-label="Change server avatar"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAvatarClick(); }}
            >
              {displayAvatar ? (
                <img
                  className={styles.avatarImage}
                  src={displayAvatar}
                  alt="Server avatar"
                />
              ) : (
                <div className={styles.avatarFallback}>
                  {currentUser?.username?.charAt(0).toUpperCase() ?? '?'}
                </div>
              )}
              <div className={styles.avatarOverlay}>
                <svg
                  className={styles.avatarOverlayIcon}
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64703 16.2301 2.64703 14.818 4.05892L5.15197 13.7249C4.79267 14.0843 4.55124 14.5462 4.46176 15.0482L3.86736 18.1837C3.73385 18.9258 4.38081 19.5728 5.12294 19.4393L8.25845 18.8449C8.76049 18.7554 9.2224 18.514 9.58171 18.1547L19.2929 9.8299Z" />
                </svg>
                Edit
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className={styles.avatarHiddenInput}
              onChange={handleAvatarChange}
              aria-hidden="true"
              tabIndex={-1}
            />
            <span className={styles.avatarLabel}>
              Click to change server avatar
            </span>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="server-nickname">
              Nickname
            </label>
            <input
              id="server-nickname"
              type="text"
              className={styles.textInput}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={currentUser?.username ?? 'Enter a nickname'}
              maxLength={32}
            />
          </div>

          {error && (
            <p className={styles.errorText}>{error}</p>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
