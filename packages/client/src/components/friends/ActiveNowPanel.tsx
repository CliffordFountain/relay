import { useMemo } from 'react';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { selectPresences } from '../../stores/selectors';
import { RelationshipType } from '../../stores/relationshipsSlice';
import type { Activity } from '../../stores/presenceSlice';
import styles from './activeNowPanel.module.scss';

export interface ActiveNowPanelProps {
  className?: string;
}

const ACTIVITY_TYPE_LABELS: Record<number, string> = {
  0: 'Playing',
  1: 'Streaming',
  2: 'Listening to',
  3: 'Watching',
  4: '',
  5: 'Competing in',
};

function getActivityText(activity: Activity): string {
  const prefix = ACTIVITY_TYPE_LABELS[activity.type] ?? '';
  if (activity.type === 4) {
    return activity.state ?? activity.name;
  }
  return `${prefix} ${activity.name}`.trim();
}

export const ActiveNowPanel = ({ className }: ActiveNowPanelProps) => {
  const relationships = useAppSelector(s => s.relationships.relationships);
  const presences = useAppSelector(selectPresences);
  const activeNowPanelOpen = useAppSelector(s => s.ui.activeNowPanelOpen);

  const activeFriends = useMemo(() => {
    const friendIds = Object.values(relationships)
      .filter(r => r.type === RelationshipType.FRIEND)
      .map(r => r.user);

    return friendIds
      .map(user => {
        const presence = presences[user.id];
        if (!presence || presence.status === 'offline') return null;
        const activity = presence.activities.find(a => a.type !== 4) ?? presence.activities[0];
        if (!activity) return null;
        return {
          user,
          activity,
          status: presence.status,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [relationships, presences]);

  if (!activeNowPanelOpen) {
    return null;
  }

  return (
    <aside
      className={`${styles.panel} ${className ?? ''}`}
      aria-label="Active Now"
    >
      <h2 className={styles.header}>Active Now</h2>

      {activeFriends.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIllustration} aria-hidden="true">
            <svg width="184" height="120" viewBox="0 0 184 120" fill="none">
              <rect x="28" y="20" width="128" height="80" rx="8" fill="#303236" />
              <circle cx="60" cy="54" r="16" fill="#3d3f45" />
              <rect x="84" y="46" width="48" height="8" rx="4" fill="#3d3f45" />
              <rect x="84" y="58" width="32" height="6" rx="3" fill="#3d3f45" />
              <circle cx="60" cy="90" r="6" fill="#3d3f45" />
              <circle cx="80" cy="90" r="6" fill="#3d3f45" />
              <circle cx="100" cy="90" r="6" fill="#3d3f45" />
            </svg>
          </div>
          <p className={styles.emptyTitle}>Nothing happening yet</p>
          <p className={styles.emptyDescription}>
            When people you know start a game or hop into voice, you'll see it here.
          </p>
        </div>
      ) : (
        <div className={styles.activeList} role="list">
          {activeFriends.map(({ user, activity, status }) => {
            const displayName = user.display_name ?? user.username;
            return (
              <div
                key={user.id}
                className={styles.activeItem}
                role="listitem"
                aria-label={`${displayName} - ${getActivityText(activity)}`}
              >
                <div className={styles.userSection}>
                  <div className={styles.avatarWrapper}>
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt=""
                        className={styles.avatar}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.avatarFallback}>
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div
                      className={`${styles.statusDot} ${styles[`status_${status}`]}`}
                      aria-label={status}
                    />
                  </div>
                  <span className={styles.username}>{displayName}</span>
                </div>
                <div className={styles.activityCard}>
                  {activity.assets?.largeImage && (
                    <img
                      src={activity.assets.largeImage}
                      alt=""
                      className={styles.activityImage}
                      loading="lazy"
                    />
                  )}
                  <div className={styles.activityInfo}>
                    <span className={styles.activityName}>
                      {getActivityText(activity)}
                    </span>
                    {activity.details && (
                      <span className={styles.activityDetails}>
                        {activity.details}
                      </span>
                    )}
                    {activity.state && activity.type !== 4 && (
                      <span className={styles.activityState}>
                        {activity.state}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
