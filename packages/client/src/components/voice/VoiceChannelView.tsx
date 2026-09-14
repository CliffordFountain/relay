import { useRef, useEffect, useCallback, useState } from 'react';

const EMPTY_ARRAY: never[] = [];
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  leaveVoice,
  toggleMute,
  toggleDeaf,
  toggleVideo,
  toggleScreenShare,
  setUserStreaming,
} from '../../stores/voiceSlice';
import { setMessages, setHasMore, prependMessages, setLoadingMore } from '../../stores/messagesSlice';
import { useMediaStreams, useStreamChangeListener, getMediaState } from '../../hooks/useMediaStreams';
import { gateway } from '../../api/gateway';
import { api } from '../../api/rest';
import {
  playMuteSound,
  playUnmuteSound,
  playDeafenSound,
  playUndeafenSound,
  playLeaveSound,
  playScreenShareStopSound,
} from '../../utils/sounds';
import { GoLiveModal } from './GoLiveModal';
import { useRemoteMedia } from '../../voice/remoteMedia';
import { RemoteVideo, RemoteAudio } from './MediaSink';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { TypingIndicator } from '../chat/TypingIndicator';
import styles from './voiceChannelView.module.scss';

export type ViewMode = 'grid' | 'focus';

/** One selectable screen-share on the stage — our own or a remote peer's. */
interface ScreenSource {
  userId: string;
  /** Display name for the switcher / footer. 'You' for the local share. */
  name: string;
  isLocal: boolean;
  screen: MediaStream;
  /** The presenter's camera, shown as a PiP over their share (null when off). */
  camera: MediaStream | null;
}

export interface VoiceChannelViewProps {
  channelId: string;
  channelName: string;
}

