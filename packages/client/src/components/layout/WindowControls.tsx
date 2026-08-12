import styles from './windowControls.module.scss';

interface ElectronWindowApi {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  platform?: string;
}

/**
 * Standalone window controls (minimize / maximize / close) for the frameless
 * Electron window.
 *
 * The main app renders these inside its own `TitleBar`, but that only mounts once
 * you are signed in and inside the app shell. On the auth screens (login, register,
 * forgot/reset password, invite/verify) there is no TitleBar, so on Windows/Linux —
 * where the OS window chrome is hidden (`frame: false`) — the window would have no
 * close/minimize button at all. This component fills that gap.
 *
 * In a browser (no `electronAPI`) it renders nothing: the browser already has its
 * own window chrome. Read at render time (not module load) so it's robust to the
 * preload bridge arriving slightly late.
 */
export const WindowControls = () => {
  const electronApi = (window as unknown as { electronAPI?: ElectronWindowApi }).electronAPI;
  // macOS keeps its native traffic-light controls (frame:true), so custom controls there
  // would be a duplicate set. Only Windows/Linux need these.
  if (!electronApi || electronApi.platform === 'darwin') return null;
  return (
    <div className={styles.bar}>
      <div className={styles.drag} />
      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={() => electronApi.minimize()}
          type="button"
          aria-label="Minimize"
          title="Minimize"
        >
          &#x2500;
        </button>
        <button
          className={styles.btn}
          onClick={() => electronApi.maximize()}
          type="button"
          aria-label="Maximize"
          title="Maximize"
        >
          &#x25A1;
        </button>
        <button
          className={`${styles.btn} ${styles.close}`}
          onClick={() => electronApi.close()}
          type="button"
          aria-label="Close"
          title="Close"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
};
