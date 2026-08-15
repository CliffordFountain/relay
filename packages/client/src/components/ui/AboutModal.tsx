import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import styles from './aboutModal.module.scss';

export interface AboutModalProps {
  onClose: () => void;
}

// No shared version constant exists yet in the client - UserSettings hardcodes
// the same string for its build info footer, so this mirrors that value.
const RELAY_VERSION = 'Relay v0.1.0';

export const AboutModal = ({ onClose }: AboutModalProps) => {
  const navigate = useNavigate();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Open the legal pages via in-app navigation instead of target="_blank" anchors.
  // window.open / new-window behaviour is unreliable in the Electron shell (main.ts
  // registers no setWindowOpenHandler), whereas react-router navigation behaves
  // identically in the browser and the desktop app. Close the modal first so the
  // user lands cleanly on the page.
  const openLegalPage = (path: string) => {
    onClose();
    navigate(path);
  };

  const modal = (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="About &amp; Help"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>About &amp; Help</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
              />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.description}>
            Relay is a self-hosted, real-time platform for communities you fully own &mdash;
            voice, video, and text, running on your own infrastructure. Voice calls use hi-fi
            Opus audio up to 512&nbsp;kbps, video is HD with simulcast, and screen sharing
            supports up to 4K.
          </p>
          <p className={styles.version}>{RELAY_VERSION}</p>

          <div className={styles.divider} />

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Help</h3>
            <ul className={styles.helpList}>
              <li>Create or join a server to get started.</li>
              <li>Pick a channel and start chatting.</li>
              <li>Join a voice channel to start a voice call.</li>
            </ul>
            <p className={styles.helpNote}>
              Looking for keyboard shortcuts? Find them under Keybinds in User Settings.
            </p>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.link}
            onClick={() => openLegalPage('/terms')}
          >
            Terms of Service
          </button>
          <span className={styles.linkSep} aria-hidden="true">&middot;</span>
          <button
            type="button"
            className={styles.link}
            onClick={() => openLegalPage('/privacy')}
          >
            Privacy Policy
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
