import styles from './slowmodeIndicator.module.scss';

export interface SlowmodeIndicatorProps {
  seconds: number;
  cooldown: number;
}

export const SlowmodeIndicator = ({ seconds, cooldown }: SlowmodeIndicatorProps) => {
  const formatTime = (secs: number): string => {
    if (secs >= 3600) {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (secs >= 60) {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    return `${secs}s`;
  };

  return (
    <div
      className={`${styles.container} ${cooldown > 0 ? styles.active : ''}`}
      role="status"
      aria-label={cooldown > 0 ? `Slowmode: ${cooldown} seconds remaining` : `Slowmode: ${seconds} seconds`}
    >
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm1-13h-2v6l5.25 3.15.75-1.23-4-2.42V7z" />
      </svg>
      <span className={styles.text}>
        {cooldown > 0
          ? formatTime(cooldown)
          : formatTime(seconds)}
      </span>
    </div>
  );
};
