import { useEffect, useRef, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from './useAppDispatch';
import { setPresenceStatus, type PresenceStatus } from '../stores/authSlice';
import { setSelfStatus } from '../stores/presenceSlice';
import { gateway } from '../api/gateway';

/**
 * Auto-idle timeout in milliseconds.
 * Relay sets the user to idle after approximately 5 minutes of inactivity.
 */
const AUTO_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Activity events that reset the idle timer.
 */
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
];

/**
 * Hook that automatically sets the user's status to 'idle' after 5 minutes
 * of no mouse/keyboard activity, then restores it on activity.
 *
 * Only activates when the user's current status is 'online'.
 * Does not interfere with DND or Invisible statuses.
 */
export const useAutoIdle = (): void => {
  const dispatch = useAppDispatch();
  const currentStatus = useAppSelector(s => s.auth.status);
  const customStatus = useAppSelector(s => s.auth.customStatus);
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoIdleRef = useRef(false);
  const previousStatusRef = useRef<PresenceStatus>('online');

  const setIdle = useCallback(() => {
    // Only auto-idle if the user is currently 'online'
    if (currentStatus !== 'online') return;

    previousStatusRef.current = currentStatus;
    isAutoIdleRef.current = true;
    dispatch(setPresenceStatus('idle'));
    dispatch(setSelfStatus('idle'));
    gateway.sendPresenceUpdate('idle', customStatus);
  }, [currentStatus, customStatus, dispatch]);

  const restoreFromIdle = useCallback(() => {
    if (!isAutoIdleRef.current) return;

    isAutoIdleRef.current = false;
    const restoreTo = previousStatusRef.current;
    dispatch(setPresenceStatus(restoreTo));
    dispatch(setSelfStatus(restoreTo));
    gateway.sendPresenceUpdate(restoreTo, customStatus);
  }, [customStatus, dispatch]);

  const resetTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    // If auto-idle was triggered, restore the previous status on activity
    restoreFromIdle();

    // Only set up the idle timer if the user is online
    if (currentStatus === 'online' || isAutoIdleRef.current) {
      timerRef.current = setTimeout(setIdle, AUTO_IDLE_TIMEOUT_MS);
    }
  }, [currentStatus, setIdle, restoreFromIdle]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Don't auto-idle for DND or Invisible
    if (currentStatus !== 'online' && !isAutoIdleRef.current) return;

    // Start the initial timer
    timerRef.current = setTimeout(setIdle, AUTO_IDLE_TIMEOUT_MS);

    const handler = () => {
      resetTimer();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handler, { passive: true });
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handler);
      }
    };
  }, [isAuthenticated, currentStatus, setIdle, resetTimer]);

  // When the user manually changes status, clear auto-idle state
  useEffect(() => {
    if (!isAutoIdleRef.current) {
      previousStatusRef.current = currentStatus;
    }
  }, [currentStatus]);
};
