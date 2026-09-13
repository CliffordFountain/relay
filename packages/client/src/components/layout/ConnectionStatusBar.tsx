import { useAppSelector } from '../../hooks/useAppDispatch';
import { gateway } from '../../api/gateway';
import type { GatewayConnection } from '../../stores/uiSlice';
import styles from './connectionStatusBar.module.scss';

const LABELS: Record<Exclude<GatewayConnection, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  resuming: 'Reconnecting…',
  disconnected: 'Connection lost',
};

/**
 * Fixed banner that surfaces the realtime gateway connection state. Renders nothing
 * while connected (the normal case) or when signed out. It gives the user visible
 * feedback during reconnection and a manual "Reconnect" affordance so a dropped
 * connection can always be recovered.
 */
export const ConnectionStatusBar = () => {
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const connection = useAppSelector(s => s.ui.gatewayConnection);

  if (!isAuthenticated || connection === 'connected') return null;

  const label = LABELS[connection];
  // Only offer a manual retry once auto-reconnect is under way or has stalled;
  // during the very first 'connecting' attempt a button would just be noise.
  const showReconnect = connection === 'reconnecting' || connection === 'disconnected';

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      {showReconnect && (
        <button
          className={styles.reconnectButton}
          type="button"
          onClick={() => gateway.reconnect()}
        >
          Reconnect
        </button>
      )}
    </div>
  );
};
