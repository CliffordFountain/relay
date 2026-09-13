import styles from './startupErrorScreen.module.scss';

export interface StartupErrorScreenProps {
  message: string;
  onRetry: () => void;
}

/**
 * Shown when startup data loading fails for a non-auth reason (network drop, 5xx,
 * timeout). Unlike an auth failure, the token is preserved — the user isn't logged
 * out over a transient blip — and they can retry without re-entering credentials.
 */
export const StartupErrorScreen = ({ message, onRetry }: StartupErrorScreenProps) => (
  <div className={styles.container} role="alert" aria-label="Startup failed">
    <div className={styles.content}>
      <div className={styles.icon} aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1.25" fill="currentColor" />
        </svg>
      </div>
      <h1 className={styles.title}>Something went wrong</h1>
      <p className={styles.message}>{message}</p>
      <button className={styles.retryButton} type="button" onClick={onRetry}>
        Try Again
      </button>
    </div>
  </div>
);
