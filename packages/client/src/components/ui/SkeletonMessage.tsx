import styles from './skeleton.module.scss';

export interface SkeletonMessageProps {
  /**
   * Whether this skeleton represents a grouped message (no avatar/header).
   */
  grouped?: boolean;
}

const randomWidth = (min: number, max: number): string => {
  const width = min + Math.floor(Math.random() * (max - min));
  return `${width}%`;
};

/** A single skeleton message placeholder with shimmer animation. */
const SingleSkeleton = ({ grouped = false }: SkeletonMessageProps) => {
  if (grouped) {
    return (
      <div className={`${styles.skeletonMessage} ${styles.grouped}`}>
        <div className={styles.skeletonGroupedContent}>
          <div className={styles.skeletonTextLine} style={{ width: randomWidth(40, 90) }} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.skeletonMessage}>
      <div className={styles.skeletonAvatar} />
      <div className={styles.skeletonMessageContent}>
        <div className={styles.skeletonHeader}>
          <div className={styles.skeletonAuthor} style={{ width: randomWidth(60, 120) }} />
          <div className={styles.skeletonTimestamp} />
        </div>
        <div className={styles.skeletonTextLine} style={{ width: randomWidth(50, 95) }} />
        <div className={styles.skeletonTextLine} style={{ width: randomWidth(30, 70) }} />
      </div>
    </div>
  );
};

export interface SkeletonMessageListProps {
  /** Number of skeleton messages to render. Defaults to 8. */
  count?: number;
}

/**
 * Renders a list of skeleton message placeholders.
 * Shows while messages are loading. Uses shimmer animation.
 */
export const SkeletonMessageList = ({ count = 8 }: SkeletonMessageListProps) => {
  // Create a deterministic pattern: groups of 1-3 messages
  const items: SkeletonMessageProps[] = [];
  let remaining = count;
  while (remaining > 0) {
    items.push({ grouped: false });
    remaining--;
    // Add 0-2 grouped follow-up messages
    const groupSize = Math.min(Math.floor(Math.random() * 3), remaining);
    for (let j = 0; j < groupSize; j++) {
      items.push({ grouped: true });
      remaining--;
    }
  }

  return (
    <div role="status" aria-label="Loading messages">
      {items.map((props, i) => (
        <SingleSkeleton key={i} {...props} />
      ))}
    </div>
  );
};
