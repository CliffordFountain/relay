import styles from './skeleton.module.scss';

export interface SkeletonChannelItemProps {
  /** Width of the channel name placeholder in pixels. */
  nameWidth?: number;
}

/** A single skeleton channel item placeholder. */
const SingleChannelSkeleton = ({ nameWidth = 100 }: SkeletonChannelItemProps) => {
  return (
    <div className={styles.skeletonChannel}>
      <div className={styles.skeletonChannelIcon} />
      <div className={styles.skeletonChannelName} style={{ width: nameWidth }} />
    </div>
  );
};

export interface SkeletonChannelListProps {
  /** Number of skeleton channels to render. Defaults to 8. */
  count?: number;
}

/**
 * Renders a list of skeleton channel placeholders with category headers.
 * Shows while the channel list is loading.
 */
export const SkeletonChannelList = ({ count = 8 }: SkeletonChannelListProps) => {
  // Widths that simulate varying channel name lengths
  const widths = [120, 90, 140, 80, 110, 100, 130, 95, 115, 85];

  const channelsPerCategory = Math.ceil(count / 2);
  const firstGroup = Math.min(channelsPerCategory, count);
  const secondGroup = Math.max(0, count - firstGroup);

  return (
    <div role="status" aria-label="Loading channels">
      {/* First category */}
      <div className={styles.skeletonCategory}>
        <div className={styles.skeletonCategoryName} />
      </div>
      {Array.from({ length: firstGroup }, (_, i) => (
        <SingleChannelSkeleton key={`a-${i}`} nameWidth={widths[i % widths.length]} />
      ))}

      {/* Second category */}
      {secondGroup > 0 && (
        <>
          <div className={styles.skeletonCategory}>
            <div className={styles.skeletonCategoryName} style={{ width: 60 }} />
          </div>
          {Array.from({ length: secondGroup }, (_, i) => (
            <SingleChannelSkeleton key={`b-${i}`} nameWidth={widths[(i + 3) % widths.length]} />
          ))}
        </>
      )}
    </div>
  );
};
