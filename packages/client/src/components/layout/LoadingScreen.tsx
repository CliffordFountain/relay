import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './loadingScreen.module.scss';

const LOADING_TIPS: ReadonlyArray<string> = [
  'You can use Ctrl+K to quickly search for channels, users, and more.',
  'Right-click a user to see quick actions like messaging or muting.',
  'You can drag and drop files into a chat to upload them.',
  'Use Shift+Enter to add a new line without sending your message.',
  'You can create a thread from any message to keep conversations organized.',
  'Pin important messages so your group can find them easily.',
  'Customize notification settings per channel to reduce noise.',
  'You can mark a server as read by right-clicking its icon.',
  'Hold Shift and click a reaction to add a super reaction.',
  'Use Ctrl+Shift+M to toggle the mute on your microphone.',
  'You can set a custom status to let friends know what you are up to.',
  'Drag channels in the sidebar to reorder them.',
];

export interface LoadingScreenProps {
  message?: string;
}

export const LoadingScreen = ({ message }: LoadingScreenProps) => {
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * LOADING_TIPS.length));
  const [tipVisible, setTipVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rotateTip = useCallback(() => {
    setTipVisible(false);
    setTimeout(() => {
      setTipIndex(prev => (prev + 1) % LOADING_TIPS.length);
      setTipVisible(true);
    }, 300);
  }, []);

  useEffect(() => {
    timerRef.current = setInterval(rotateTip, 5000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [rotateTip]);

  return (
    <div className={styles.container} role="status" aria-label="Loading application">
      <div className={styles.content}>
        <div className={styles.logo}>
          {/* Relay mark: concentric "relay" signal rings (matches the server-rail brand) */}
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <circle
              cx="12"
              cy="12"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeDasharray="12.6 6.3"
              transform="rotate(-30 12 12)"
            />
            <circle
              cx="12"
              cy="12"
              r="9.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeDasharray="19.7 9.85"
              transform="rotate(15 12 12)"
              opacity="0.5"
            />
          </svg>
        </div>
        <div className={styles.loadingBar}>
          <div className={styles.loadingBarFill} />
        </div>
        {message && <p className={styles.message}>{message}</p>}
        <p className={`${styles.tip} ${tipVisible ? styles.tipVisible : styles.tipHidden}`}>
          <span className={styles.tipLabel}>DID YOU KNOW</span>
          {LOADING_TIPS[tipIndex]}
        </p>
      </div>
    </div>
  );
};
