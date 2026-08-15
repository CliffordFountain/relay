import { useCallback } from 'react';
import styles from './nsfwGate.module.scss';

const NSFW_ACCEPTED_KEY = 'nsfw_accepted_channels';

export interface NsfwGateProps {
  channelId: string;
  channelName: string;
  onAccept: () => void;
}

export const NsfwGate = ({ channelId, channelName, onAccept }: NsfwGateProps) => {
  const handleAccept = useCallback(() => {
    try {
      const stored = localStorage.getItem(NSFW_ACCEPTED_KEY);
      const accepted: string[] = stored ? JSON.parse(stored) as string[] : [];
      if (!accepted.includes(channelId)) {
        accepted.push(channelId);
        localStorage.setItem(NSFW_ACCEPTED_KEY, JSON.stringify(accepted));
      }
    } catch {
      // Storage may be unavailable
    }
    onAccept();
  }, [channelId, onAccept]);

  return (
    <div className={styles.container} role="alertdialog" aria-label="Age-restricted channel">
      <div className={styles.content}>
        <div className={styles.icon} aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z" />
          </svg>
        </div>
        <h2 className={styles.title}>This is an NSFW channel</h2>
        <p className={styles.description}>
          You must be at least 18 years old to view this channel.
        </p>
        <p className={styles.channelName}>#{channelName}</p>
        <button
          type="button"
          className={styles.acceptButton}
          onClick={handleAccept}
        >
          I agree and wish to enter
        </button>
      </div>
    </div>
  );
};

export function isNsfwAccepted(channelId: string): boolean {
  try {
    const stored = localStorage.getItem(NSFW_ACCEPTED_KEY);
    if (!stored) return false;
    const accepted = JSON.parse(stored) as string[];
    return accepted.includes(channelId);
  } catch {
    return false;
  }
}
