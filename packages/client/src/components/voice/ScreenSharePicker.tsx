import { useState, useEffect, useCallback } from 'react';
import styles from './screenSharePicker.module.scss';

/** One capturable source, as serialized by the desktop main process. */
interface ScreenSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail: string;
  appIcon: string | null;
}

interface ScreenShareRequest {
  requestId: number;
  sources: ScreenSource[];
}

interface ScreenShareElectronApi {
  onScreenShareRequest?: (callback: (request: ScreenShareRequest) => void) => () => void;
  pickScreenShareSource?: (requestId: number, sourceId: string | null) => Promise<void>;
}

function getElectronApi(): ScreenShareElectronApi | undefined {
  return (window as unknown as { electronAPI?: ScreenShareElectronApi }).electronAPI;
}

/**
 * App-global host for the desktop (Electron) screen-share source picker.
 *
 * In the browser there is no `window.electronAPI`, so this subscribes to nothing and
 * renders nothing: native getDisplayMedia keeps showing the browser's own picker. In
 * the desktop app the main process intercepts getDisplayMedia, enumerates every screen
 * and window, and asks us to let the user choose one; we reply with the chosen source
 * id (or null to cancel) over IPC.
 */
export const ScreenSharePicker = () => {
  const [request, setRequest] = useState<ScreenShareRequest | null>(null);

  useEffect(() => {
    const api = getElectronApi();
    if (!api?.onScreenShareRequest) return;
    // A new request replaces any previous one (main already rejected the old picker).
    return api.onScreenShareRequest((next) => setRequest(next));
  }, []);

  const respond = useCallback(
    (sourceId: string | null) => {
      if (!request) return;
      void getElectronApi()?.pickScreenShareSource?.(request.requestId, sourceId);
      setRequest(null);
    },
    [request],
  );

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respond(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [request, respond]);

  if (!request) return null;

  const screens = request.sources.filter((s) => s.type === 'screen');
  const windows = request.sources.filter((s) => s.type === 'window');

  const renderSource = (source: ScreenSource) => (
    <button
      key={source.id}
      type="button"
      className={styles.sourceCard}
      onClick={() => respond(source.id)}
      title={source.name}
    >
      <img className={styles.thumb} src={source.thumbnail} alt="" />
      <span className={styles.sourceName}>
        {source.appIcon && <img className={styles.appIcon} src={source.appIcon} alt="" />}
        <span className={styles.sourceLabel}>{source.name}</span>
      </span>
    </button>
  );

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) respond(null);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose what to share"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Choose what to share</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => respond(null)}
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {screens.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Screens</h3>
              <div className={styles.grid}>{screens.map(renderSource)}</div>
            </section>
          )}
          {windows.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Applications &amp; Windows</h3>
              <div className={styles.grid}>{windows.map(renderSource)}</div>
            </section>
          )}
          {request.sources.length === 0 && (
            <p className={styles.empty}>No screens or windows are available to share.</p>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={() => respond(null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
