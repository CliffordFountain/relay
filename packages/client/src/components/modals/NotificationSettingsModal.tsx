import { useState, useEffect, useCallback } from 'react';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { api } from '../../api/rest';
import styles from './notificationSettingsModal.module.scss';

export type NotificationLevel = 'all' | 'mentions' | 'nothing' | 'default';

export interface NotificationSettingsModalProps {
  guildId: string;
  onClose: () => void;
}

// Backend encoding: message_notifications is 0=all, 1=mentions, 2=nothing. There
// is no distinct guild-level value for "default" (that only means something as a
// per-channel override), so it round-trips through "all".
const LEVEL_TO_MESSAGE_NOTIFICATIONS: Record<NotificationLevel, number> = {
  all: 0,
  mentions: 1,
  nothing: 2,
  default: 0,
};

function messageNotificationsToLevel(value: number): NotificationLevel {
  if (value === 1) return 'mentions';
  if (value === 2) return 'nothing';
  return 'all';
}

export const NotificationSettingsModal = ({ guildId, onClose }: NotificationSettingsModalProps) => {
  const guild = useAppSelector(s => s.guilds.guilds[guildId]);

  const [notificationLevel, setNotificationLevel] = useState<NotificationLevel>('default');
  const [suppressEveryone, setSuppressEveryone] = useState(false);
  const [suppressRoles, setSuppressRoles] = useState(false);
  const [mobilePush, setMobilePush] = useState(true);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    let cancelled = false;
    api.getGuildNotificationSettings(guildId)
      .then(settings => {
        if (cancelled) return;
        setNotificationLevel(messageNotificationsToLevel(settings.message_notifications));
        setSuppressEveryone(settings.suppress_everyone);
        setSuppressRoles(settings.suppress_roles);
      })
      .catch(() => {
        // No settings saved yet, or the request failed - keep the defaults.
      });
    return () => { cancelled = true; };
  }, [guildId]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSave = () => {
    void api.updateGuildNotificationSettings(guildId, {
      message_notifications: LEVEL_TO_MESSAGE_NOTIFICATIONS[notificationLevel],
      suppress_everyone: suppressEveryone,
      suppress_roles: suppressRoles,
    }).catch(() => {
      // Best-effort save; the modal already reflects the chosen settings locally.
    });
    onClose();
  };

  const notificationOptions: Array<{ value: NotificationLevel; label: string; description: string }> = [
    { value: 'all', label: 'All Messages', description: 'You will be notified for every message sent in this server.' },
    { value: 'mentions', label: 'Only @mentions', description: 'You will only be notified when someone mentions you.' },
    { value: 'nothing', label: 'Nothing', description: 'You will not receive any notifications from this server.' },
    { value: 'default', label: 'Use Server Default', description: 'Use the notification setting configured by the server.' },
  ];

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Notification Settings"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Notification Settings</h2>
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
            <h3 className={styles.sectionTitle}>SERVER NOTIFICATION SETTINGS</h3>
            <div className={styles.radioGroup} role="radiogroup" aria-label="Notification level">
              {notificationOptions.map(option => (
                <label
                  key={option.value}
                  className={`${styles.radioOption} ${notificationLevel === option.value ? styles.radioOptionSelected : ''}`}
                >
                  <input
                    type="radio"
                    name="notificationLevel"
                    value={option.value}
                    checked={notificationLevel === option.value}
                    onChange={() => setNotificationLevel(option.value)}
                    className={styles.radioInput}
                  />
                  <div className={styles.radioCircle}>
                    {notificationLevel === option.value && (
                      <div className={styles.radioCircleInner} />
                    )}
                  </div>
                  <div className={styles.radioLabel}>
                    <span className={styles.radioLabelText}>{option.label}</span>
                    <span className={styles.radioDescription}>{option.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>SUPPRESSION</h3>
            <ToggleRow
              label="Suppress @everyone and @here"
              description="When enabled, you will not receive notifications from @everyone and @here mentions."
              checked={suppressEveryone}
              onChange={setSuppressEveryone}
            />
            <ToggleRow
              label="Suppress All Role @mentions"
              description="When enabled, you will not receive notifications from role mentions."
              checked={suppressRoles}
              onChange={setSuppressRoles}
            />
          </div>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>MOBILE PUSH NOTIFICATIONS</h3>
            <ToggleRow
              label="Mobile Push Notifications"
              description="Receive push notifications on your mobile device for this server."
              checked={mobilePush}
              onChange={setMobilePush}
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
            className={styles.saveButton}
            onClick={handleSave}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

const ToggleRow = ({ label, description, checked, onChange }: ToggleRowProps) => {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleInfo}>
        <span className={styles.toggleLabel}>{label}</span>
        <span className={styles.toggleDescription}>{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
        onClick={() => onChange(!checked)}
      >
        <div className={styles.toggleHandle} />
      </button>
    </div>
  );
};
