import { useState, useEffect, useCallback } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { addGuild, selectGuild } from '../../stores/guildsSlice';
import { setChannels, selectChannel } from '../../stores/channelsSlice';
import { closeModal } from '../../stores/uiSlice';
import { api } from '../../api/rest';
import styles from './createGuildModal.module.scss';

export interface CreateGuildModalProps {
  onClose?: () => void;
}

export const CreateGuildModal = ({ onClose }: CreateGuildModalProps) => {
  const dispatch = useAppDispatch();
  const [serverName, setServerName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const getInitials = (name: string): string => {
    if (!name.trim()) return '';
    return name
      .trim()
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
  };

  const handleCreate = async () => {
    const trimmed = serverName.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const guild = await api.createGuild({ name: trimmed });
      dispatch(addGuild(guild));
      // Store channels returned from guild creation (categories + default channels)
      if (Array.isArray(guild.channels)) {
        dispatch(setChannels(guild.channels));
        // Auto-select the first text channel
        const firstTextChannel = guild.channels
          .filter((c: { type: number }) => c.type === 0)
          .sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0];
        if (firstTextChannel) {
          dispatch(selectChannel(firstTextChannel.id));
        }
      }
      dispatch(selectGuild(guild.id));
      handleClose();
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError.message ?? 'Failed to create server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleCreate();
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Create a server"
    >
      <div className={styles.modal}>
        <form onSubmit={handleFormSubmit}>
          <div className={styles.header}>
            <h2 className={styles.title}>Create a server</h2>
            <p className={styles.subtitle}>
              A server is your own place to chat, call, and hang out. Give it a name to get
              started — you can change it later.
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
            <div className={styles.iconUpload}>
              <div className={styles.iconPreview} aria-label="Server icon preview">
                {getInitials(serverName) || (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4 4h7V2H4a2 2 0 00-2 2v7h2V4zm6 2v4h4V6h-4zm-2-2H6v2h2V4zm0 12H6v2h2v-2zm8-8h2V4h-2v2h-2v2h2V6zm-8 4H6v2h2v-2zm12-4h2V4h-2v2zm0 4h2v-2h-2v2zm0 4h2v-2h-2v2zm0 4v-2h-2v2h2zm-4 0v-2h-2v2h2zm-8 0v-2H6v2h2zm-4 0v-2H2v2h2zm0-4H2v2h2v-2z" />
                  </svg>
                )}
              </div>
              <span className={styles.iconUploadLabel}>UPLOAD</span>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="server-name">
                SERVER NAME
              </label>
              <input
                id="server-name"
                type="text"
                className={styles.input}
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="Enter a server name"
                maxLength={100}
                autoFocus
              />
              {error && <p className={styles.error}>{error}</p>}
            </div>
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.createButton}
              disabled={!serverName.trim() || isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
