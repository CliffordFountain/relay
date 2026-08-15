import { useAppSelector } from '../../hooks/useAppDispatch';
import { selectTypingUsersByChannel } from '../../stores/selectors';
import styles from './typingIndicator.module.scss';

export interface TypingIndicatorProps {
  channelId: string;
}

export const TypingIndicator = ({ channelId }: TypingIndicatorProps) => {
  const typingUsers = useAppSelector(s => selectTypingUsersByChannel(s, channelId));
  const currentUserId = useAppSelector(s => s.auth.user?.id);

  // Filter out current user
  const others = typingUsers.filter(u => u.userId !== currentUserId);

  if (others.length === 0) return null;

  const formatTypingText = (): string => {
    const first = others[0];
    const second = others[1];
    const third = others[2];
    if (others.length === 1 && first) {
      return `${first.username} is typing...`;
    }
    if (others.length === 2 && first && second) {
      return `${first.username} and ${second.username} are typing...`;
    }
    if (others.length === 3 && first && second && third) {
      return `${first.username}, ${second.username}, and ${third.username} are typing...`;
    }
    return 'Several people are typing...';
  };

  return (
    <div className={styles.container} role="status" aria-label="Typing indicator">
      <div className={styles.dots}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
      <span className={styles.text}>{formatTypingText()}</span>
    </div>
  );
};
