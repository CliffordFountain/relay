import { useState, useEffect, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  toggleScreenShare,
  setUserStreaming,
  setStreamQuality,
} from '../../stores/voiceSlice';
import type { StreamQualitySettings } from '../../stores/voiceSlice';
import {
  useMediaStreams,
  isScreenShareSupported,
  isMediaSupported,
  MEDIA_INSECURE_CONTEXT_REASON,
} from '../../hooks/useMediaStreams';
import {
  playScreenShareStartSound,
} from '../../utils/sounds';
import styles from './goLiveModal.module.scss';

export interface GoLiveModalProps {
  onClose: () => void;
}

interface ResolutionOption {
  value: 480 | 720 | 1080 | 1440 | 2160 | 0;
  label: string;
  width: number;
  height: number;
}

interface FrameRateOption {
  value: 15 | 30 | 60;
  label: string;
}

const RESOLUTION_OPTIONS: ResolutionOption[] = [
  { value: 480, label: '480p', width: 854, height: 480 },
  { value: 720, label: '720p', width: 1280, height: 720 },
  { value: 1080, label: '1080p', width: 1920, height: 1080 },
  { value: 1440, label: '1440p', width: 2560, height: 1440 },
  { value: 2160, label: '2160p (4K)', width: 3840, height: 2160 },
  { value: 0, label: 'Source', width: 0, height: 0 },
];

const FRAME_RATE_OPTIONS: FrameRateOption[] = [
  { value: 15, label: '15 FPS' },
  { value: 30, label: '30 FPS' },
  { value: 60, label: '60 FPS' },
];

export const GoLiveModal = ({ onClose }: GoLiveModalProps) => {
  const dispatch = useAppDispatch();
  const streamQuality = useAppSelector(s => s.voice.streamQuality);
  const channelId = useAppSelector(s => s.voice.channelId);
  const currentUserId = useAppSelector(s => s.auth.user?.id);

  const [resolution, setResolution] = useState<StreamQualitySettings['resolution']>(streamQuality.resolution);
  const [frameRate, setFrameRate] = useState<StreamQualitySettings['frameRate']>(streamQuality.frameRate);
  const [shareAudio, setShareAudio] = useState(true);
  // Capability is static for the lifetime of the page; compute once.
  const [screenShareSupported] = useState(() => isScreenShareSupported());
  // A page served over plain http on a LAN IP is not a secure context, so no
  // screen/mic/camera capture is possible. This is fixable (switch to HTTPS),
  // so we show a more specific, actionable message than the generic one.
  const [mediaSupported] = useState(() => isMediaSupported());

  const { startScreenShare } = useMediaStreams();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleGoLive = useCallback(async () => {
    // Screen sharing is unsupported on this device/browser -- do not attempt
    // a broken capture flow (the action is also disabled in the UI).
    if (!screenShareSupported) return;

    const selectedResolution = RESOLUTION_OPTIONS.find(r => r.value === resolution);
    if (!selectedResolution) return;

    // Save quality settings to Redux
    dispatch(setStreamQuality({ resolution, frameRate }));

    // Toggle screen share state
    playScreenShareStartSound();
    dispatch(toggleScreenShare());

    if (currentUserId && channelId) {
      dispatch(setUserStreaming({ channelId, userId: currentUserId, streaming: true }));
    }

    // For "Source" (value 0), use high values so the browser captures at native resolution
    const isSource = selectedResolution.value === 0;
    await startScreenShare({
      width: isSource ? 4096 : selectedResolution.width,
      height: isSource ? 2160 : selectedResolution.height,
      frameRate,
      audio: shareAudio,
    });

    onClose();
  }, [screenShareSupported, resolution, frameRate, shareAudio, dispatch, currentUserId, channelId, startScreenShare, onClose]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Screen Share"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Screen Share</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.previewArea}>
            <div className={styles.previewPlaceholder}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H16V21.5H8V19.5H11V17.5H4C2.897 17.5 2 16.604 2 15.5V4.5ZM4 4.5V15.5H20V4.5H4Z" />
              </svg>
              {screenShareSupported ? (
                <span className={styles.previewText}>Your screen will be shared after clicking Go Live</span>
              ) : !mediaSupported ? (
                <span className={styles.previewText} role="alert">
                  {MEDIA_INSECURE_CONTEXT_REASON}
                </span>
              ) : (
                <span className={styles.previewText} role="alert">
                  Screen sharing isn&apos;t supported on this device or browser.
                </span>
              )}
            </div>
          </div>

          {screenShareSupported && (
          <>
          <div className={styles.qualitySection}>
            <h3 className={styles.qualityTitle}>STREAM QUALITY</h3>

            <div className={styles.qualityRow}>
              <div className={styles.qualityField}>
                <label className={styles.fieldLabel} htmlFor="go-live-resolution">
                  Resolution
                </label>
                <select
                  id="go-live-resolution"
                  className={styles.select}
                  value={resolution}
                  onChange={(e) => setResolution(Number(e.target.value) as StreamQualitySettings['resolution'])}
                >
                  {RESOLUTION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.qualityField}>
                <label className={styles.fieldLabel} htmlFor="go-live-framerate">
                  Frame Rate
                </label>
                <select
                  id="go-live-framerate"
                  className={styles.select}
                  value={frameRate}
                  onChange={(e) => setFrameRate(Number(e.target.value) as StreamQualitySettings['frameRate'])}
                >
                  {FRAME_RATE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <label className={styles.audioToggle}>
            <input
              type="checkbox"
              className={styles.audioCheckbox}
              checked={shareAudio}
              onChange={(e) => setShareAudio(e.target.checked)}
            />
            <span className={styles.audioLabel}>Share audio</span>
          </label>
          </>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.goLiveBtn}
            onClick={() => void handleGoLive()}
            disabled={!screenShareSupported}
            style={!screenShareSupported ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            Go Live
          </button>
        </div>
      </div>
    </div>
  );
};
