import { useEffect } from 'react';
import { useAppSelector } from './useAppDispatch';

/**
 * Subscribes to notification state and updates document.title with the unread
 * mention count, mirroring the behavior: "(5) Relay" when there are
 * unread mentions, or just "Relay" when there are none.
 */
export const useTitleUpdater = (): void => {
  const mentionsByChannel = useAppSelector(s => s.notifications.mentionsByChannel);

  useEffect(() => {
    const totalMentions = Object.values(mentionsByChannel).reduce(
      (sum, count) => sum + count,
      0,
    );

    if (totalMentions > 0) {
      document.title = `(${totalMentions}) Relay`;
    } else {
      document.title = 'Relay';
    }
  }, [mentionsByChannel]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      document.title = 'Relay';
    };
  }, []);
};
