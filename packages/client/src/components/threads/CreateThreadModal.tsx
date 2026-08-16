import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { addThread, selectThread } from '../../stores/threadsSlice';
import type { Thread } from '../../stores/threadsSlice';
import { api } from '../../api/rest';
import styles from './createThreadModal.module.scss';

export interface CreateThreadModalProps {
  channelId: string;
  messageId?: string;
  onClose: () => void;
}

const AUTO_ARCHIVE_OPTIONS = [
  { value: 60, label: '1 Hour' },
  { value: 1440, label: '24 Hours' },
  { value: 4320, label: '3 Days' },
  { value: 10080, label: '1 Week' },
];

export const CreateThreadModal = ({
  channelId,
  messageId,
  onClose,
}: CreateThreadModalProps) => {
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');
  const [autoArchiveDuration, setAutoArchiveDuration] = useState(1440);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const threadType = isPrivate ? 12 : 11;
      const data = {
        name: name.trim(),
        auto_archive_duration: autoArchiveDuration,
        type: threadType,
      };

      let result: Record<string, unknown>;
      if (messageId) {
        result = await api.createThreadFromMessage(channelId, messageId, data);
      } else {
        result = await api.createThread(channelId, data);
      }

      dispatch(addThread(result as unknown as Thread));
      dispatch(selectThread(result.id as string));
      onClose();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setError(errorObj.message ?? 'Failed to create thread');
    } finally {
      setIsSubmitting(false);
    }
  }, [name, autoArchiveDuration, isPrivate, channelId, messageId, isSubmitting, dispatch, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }, [handleSubmit]);

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Create Thread"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create Thread</h2>
          <p className={styles.subtitle}>
            {messageId
              ? 'Start a thread from this message'
              : 'Start a new thread in this channel'}
          </p>
        </div>

        <div className={styles.body}>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="thread-name">
              Thread Name
            </label>
            <input
              ref={inputRef}
              id="thread-name"
              className={styles.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="New Thread"
              maxLength={100}
              aria-required="true"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="auto-archive">
              Auto-Archive After
            </label>
            <select
              id="auto-archive"
              className={styles.select}
              value={autoArchiveDuration}
              onChange={(e) => setAutoArchiveDuration(Number(e.target.value))}
            >
              {AUTO_ARCHIVE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Private Thread</span>
              <button
                className={`${styles.toggle} ${isPrivate ? styles.toggleActive : ''}`}
                onClick={() => setIsPrivate(!isPrivate)}
                role="switch"
                aria-checked={isPrivate}
                type="button"
              >
                <div className={styles.toggleKnob} />
              </button>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.createButton}
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || isSubmitting}
            type="button"
          >
            {isSubmitting ? 'Creating...' : 'Create Thread'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