export const VoiceChannelView = ({ channelId, channelName }: VoiceChannelViewProps) => {
  const dispatch = useAppDispatch();
  const voiceState = useAppSelector(s => s.voice);
  const voiceUsers = useAppSelector(s => s.voice.voiceUsersByChannel[channelId] ?? EMPTY_ARRAY);
  const speakingUsers = useAppSelector(s => s.voice.speakingUsers);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const serverName = useAppSelector(s => {
    const gid = s.voice.guildId;
    return gid ? s.guilds.guilds[gid]?.name : undefined;
  });
  const messages = useAppSelector(s => s.messages.messagesByChannel[channelId] ?? EMPTY_ARRAY);
  const hasMore = useAppSelector(s => s.messages.hasMoreByChannel[channelId] ?? true);
  const isLoadingMore = useAppSelector(s => s.messages.loadingMoreByChannel[channelId] ?? false);

  const isConnectedHere = voiceState.connected && voiceState.channelId === channelId;

  const [showGoLiveModal, setShowGoLiveModal] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  // Focused screen-share view controls (issue #1)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamMinimized, setStreamMinimized] = useState(false);
  // Remote media consumed from the SFU (other users' camera/screen/audio).
  const remotePeers = useRemoteMedia();
  // Which screen-share is on the big stage. Holds a userId (yours OR a remote peer's);
  // null means "auto-pick the first available share". A viewer can switch freely, so
  // starting your own share never traps you on it.
  const [stageUserId, setStageUserId] = useState<string | null>(null);
  // Locally mute a stream's audio (independent of deafen), remembered PER presenter so
  // muting one share never carries over to another when you switch the stage.
  const [mutedStreamUserIds, setMutedStreamUserIds] = useState<Set<string>>(() => new Set());

  const {
    startAudio,
    startVideo,
    stopVideo,
    stopScreenShare,
    stopAllStreams,
  } = useMediaStreams();

  // Focused screen-share container, used only for the Fullscreen API (a plain <div>).
  // All <video> elements attach their stream through <RemoteVideo>, which re-attaches
  // on mount — so a stage switch between shares never leaves a black element.
  const focusedStreamRef = useRef<HTMLDivElement | null>(null);

  // Force re-render when streams change
  const [, setStreamTick] = useState(0);
  const handleStreamChange = useCallback(() => {
    setStreamTick(t => t + 1);
  }, []);
  useStreamChangeListener(handleStreamChange);

  const media = getMediaState();

  // ── Stage: every available screen-share — our OWN plus each remote streamer's — is
  // collected into one switchable list. The viewer picks which is on the big stage via
  // `stageUserId`, so sharing your own screen no longer hijacks the stage and you can
  // switch to watch anyone who is streaming. Remote media comes from the SFU. ──
  const localScreenStream =
    isConnectedHere && voiceState.selfScreenShare ? media.screenStream : null;

  const screenSources: ScreenSource[] = [];
  if (localScreenStream && currentUserId) {
    screenSources.push({
      userId: currentUserId,
      name: 'You',
      isLocal: true,
      screen: localScreenStream,
      camera: voiceState.selfVideo && media.videoStream ? media.videoStream : null,
    });
  }
  for (const p of remotePeers) {
    if (!p.screen) continue;
    const u = voiceUsers.find(v => v.userId === p.userId);
    screenSources.push({
      userId: p.userId,
      name: u?.username ?? 'Streamer',
      isLocal: false,
      screen: p.screen,
      camera: p.camera ?? null,
    });
  }

  // Active source = the viewer's explicit pick while it is still live, otherwise the
  // first available share (so an already-running stream appears on join with no click,
  // and the stage falls back automatically when the watched share ends).
  const activeSource =
    screenSources.find(s => s.userId === stageUserId) ?? screenSources[0] ?? null;
  const showLocalScreen = activeSource?.isLocal ?? false;
  const stageStream: MediaStream | null = activeSource?.screen ?? null;
  const stagePresenterId = activeSource?.userId;
  const stagePresenter = voiceUsers.find(u => u.userId === stagePresenterId);
  const stagePresenterName = activeSource?.name ?? 'Streamer';
  const stageCameraStream: MediaStream | null = activeSource?.camera ?? null;
  const stageCameraOn = Boolean(stageCameraStream);
  // Whether the share currently on the stage is muted for this viewer.
  const stageStreamMuted = stagePresenterId ? mutedStreamUserIds.has(stagePresenterId) : false;

  // Keep exactly one valid share pinned on the stage. A live explicit pick is KEPT when
  // the set of shares changes — so starting your own share never yanks the stage off
  // someone you were already watching (you switch deliberately via the switcher). When
  // the pick goes away (that streamer stopped/left), fall back to the first available.
  // Keyed on the source-id SET (a string), so this runs only when shares appear/disappear,
  // not on every render and not when the user clicks to switch.
  const sourceIds = screenSources.map(s => s.userId);
  const sourceIdsKey = sourceIds.join(',');
  useEffect(() => {
    setStageUserId(prev => (prev && sourceIds.includes(prev) ? prev : (sourceIds[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIdsKey]);

  // Keep the local fullscreen flag in sync with the browser's fullscreen state (issue #1)
  useEffect(() => {
    const handleFsChange = () => {
      const d = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement ?? d.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // Propagate our local camera / screen-share status to the gateway so other members in
  // the channel see our "LIVE"/streaming state. Screen-share START is triggered from the
  // GoLiveModal (which only flips the redux flag), so we watch the flags here to cover
  // both start and stop from one place. The initial mount is skipped: joining the channel
  // already sent our initial voice state, and we don't want to re-send just for mounting.
  const streamSyncMounted = useRef(false);
  useEffect(() => {
    if (!streamSyncMounted.current) {
      streamSyncMounted.current = true;
      return;
    }
    if (!isConnectedHere || !voiceState.guildId) return;
    gateway.sendVoiceStateUpdate(
      voiceState.guildId,
      channelId,
      voiceState.selfMute,
      voiceState.selfDeaf,
      voiceState.selfVideo,
      voiceState.selfScreenShare,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState.selfVideo, voiceState.selfScreenShare]);

  // Load messages for text-in-voice when chat is opened
  useEffect(() => {
    if (chatOpen && !chatLoaded) {
      api.getMessages(channelId, { limit: 50 }).then(msgs => {
        const reversed = [...msgs].reverse();
        dispatch(setMessages({ channelId, messages: reversed }));
        dispatch(setHasMore({ channelId, hasMore: msgs.length >= 50 }));
        setChatLoaded(true);
      }).catch(() => {
        dispatch(setMessages({ channelId, messages: [] }));
        setChatLoaded(true);
      });
    }
  }, [chatOpen, chatLoaded, channelId, dispatch]);

  const handleDisconnect = () => {
    playLeaveSound();
    if (voiceState.guildId) {
      gateway.sendVoiceStateUpdate(voiceState.guildId, null);
    }
    stopAllStreams();
    dispatch(leaveVoice());
  };

  const handleToggleMute = async () => {
    if (voiceState.selfMute) {
      playUnmuteSound();
      dispatch(toggleMute());
    } else {
      playMuteSound();
      dispatch(toggleMute());
    }
    // Start audio capture on first unmute if not already capturing
    if (voiceState.selfMute && !media.audioStream) {
      await startAudio();
    }
  };

  const handleToggleVideo = async () => {
    if (voiceState.selfVideo) {
      stopVideo();
      dispatch(toggleVideo());
    } else {
      dispatch(toggleVideo());
      await startVideo();
    }
  };

  const handleToggleScreenShare = () => {
    if (voiceState.selfScreenShare) {
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

  // Toggle the Fullscreen API on the focused screen-share tile, with a webkit fallback (issue #1)
  const handleToggleFullscreen = useCallback(() => {
    const d = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    const active = document.fullscreenElement ?? d.webkitFullscreenElement;
    if (active) {
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      } else if (d.webkitExitFullscreen) {
        d.webkitExitFullscreen();
      }
      return;
    }
    const el = focusedStreamRef.current as
      | (HTMLElement & { webkitRequestFullscreen?: () => void })
      | null;
    if (!el) return;
    if (el.requestFullscreen) {
      void el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  }, []);

  // Collapse the focused stream into a small floating PiP so the rest of the UI is usable (issue #1)
  const handleToggleMinimize = useCallback(() => {
    setStreamMinimized(prev => !prev);
  }, []);

  const handleUserTileClick = (userId: string) => {
    if (viewMode === 'grid') {
      // Switch to focus mode with this user focused
      setViewMode('focus');
      setFocusedUserId(userId);
    } else if (focusedUserId === userId) {
      // Clicking the focused user unfocuses (back to grid)
      setViewMode('grid');
      setFocusedUserId(null);
    } else {
      // Click a different user in focus mode to focus them instead
      setFocusedUserId(userId);
    }
  };

  const handleViewModeToggle = () => {
    if (viewMode === 'grid') {
      setViewMode('focus');
      // Focus the first user if none focused
      const firstUser = voiceUsers[0];
      if (!focusedUserId && firstUser) {
        setFocusedUserId(firstUser.userId);
      }
    } else {
      setViewMode('grid');
      setFocusedUserId(null);
    }
  };

  const handleToggleChat = () => {
    setChatOpen(prev => !prev);
  };

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    const currentMessages = messages;
    if (currentMessages.length === 0) return;
    const oldestMessage = currentMessages[0];
    if (!oldestMessage) return;

    dispatch(setLoadingMore({ channelId, loading: true }));
    api.getMessages(channelId, { before: oldestMessage.id, limit: 50 }).then(msgs => {
      const reversed = [...msgs].reverse();
      dispatch(prependMessages({ channelId, messages: reversed }));
      dispatch(setHasMore({ channelId, hasMore: msgs.length >= 50 }));
      dispatch(setLoadingMore({ channelId, loading: false }));
    }).catch(() => {
      dispatch(setLoadingMore({ channelId, loading: false }));
    });
  }, [channelId, dispatch, hasMore, isLoadingMore, messages]);

  // Determine focused and non-focused users for focus mode
  const focusedUser = viewMode === 'focus' ? voiceUsers.find(u => u.userId === focusedUserId) : null;
  const nonFocusedUsers = viewMode === 'focus' ? voiceUsers.filter(u => u.userId !== focusedUserId) : [];

  const renderUserTile = (user: typeof voiceUsers[0], isFocused: boolean = false) => {
    const isSpeaking = speakingUsers.includes(user.userId);
    const isSelf = user.userId === currentUserId;
    // Local camera comes from our own capture; remote camera comes from the SFU
    // consumer stored in remotePeers. A tile shows live video only while a stream
    // is actually present, so turning the camera off unmounts the <video> cleanly.
    const remotePeer = isSelf ? undefined : remotePeers.find(p => p.userId === user.userId);
    // De-dup: while this user's camera is already shown as the PiP over their share on
    // the stage, don't render a second live copy of it down in the tile grid — show
    // their avatar there instead (issue: camera appeared both over the feed AND below).
    const cameraInStagePip = stageCameraOn && user.userId === stagePresenterId;
    const cameraStream = isSelf ? media.videoStream : remotePeer?.camera;
    const cameraOn = !cameraInStagePip && (isSelf
      ? Boolean(voiceState.selfVideo && media.videoStream)
      : Boolean(remotePeer?.camera));
    const isUserStreaming = isSelf
      ? voiceState.selfScreenShare
      : (user.streaming || Boolean(remotePeer?.screen));
    const tileSizeClass = isFocused ? styles.userTileFocused : '';
    // Optional role tag (e.g. IGL) — rendered only when the participant carries a role.
    const role = (user as { role?: string }).role;

    return (
      <div
        key={user.userId}
        className={`${styles.userTile} ${isSpeaking ? styles.userTileSpeaking : ''} ${isUserStreaming ? styles.userTileStreaming : ''} ${tileSizeClass}`}
        aria-label={`${user.username}${isSelf ? ' (You)' : ''}${isUserStreaming ? ' - Live' : ''}`}
        onClick={() => handleUserTileClick(user.userId)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleUserTileClick(user.userId); }}
      >
        <div className={styles.tileMedia}>
          {cameraOn ? (
            <RemoteVideo stream={cameraStream} className={styles.tileVideo} />
          ) : user.avatar ? (
            <img src={user.avatar} alt={user.username} className={styles.tileImg} />
          ) : (
            <div className={styles.tileMonogram}>
              {user.username.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Top-right status badges */}
        <div className={styles.tileBadges}>
          {isUserStreaming && (
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} />
              LIVE
            </span>
          )}
          {user.selfMute && (
            <span className={styles.mutedBadge}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-label="Muted">
                <path d="M6.7 11H5C5 12.19 5.34 13.3 5.9 14.28L7.13 13.05C6.86 12.43 6.7 11.74 6.7 11Z" />
                <path d="M9.01 11.085C9.015 11.1125 9.02 11.14 9.02 11.17L15 5.18V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 11.03 9.005 11.0575 9.01 11.085Z" />
                <path d="M11.7237 16.0927L10.9632 16.8531L10.2533 17.5688C10.8074 17.8436 11.3907 18.0372 12 18.1V22H14V18.1C17.41 17.6 20 14.41 20 11H18.3C18.3 14 15.76 16.1 13 16.1C12.5468 16.1 12.1145 16.0505 11.7237 16.0927Z" />
                <path d="M21 2.27L19.73 1L1 19.73L2.27 21L8.46 14.81L9.69 13.58L14.82 8.45L19 4.27L21 2.27Z" fillRule="evenodd" />
              </svg>
            </span>
          )}
          {user.selfDeaf && (
            <span className={styles.deafBadge}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-label="Deafened">
                <path d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z" />
                <path d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z" />
                <path d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z" />
              </svg>
            </span>
          )}
          {isSelf && voiceState.selfVideo && (
            <span className={styles.videoBadge}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-label="Camera On">
                <path d="M21.526 8.149C21.231 7.966 20.862 7.951 20.553 8.105L18 9.382V7C18 5.897 17.103 5 16 5H4C2.897 5 2 5.897 2 7V17C2 18.104 2.897 19 4 19H16C17.103 19 18 18.104 18 17V14.618L20.553 15.894C20.694 15.965 20.847 16 21 16C21.183 16 21.365 15.949 21.526 15.851C21.82 15.668 22 15.347 22 15V9C22 8.653 21.82 8.332 21.526 8.149Z" />
              </svg>
            </span>
          )}
        </div>

        {/* Bottom-left name / role pill */}
        <div className={styles.tilePill}>
          {role && <span className={styles.roleTag}>{role}</span>}
          <span className={styles.tileName}>
            {user.username}
            {isSelf && <span className={styles.youBadge}>You</span>}
          </span>
        </div>

        {/* Watch Stream overlay — only when they're streaming AND they're not already
            the share on the stage (otherwise it's redundant). */}
        {!isSelf && isUserStreaming && stagePresenterId !== user.userId && (
          <button
            className={styles.watchStreamBtn}
            type="button"
            aria-label={`Watch ${user.username}'s stream`}
            onClick={(e) => {
              e.stopPropagation();
              // Put this user's stream on the stage and un-collapse it.
              setStageUserId(user.userId);
              setStreamMinimized(false);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H16V21.5H8V19.5H11V17.5H4C2.897 17.5 2 16.604 2 15.5V4.5ZM4 4.5V15.5H20V4.5H4Z" />
            </svg>
            Watch Stream
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <svg className={styles.headerIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
          </svg>
          <div className={styles.headerTitles}>
            <span className={styles.headerName}>{channelName}</span>
            {serverName && <span className={styles.headerServer}>{serverName}</span>}
          </div>
        </div>
        <div className={styles.headerRight}>
          {/* Grid/Focus View Toggle */}
          {voiceUsers.length > 1 && (
            <button
              className={`${styles.headerBtn} ${viewMode === 'focus' ? styles.headerBtnActive : ''}`}
              onClick={handleViewModeToggle}
              title={viewMode === 'grid' ? 'Switch to Focus View' : 'Switch to Grid View'}
              aria-label={viewMode === 'grid' ? 'Switch to Focus View' : 'Switch to Grid View'}
              type="button"
            >
              {viewMode === 'grid' ? (
                /* Focus view icon - single large rectangle */
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3 3h18v14H3V3zm2 2v10h14V5H5zm-2 16h18v-2H3v2z" />
                </svg>
              ) : (
                /* Grid view icon - 4 small rectangles */
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h8v8h-8v-8zm2 2v4h4v-4h-4z" />
                </svg>
              )}
            </button>
          )}

          {/* Text Chat Toggle */}
          <button
            className={`${styles.headerBtn} ${chatOpen ? styles.headerBtnActive : ''}`}
            onClick={handleToggleChat}
            title={chatOpen ? 'Hide Chat' : 'Show Chat'}
            aria-label={chatOpen ? 'Hide Chat' : 'Show Chat'}
            data-testid="voice-chat-toggle"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stage: the active screen-share — our own OR a remote streamer we're watching */}
      {stageStream && (() => {
        const presenter = stagePresenter;
        const presenterName = stagePresenterName;
        const watching = Math.max(0, voiceUsers.length - 1);
        const presenterCameraOn = Boolean(stageCameraStream);
        return (
          <div
            ref={focusedStreamRef}
            className={`${styles.focusedStream} ${streamMinimized ? styles.focusedStreamMinimized : ''}`}
            data-testid="stream-stage"
          >
            <div className={styles.focusedStreamMedia}>
              <RemoteVideo
                stream={stageStream}
                className={styles.focusedStreamVideo}
                onClick={handleToggleFullscreen}
                title="Click to toggle fullscreen"
              />
              <span className={styles.focusedLiveBadge}>
                <span className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  LIVE
                </span>
              </span>

              {/* Source switcher — when more than one person is sharing, pick whose
                  screen is on the stage (including your own). This is what lets you
                  switch between two simultaneous streams. */}
              {screenSources.length > 1 && (
                <div
                  className={styles.stageSwitcher}
                  role="tablist"
                  aria-label="Choose which screen share to watch"
                  data-testid="stage-switcher"
                >
                  {screenSources.map(src => {
                    const active = src.userId === stagePresenterId;
                    return (
                      <button
                        key={src.userId}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`${styles.stageSwitcherChip} ${active ? styles.stageSwitcherChipActive : ''}`}
                        onClick={() => {
                          setStageUserId(src.userId);
                          setStreamMinimized(false);
                        }}
                      >
                        <span className={styles.liveDot} />
                        {src.isLocal ? 'Your screen' : src.name}
                      </button>
                    );
                  })}
                </div>
              )}

              <span className={styles.watchingChip}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                </svg>
                {watching} watching
              </span>

              {/* Presenter camera overlay (PiP) — shown when the presenter is also on
                  camera. This is the only place their camera renders while on stage; the
                  duplicate in the tile grid is suppressed (see cameraInStagePip). */}
              {presenterCameraOn && (
                <div className={styles.cameraPip} data-testid="presenter-camera-pip">
                  <RemoteVideo stream={stageCameraStream} className={styles.cameraPipVideo} />
                  <span className={styles.cameraPipLabel}>{presenterName}</span>
                </div>
              )}

              {/* Fullscreen / Minimize controls on the stream (issue #1) */}
              <div className={styles.focusedStreamControls}>
                {/* Mute-this-stream — only meaningful when watching someone else's stream. */}
                {!showLocalScreen && (
                  <button
                    type="button"
                    className={`${styles.focusedStreamCtrlBtn} ${stageStreamMuted ? styles.focusedStreamCtrlBtnActive : ''}`}
                    onClick={() => {
                      const id = stagePresenterId;
                      if (!id) return;
                      setMutedStreamUserIds(prev => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    title={stageStreamMuted ? 'Unmute stream' : 'Mute stream'}
                    aria-label={stageStreamMuted ? 'Unmute stream' : 'Mute stream'}
                  >
                    {stageStreamMuted ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M3.63 3.63a.996.996 0 0 0 0 1.41L7.29 8.7 7 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91v2.06a8.9 8.9 0 0 0 3.02-1.31l1.66 1.66a.996.996 0 1 0 1.41-1.41L5.05 3.63a.996.996 0 0 0-1.42 0ZM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53A8.9 8.9 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71Zm-7-8-1.88 1.88L12 7.76V4Zm4.5 8c0-1.77-1.02-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24Z" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M3 10v4a1 1 0 0 0 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71V6.41c0-.89-1.08-1.34-1.71-.71L7 9H4a1 1 0 0 0-1 1Zm13.5 2A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02ZM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77Z" />
                      </svg>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.focusedStreamCtrlBtn}
                  onClick={handleToggleFullscreen}
                  title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                  aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                >
                  {isFullscreen ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className={styles.focusedStreamCtrlBtn}
                  onClick={handleToggleMinimize}
                  title={streamMinimized ? 'Restore Stream' : 'Minimize Stream'}
                  aria-label={streamMinimized ? 'Restore Stream' : 'Minimize Stream'}
                >
                  {streamMinimized ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M5 5h14v14H5V5zm2 2v10h10V7H7z" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M19 13H5v-2h14v2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className={styles.presenterFooter}>
              <div className={styles.presenterAvatar}>
                {presenter?.avatar ? (
                  <img className={styles.presenterAvatarImg} src={presenter.avatar} alt={presenterName} />
                ) : (
                  <div className={styles.presenterAvatarFallback}>
                    {presenterName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className={styles.presenterInfo}>
                <span className={styles.presenterName}>{presenterName}</span>
                <span className={styles.presenterSub}>{showLocalScreen ? 'Sharing your screen' : 'Live'}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Remote audio sinks — other users' voices and screen-share audio. Hidden and
          routed to the selected output device; muted while the local user is deafened. */}
      {remotePeers.flatMap(peer =>
        peer.audios.map(audioStream => (
          <RemoteAudio
            key={audioStream.id}
            stream={audioStream}
            // Silenced when deafened, or when the viewer muted this presenter's share while
            // it is the one on the stage.
            muted={voiceState.selfDeaf || (peer.userId === stagePresenterId && mutedStreamUserIds.has(peer.userId))}
          />
        )),
      )}

      {/* Main content area: voice users + optional chat */}
      <div className={styles.mainArea}>
        {/* Voice users content area */}
        <div className={`${styles.content} ${chatOpen ? styles.contentWithChat : ''}`}>
          {voiceUsers.length === 0 && !isConnectedHere ? (
            <div className={styles.emptyState}>
              <svg className={styles.emptyIcon} width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
              </svg>
              <h3 className={styles.emptyTitle}>{channelName}</h3>
              <p className={styles.emptyText}>No one is currently in this voice channel.</p>
            </div>
          ) : viewMode === 'focus' && focusedUser ? (
            /* Focus view: one user large, others small at bottom */
            <div className={styles.focusLayout}>
              <div className={styles.focusMain}>
                {renderUserTile(focusedUser, true)}
              </div>
              {nonFocusedUsers.length > 0 && (
                <div className={styles.focusStrip}>
                  {nonFocusedUsers.map(user => renderUserTile(user, false))}
                </div>
              )}
            </div>
          ) : (
            /* Grid view: all user tiles same size */
            <div className={styles.userGrid}>
              {voiceUsers.length <= 1 && isConnectedHere && (
                <div className={styles.aloneMessage}>
                  <p className={styles.aloneText}>No one else is here.</p>
                </div>
              )}
              {voiceUsers.map(user => renderUserTile(user))}
            </div>
          )}
        </div>

        {/* Text-in-Voice Chat Panel */}
        {chatOpen && (
          <div className={styles.chatPanel} data-testid="voice-chat-panel">
            <div className={styles.chatPanelHeader}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
              </svg>
              <span className={styles.chatPanelTitle}>Text Chat</span>
            </div>
            <div className={styles.chatMessages}>
              <MessageList
                messages={messages}
                channelId={channelId}
                onLoadMore={handleLoadMore}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
              />
            </div>
            <TypingIndicator channelId={channelId} />
            <MessageInput channelId={channelId} />
          </div>
        )}
      </div>

      {/* Go Live Modal */}
      {showGoLiveModal && (
        <GoLiveModal onClose={() => setShowGoLiveModal(false)} />
      )}

      {/* Floating control cluster at bottom */}
      {isConnectedHere && (
        <div className={styles.controlBar}>
          <div className={styles.controlCluster} role="toolbar" aria-label="Voice controls">
            {/* Mute */}
            <button
              className={`${styles.controlBtn} ${voiceState.selfMute ? styles.controlBtnActive : ''}`}
              onClick={handleToggleMute}
              title={voiceState.selfMute ? 'Unmute' : 'Mute'}
              aria-label={voiceState.selfMute ? 'Unmute' : 'Mute'}
              type="button"
            >
              {voiceState.selfMute ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6.7 11H5C5 12.19 5.34 13.3 5.9 14.28L7.13 13.05C6.86 12.43 6.7 11.74 6.7 11Z" />
                  <path d="M9.01 11.085C9.015 11.1125 9.02 11.14 9.02 11.17L15 5.18V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 11.03 9.005 11.0575 9.01 11.085Z" />
                  <path d="M11.7237 16.0927L10.9632 16.8531L10.2533 17.5688C10.8074 17.8436 11.3907 18.0372 12 18.1V22H14V18.1C17.41 17.6 20 14.41 20 11H18.3C18.3 14 15.76 16.1 13 16.1C12.5468 16.1 12.1145 16.0505 11.7237 16.0927Z" />
                  <path d="M21 2.27L19.73 1L1 19.73L2.27 21L8.46 14.81L9.69 13.58L14.82 8.45L19 4.27L21 2.27Z" fillRule="evenodd" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V21H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1Z" />
                </svg>
              )}
            </button>

            {/* Deafen */}
            <button
              className={`${styles.controlBtn} ${voiceState.selfDeaf ? styles.controlBtnActive : ''}`}
              onClick={() => {
                if (voiceState.selfDeaf) {
                  playUndeafenSound();
                } else {
                  playDeafenSound();
                }
                dispatch(toggleDeaf());
              }}
              title={voiceState.selfDeaf ? 'Undeafen' : 'Deafen'}
              aria-label={voiceState.selfDeaf ? 'Undeafen' : 'Deafen'}
              type="button"
            >
              {voiceState.selfDeaf ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z" />
                  <path d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z" />
                  <path d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2.00305C6.486 2.00305 2 6.48805 2 12.0031V20.0031C2 21.1071 2.895 22.0031 4 22.0031H6C7.104 22.0031 8 21.1071 8 20.0031V17.0031C8 15.8991 7.104 15.0031 6 15.0031H4V12.0031C4 7.59105 7.589 4.00305 12 4.00305C16.411 4.00305 20 7.59105 20 12.0031V15.0031H18C16.896 15.0031 16 15.8991 16 17.0031V20.0031C16 21.1071 16.896 22.0031 18 22.0031H20C21.105 22.0031 22 21.1071 22 20.0031V12.0031C22 6.48805 17.514 2.00305 12 2.00305Z" />
                </svg>
              )}
            </button>

            {/* Video */}
            <button
              className={`${styles.controlBtn} ${voiceState.selfVideo ? styles.controlBtnVideoActive : ''}`}
              onClick={handleToggleVideo}
              title={voiceState.selfVideo ? 'Turn Off Camera' : 'Turn On Camera'}
              aria-label={voiceState.selfVideo ? 'Turn Off Camera' : 'Turn On Camera'}
              type="button"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.526 8.149C21.231 7.966 20.862 7.951 20.553 8.105L18 9.382V7C18 5.897 17.103 5 16 5H4C2.897 5 2 5.897 2 7V17C2 18.104 2.897 19 4 19H16C17.103 19 18 18.104 18 17V14.618L20.553 15.894C20.694 15.965 20.847 16 21 16C21.183 16 21.365 15.949 21.526 15.851C21.82 15.668 22 15.347 22 15V9C22 8.653 21.82 8.332 21.526 8.149Z" />
              </svg>
            </button>

            {/* Screen Share / Sharing */}
            <button
              className={`${styles.controlBtn} ${voiceState.selfScreenShare ? styles.controlBtnSharing : ''}`}
              onClick={handleToggleScreenShare}
              title={voiceState.selfScreenShare ? 'Stop Sharing' : 'Share Your Screen'}
              aria-label={voiceState.selfScreenShare ? 'Stop Sharing' : 'Share Your Screen'}
              type="button"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H16V21.5H8V19.5H11V17.5H4C2.897 17.5 2 16.604 2 15.5V4.5ZM13.2 14.342V11.342L18.5 11.342V8.5L23.5 12.5L18.5 16.5V13.658L13.2 14.342V14.342ZM4 4.5V15.5H20V4.5H4Z" />
              </svg>
            </button>

            {/* Soundboard */}
            <button
              className={styles.controlBtn}
              title="Soundboard"
              aria-label="Soundboard"
              type="button"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3a9 9 0 0 0-9 9v4a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5.08A7 7 0 0 1 19 12v-.08H17a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-4a9 9 0 0 0-9-9Z" />
              </svg>
            </button>

            <span className={styles.controlDivider} aria-hidden="true" />

            {/* Leave */}
            <button
              className={`${styles.controlBtn} ${styles.controlBtnLeave}`}
              onClick={handleDisconnect}
              title="Disconnect"
              aria-label="Disconnect"
              type="button"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.1169 1.11603L22.8839 2.88403L19.7679 6.00003L22.3549 8.58603C22.7739 9.00603 22.7739 9.68103 22.3549 10.1L18.1169 14.338C17.6979 14.757 17.0229 14.757 16.6029 14.338L14.0169 11.751L11.8999 13.868L14.4869 16.454C14.9059 16.874 14.9059 17.549 14.4869 17.968L10.2489 22.206C9.82891 22.625 9.15491 22.625 8.73491 22.206L6.14891 19.62L2.88391 22.884L1.11591 21.116L21.1169 1.11603ZM7.56891 5.43303L10.1549 8.01903C10.5739 8.43803 10.5739 9.11303 10.1549 9.53303L5.91691 13.77C5.49791 14.19 4.82291 14.19 4.40291 13.77L1.81691 11.184C1.39791 10.765 1.39791 10.09 1.81691 9.67003L6.05491 5.43303C6.47391 5.01303 7.14891 5.01303 7.56891 5.43303Z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
