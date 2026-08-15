import { useState, useEffect, useCallback } from 'react';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { api } from '../../api/rest';
import styles from './createEventModal.module.scss';

export interface CreateEventModalProps {
  guildId: string;
  onClose: () => void;
}

type EventLocationType = 'voice' | 'stage' | 'external';

export const CreateEventModal = ({ guildId, onClose }: CreateEventModalProps) => {
  const guild = useAppSelector(s => s.guilds.guilds[guildId]);

  const [locationType, setLocationType] = useState<EventLocationType>('voice');
  const [eventName, setEventName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

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

  const isValid = eventName.trim().length > 0 && startDate.length > 0 && startTime.length > 0;

  const handleCreate = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    const entityType = locationType === 'external' ? 3 : locationType === 'stage' ? 1 : 2;
    const start = new Date(`${startDate}T${startTime}`).toISOString();
    const end = endDate && endTime ? new Date(`${endDate}T${endTime}`).toISOString() : undefined;
    try {
      await api.createGuildScheduledEvent(guildId, {
        name: eventName.trim(),
        scheduled_start_time: start,
        scheduled_end_time: end,
        description: description.trim() || undefined,
        entity_type: entityType,
      });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Create Event"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create Event</h2>
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
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Event Location</h3>
            <div className={styles.locationOptions} role="radiogroup" aria-label="Event location type">
              <button
                type="button"
                className={`${styles.locationOption} ${locationType === 'voice' ? styles.locationOptionSelected : ''}`}
                onClick={() => setLocationType('voice')}
                role="radio"
                aria-checked={locationType === 'voice'}
              >
                <svg className={styles.locationIcon} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H2C1.45 7.00304 1 7.45304 1 8.00304V16.003C1 16.553 1.45 17.003 2 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904Z" />
                </svg>
                Voice Channel
              </button>
              <button
                type="button"
                className={`${styles.locationOption} ${locationType === 'stage' ? styles.locationOptionSelected : ''}`}
                onClick={() => setLocationType('stage')}
                role="radio"
                aria-checked={locationType === 'stage'}
              >
                <svg className={styles.locationIcon} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.61 18.25a1.08 1.08 0 0 1-.07-1.33 9 9 0 1 0-15.07 0c.26.42.25.97-.08 1.33l-.02.02c-.41.44-1.12.43-1.46-.07a11 11 0 1 1 18.17 0c-.33.5-1.04.51-1.45.07l-.02-.02Z" />
                  <path d="M16.83 15.23c.2-.45.11-.98-.2-1.34a5.5 5.5 0 1 0-9.25 0 1.11 1.11 0 0 1-.21 1.34c-.41.39-1.07.34-1.39-.13a7.5 7.5 0 1 1 12.44 0c-.31.47-.97.52-1.39.13Z" />
                  <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                </svg>
                Stage Channel
              </button>
              <button
                type="button"
                className={`${styles.locationOption} ${locationType === 'external' ? styles.locationOptionSelected : ''}`}
                onClick={() => setLocationType('external')}
                role="radio"
                aria-checked={locationType === 'external'}
              >
                <svg className={styles.locationIcon} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                </svg>
                Somewhere Else
              </button>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="event-name">
              Event Name
              <span className={styles.requiredStar}>*</span>
            </label>
            <input
              id="event-name"
              type="text"
              className={styles.textInput}
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="Enter event name"
              maxLength={100}
            />
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>
              Start Date & Time
              <span className={styles.requiredStar}>*</span>
            </span>
            <div className={styles.dateTimeRow}>
              <div className={styles.dateTimeField}>
                <input
                  type="date"
                  className={styles.dateTimeInput}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  aria-label="Start date"
                />
              </div>
              <div className={styles.dateTimeField}>
                <input
                  type="time"
                  className={styles.dateTimeInput}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  aria-label="Start time"
                />
              </div>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>
              End Date & Time
              <span className={styles.optionalLabel}>(optional)</span>
            </span>
            <div className={styles.dateTimeRow}>
              <div className={styles.dateTimeField}>
                <input
                  type="date"
                  className={styles.dateTimeInput}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  aria-label="End date"
                />
              </div>
              <div className={styles.dateTimeField}>
                <input
                  type="time"
                  className={styles.dateTimeInput}
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  aria-label="End time"
                />
              </div>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="event-description">
              Description
              <span className={styles.optionalLabel}>(optional)</span>
            </label>
            <textarea
              id="event-description"
              className={styles.textArea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people a little more about the event"
              maxLength={1000}
            />
          </div>
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
            className={styles.createButton}
            onClick={() => void handleCreate()}
            disabled={!isValid || saving}
          >
            {saving ? 'Creating…' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>
  );
};
