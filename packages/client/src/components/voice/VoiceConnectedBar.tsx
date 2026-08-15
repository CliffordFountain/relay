import { useCallback, useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { leaveVoice, toggleScreenShare, toggleVideo, setUserStreaming } from '../../stores/voiceSlice';
import { selectChannel } from '../../stores/channelsSlice';
import { useMediaStreams, useStreamChangeListener, getMediaState } from '../../hooks/useMediaStreams';
import { useVoiceActivityDetection } from '../../hooks/useVoiceActivityDetection';
import { usePushToTalk } from '../../hooks/usePushToTalk';
import { gateway } from '../../api/gateway';
import {
  playLeaveSound,
  playScreenShareStopSound,
} from '../../utils/sounds';
import { GoLiveModal } from './GoLiveModal';
import styles from './voiceConnectedBar.module.scss';

export const VoiceConnectedBar = () => {
  const dispatch = useAppDispatch();
  const { channelId, guildId, connected, selfScreenShare, selfVideo } = useAppSelector(s => s.voice);
  const channel = useAppSelector(s => channelId ? s.channels.channels[channelId] : null);
  const currentUserId = useAppSelector(s => s.auth.user?.id);

  // Voice activity detection - analyzes audio stream and dispatches speaking state
  // Only active when in voice activity mode (skips when PTT is active)
  useVoiceActivityDetection();

  // Push-to-talk - listens for configured keybind, toggles audio track
  // Only active when in push-to-talk mode
  usePushToTalk();

  const [showGoLiveModal, setShowGoLiveModal] = useState(false);

  const {
    stopAllStreams,
    stopScreenShare,
    startVideo,
    stopVideo,
    startAudio,
  } = useMediaStreams();

  // Force re-render on stream changes
  const [, setStreamTick] = useState(0);
  const handleStreamChange = useCallback(() => {
    setStreamTick(t => t + 1);
  }, []);
  useStreamChangeListener(handleStreamChange);

  // Capture the microphone as soon as we join voice, so audio is actually produced
  // to the SFU and voice-activity detection has a stream to analyze. Without this the
  // mic only started on a manual mute→unmute toggle, so a normal join had no audio at
  // all (nothing transmitted, nothing detected). Mute state is applied to the track
  // separately (useMediaStreams' selfMute effect / push-to-talk), so this is safe even
  // when joining muted or in push-to-talk mode.
  useEffect(() => {
    if (connected && !getMediaState().audioStream) {
      void startAudio();
    }
  }, [connected, startAudio]);

  if (!connected) return null;

  const handleDisconnect = () => {
    playLeaveSound();
    if (guildId) {
      gateway.sendVoiceStateUpdate(guildId, null);
    }
    stopAllStreams();
    dispatch(leaveVoice());
  };

  const handleInfoClick = () => {
    if (channelId) {
      dispatch(selectChannel(channelId));
    }
  };

  const handleToggleVideo = async () => {
    if (selfVideo) {
      stopVideo();
      dispatch(toggleVideo());
    } else {
      dispatch(toggleVideo());
      await startVideo();
    }
  };

  const handleToggleScreenShare = () => {
    if (selfScreenShare) {
      playScreenShareStopSound();
      stopScreenShare();
      dispatch(toggleScreenShare());
      if (currentUserId && channelId) {
        dispatch(setUserStreaming({ channelId, userId: currentUserId, streaming: false }));
      }
    } else {
      setShowGoLiveModal(true);
    }
  };

  return (
    <div className={styles.bar} aria-label="Voice Connected">
      <div className={styles.info} onClick={handleInfoClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') handleInfoClick(); }}>
        <div className={styles.statusRow}>
          {/* Signal icon */}
          <svg className={styles.signalIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3a1 1 0 0 0-1 1v16a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1ZM6 9a1 1 0 0 0-1 1v10a1 1 0 1 0 2 0V10a1 1 0 0 0-1-1ZM18 9a1 1 0 0 0-1 1v10a1 1 0 1 0 2 0V10a1 1 0 0 0-1-1ZM3 14a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0v-5a1 1 0 0 0-1-1ZM21 14a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0v-5a1 1 0 0 0-1-1Z" fill="currentColor" />
          </svg>
          <span className={styles.statusText}>Voice Connected</span>
          {selfScreenShare && (
            <span className={styles.liveIndicator}>LIVE</span>
          )}
        </div>
        <div className={styles.channelName}>
          {channel?.name || 'Unknown Channel'}
        </div>
      </div>
      <div className={styles.controls}>
        {/* Camera button */}
        <button
          className={`${styles.controlBtn} ${selfVideo ? styles.controlBtnScreenActive : ''}`}
          onClick={() => void handleToggleVideo()}
          title={selfVideo ? 'Turn Off Camera' : 'Turn On Camera'}
          aria-label={selfVideo ? 'Turn Off Camera' : 'Turn On Camera'}
          type="button"
        >
          {selfVideo ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.526 8.149C21.231 7.966 20.862 7.951 20.553 8.105L18 9.382V7C18 5.897 17.103 5 16 5H4C2.897 5 2 5.897 2 7V17C2 18.103 2.897 19 4 19H16C17.103 19 18 18.103 18 17V14.618L20.553 15.895C20.694 15.965 20.847 16 21 16C21.183 16 21.365 15.949 21.526 15.851C21.82 15.668 22 15.347 22 15V9C22 8.653 21.82 8.332 21.526 8.149Z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.526 8.149C21.231 7.966 20.862 7.951 20.553 8.105L18 9.382V7C18 5.897 17.103 5 16 5H4C2.897 5 2 5.897 2 7V17C2 18.103 2.897 19 4 19H16C17.103 19 18 18.103 18 17V14.618L20.553 15.895C20.694 15.965 20.847 16 21 16C21.183 16 21.365 15.949 21.526 15.851C21.82 15.668 22 15.347 22 15V9C22 8.653 21.82 8.332 21.526 8.149ZM16 17H4V7H16V17Z" />
            </svg>
          )}
        </button>

        {/* Screen Share button */}
        <button
          className={`${styles.controlBtn} ${selfScreenShare ? styles.controlBtnScreenActive : ''}`}
          onClick={handleToggleScreenShare}
          title={selfScreenShare ? 'Stop Sharing' : 'Share Your Screen'}
          aria-label={selfScreenShare ? 'Stop Sharing' : 'Share Your Screen'}
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H16V21.5H8V19.5H11V17.5H4C2.897 17.5 2 16.604 2 15.5V4.5ZM13.2 14.342V11.342L18.5 11.342V8.5L23.5 12.5L18.5 16.5V13.658L13.2 14.342V14.342ZM4 4.5V15.5H20V4.5H4Z" />
          </svg>
        </button>

        {/* Disconnect button */}
        <button
          className={`${styles.controlBtn} ${styles.disconnectBtn}`}
          onClick={handleDisconnect}
          title="Disconnect"
          aria-label="Disconnect"
          type="button"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21.1169 1.11603L22.8839 2.88403L19.7679 6.00003L22.3549 8.58603C22.7739 9.00603 22.7739 9.68103 22.3549 10.1L18.1169 14.338C17.6979 14.757 17.0229 14.757 16.6029 14.338L14.0169 11.751L11.8999 13.868L14.4869 16.454C14.9059 16.874 14.9059 17.549 14.4869 17.968L10.2489 22.206C9.82891 22.625 9.15491 22.625 8.73491 22.206L6.14891 19.62L2.88391 22.884L1.11591 21.116L21.1169 1.11603ZM7.56891 5.43303L10.1549 8.01903C10.5739 8.43803 10.5739 9.11303 10.1549 9.53303L5.91691 13.77C5.49791 14.19 4.82291 14.19 4.40291 13.77L1.81691 11.184C1.39791 10.765 1.39791 10.09 1.81691 9.67003L6.05491 5.43303C6.47391 5.01303 7.14891 5.01303 7.56891 5.43303Z" />
          </svg>
        </button>
      </div>
      {showGoLiveModal && (
        <GoLiveModal onClose={() => setShowGoLiveModal(false)} />
      )}
    </div>
  );
};
