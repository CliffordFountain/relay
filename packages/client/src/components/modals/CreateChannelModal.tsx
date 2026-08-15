import { useState, useEffect, useCallback, useMemo } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { addChannel, selectChannel } from '../../stores/channelsSlice';
import { closeModal } from '../../stores/uiSlice';
import { api } from '../../api/rest';
import type { RootState } from '../../stores/store';
import styles from './createChannelModal.module.scss';

const selectAllChannels = createSelector(
  (state: RootState) => state.channels.channels,
  (channels) => Object.values(channels)
);

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_VOICE = 2;
const CHANNEL_TYPE_CATEGORY = 4;

export interface CreateChannelModalProps {
  guildId?: string;
  onClose?: () => void;
}

export const CreateChannelModal = ({ guildId: propGuildId, onClose }: CreateChannelModalProps) => {
  const dispatch = useAppDispatch();
  const storeGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const modalProps = useAppSelector(s => s.ui.modalProps);
  const guildId = propGuildId ?? storeGuildId;
  const channels = useAppSelector(selectAllChannels);

  const initialCategoryId = typeof modalProps.parentId === 'string' ? modalProps.parentId : '';
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState<number>(CHANNEL_TYPE_TEXT);
  const [categoryId, setCategoryId] = useState<string>(initialCategoryId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(
    () => channels.filter(c => c.guild_id === guildId && c.type === CHANNEL_TYPE_CATEGORY),
    [channels, guildId],
  );

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

  const formatChannelName = (value: string): string => {
    return value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '');
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChannelName(formatChannelName(e.target.value));
  };

  const handleCreate = async () => {
    const trimmed = channelName.trim();
    if (!trimmed || !guildId || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const data: { name: string; type: number; parent_id?: string } = {
        name: trimmed,
        type: channelType,
      };
      if (categoryId) {
        data.parent_id = categoryId;
      }

      const channel = await api.createChannel(guildId, data);
      dispatch(addChannel({
        id: channel.id,
        guild_id: channel.guild_id,
        type: channel.type,
        name: channel.name,
        topic: channel.topic,
        position: channel.position,
        parent_id: channel.parent_id,
      }));
      if (channelType === CHANNEL_TYPE_TEXT) {
        dispatch(selectChannel(channel.id));
      }
      handleClose();
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError.message ?? 'Failed to create channel');
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
      aria-label="Create Channel"
    >
      <div className={styles.modal}>
        <form onSubmit={handleFormSubmit}>
          <div className={styles.header}>
            <h2 className={styles.title}>Create Channel</h2>
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
            <div className={styles.formGroup}>
              <label className={styles.label}>CHANNEL TYPE</label>
              <div className={styles.typeSelector}>
                <button
                  type="button"
                  className={`${styles.typeOption} ${channelType === CHANNEL_TYPE_TEXT ? styles.typeSelected : ''}`}
                  onClick={() => setChannelType(CHANNEL_TYPE_TEXT)}
                >
                  <div className={styles.typeIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41001 9L8.35001 15H14.35L15.41 9H9.41001Z" />
                    </svg>
                  </div>
                  <div className={styles.typeInfo}>
                    <div className={styles.typeName}>Text</div>
                    <div className={styles.typeDescription}>Send messages, images, GIFs, emoji, opinions, and puns</div>
                  </div>
                  <div className={styles.typeRadio}>
                    {channelType === CHANNEL_TYPE_TEXT && <div className={styles.typeRadioInner} />}
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.typeOption} ${channelType === CHANNEL_TYPE_VOICE ? styles.typeSelected : ''}`}
                  onClick={() => setChannelType(CHANNEL_TYPE_VOICE)}
                >
                  <div className={styles.typeIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H2C1.45 7.00304 1 7.45304 1 8.00304V16.003C1 16.553 1.45 17.003 2 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904ZM14 5.00304V7.00304C16.757 7.00304 19 9.24604 19 12.003C19 14.76 16.757 17.003 14 17.003V19.003C17.86 19.003 21 15.863 21 12.003C21 8.14304 17.86 5.00304 14 5.00304ZM14 9.00304V15.003C15.654 15.003 17 13.657 17 12.003C17 10.349 15.654 9.00304 14 9.00304Z" />
                    </svg>
                  </div>
                  <div className={styles.typeInfo}>
                    <div className={styles.typeName}>Voice</div>
                    <div className={styles.typeDescription}>Talk with voice, video, and screen sharing</div>
                  </div>
                  <div className={styles.typeRadio}>
                    {channelType === CHANNEL_TYPE_VOICE && <div className={styles.typeRadioInner} />}
                  </div>
                </button>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="channel-name">
                CHANNEL NAME
              </label>
              <div className={styles.inputWrapper}>
                <span className={styles.inputPrefix}>
                  {channelType === CHANNEL_TYPE_TEXT ? '#' : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H2C1.45 7.00304 1 7.45304 1 8.00304V16.003C1 16.553 1.45 17.003 2 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904Z" />
                    </svg>
                  )}
                </span>
                <input
                  id="channel-name"
                  type="text"
                  className={styles.input}
                  value={channelName}
                  onChange={handleNameChange}
                  placeholder="new-channel"
                  maxLength={100}
                  autoFocus
                />
              </div>
              {error && <p className={styles.error}>{error}</p>}
            </div>

            {categories.length > 0 && (
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="channel-category">
                  CATEGORY
                </label>
                <select
                  id="channel-category"
                  className={styles.select}
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">No Category</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            )}
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
              disabled={!channelName.trim() || isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
