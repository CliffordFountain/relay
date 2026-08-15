import { useState, useCallback } from 'react';

const EMPTY_ARRAY: never[] = [];
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  leaveVoice,
  toggleMute,
  toggleDeaf,
} from '../../stores/voiceSlice';
import {
  setStageInstance,
  removeStageInstance,
  requestToSpeak,
  cancelRequestToSpeak,
  updateParticipantRole,
  addStageParticipant,
} from '../../stores/stageInstancesSlice';
import type { StageParticipant } from '../../stores/stageInstancesSlice';
import { gateway } from '../../api/gateway';
import { api } from '../../api/rest';
import { playLeaveSound } from '../../utils/sounds';
import styles from './stageView.module.scss';

export interface StageViewProps {
  channelId: string;
  channelName: string;
}

// ─── Start Stage Modal ───

interface StartStageModalProps {
  channelId: string;
  onClose: () => void;
  onStart: (topic: string) => void;
}

const StartStageModal = ({ channelId: _channelId, onClose, onStart }: StartStageModalProps) => {
  const [topic, setTopic] = useState('');

  const handleSubmit = () => {
    if (topic.trim()) {
      onStart(topic.trim());
    }
  };

  return (
    <div
      className={styles.startStageOverlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label="Start Stage"
      aria-modal="true"
    >
      <div className={styles.startStageModal}>
        <h2 className={styles.startStageModalTitle}>Start Stage</h2>
        <label className={styles.startStageModalLabel} htmlFor="stage-topic-input">
          Stage Topic
        </label>
        <input
          id="stage-topic-input"
          className={styles.startStageModalInput}
          type="text"
          placeholder="What is this stage about?"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          maxLength={120}
          autoFocus
        />
        <div className={styles.startStageModalFooter}>
          <button
            className={styles.startStageModalCancel}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.startStageModalConfirm}
            onClick={handleSubmit}
            disabled={!topic.trim()}
            type="button"
          >
            Start Stage
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Speaker Tile ───

interface SpeakerTileProps {
  participant: StageParticipant;
  isSpeaking: boolean;
  isSelf: boolean;
  isModerator: boolean;
  onInviteToAudience?: () => void;
}

const SpeakerTile = ({ participant, isSpeaking, isSelf, isModerator, onInviteToAudience }: SpeakerTileProps) => {
  return (
    <div
      className={`${styles.speakerTile} ${isSpeaking ? styles.speakerTileSpeaking : ''}`}
      role="listitem"
      aria-label={`Speaker: ${participant.username}${isSpeaking ? ', speaking' : ''}`}
    >
      <div className={`${styles.speakerAvatar} ${isSpeaking ? styles.speakerAvatarSpeaking : ''}`}>
        {participant.avatar ? (
          <img
            className={styles.speakerAvatarImg}
            src={participant.avatar}
            alt={participant.username}
          />
        ) : (
          <div className={styles.speakerAvatarFallback}>
            {participant.username.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <span className={styles.speakerName}>
        {participant.username}
        {isSelf && <span className={styles.speakerBadge}> (You)</span>}
      </span>
      {participant.isModerator && (
        <span className={styles.roleTag}>Moderator</span>
      )}
      {isModerator && !isSelf && (
        <div className={styles.modActions}>
          <button
            className={styles.modAction}
            onClick={onInviteToAudience}
            type="button"
            aria-label={`Move ${participant.username} to audience`}
          >
            Move to Audience
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Audience Item ───

interface AudienceItemProps {
  participant: StageParticipant;
  isModerator: boolean;
  onInviteToSpeak?: () => void;
}

const AudienceItem = ({ participant, isModerator, onInviteToSpeak }: AudienceItemProps) => {
  return (
    <div className={styles.audienceItem} role="listitem" aria-label={`Audience: ${participant.username}`}>
      {participant.avatar ? (
        <img
          className={styles.audienceAvatar}
          src={participant.avatar}
          alt={participant.username}
        />
      ) : (
        <div className={styles.audienceAvatarFallback}>
          {participant.username.charAt(0).toUpperCase()}
        </div>
      )}
      <span className={styles.audienceName}>{participant.username}</span>
      {participant.requestingToSpeak && (
        <svg className={styles.handRaiseIcon} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-label="Requesting to speak">
          <path d="M18.5 3C18.5 2.17 17.83 1.5 17 1.5S15.5 2.17 15.5 3V11H14.5V1.5C14.5 0.67 13.83 0 13 0S11.5 0.67 11.5 1.5V11H10.5V2C10.5 1.17 9.83 0.5 9 0.5S7.5 1.17 7.5 2V11H6.5V4.5C6.5 3.67 5.83 3 5 3S3.5 3.67 3.5 4.5V15C3.5 19.14 6.86 22.5 11 22.5C15.14 22.5 18.5 19.14 18.5 15V3Z" />
        </svg>
      )}
      {isModerator && participant.requestingToSpeak && (
        <button
          className={styles.modAction}
          onClick={onInviteToSpeak}
          type="button"
          aria-label={`Invite ${participant.username} to speak`}
        >
          Invite to Speak
        </button>
      )}
    </div>
  );
};

// ─── Main Component ───

export const StageView = ({ channelId, channelName }: StageViewProps) => {
  const dispatch = useAppDispatch();
  const voiceState = useAppSelector(s => s.voice);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const serverName = useAppSelector(s => {
    const gid = s.guilds.selectedGuildId;
    return gid ? s.guilds.guilds[gid]?.name : undefined;
  });
  const speakingUsers = useAppSelector(s => s.voice.speakingUsers);
  const stageInstanceId = useAppSelector(s => s.stageInstances.instanceByChannel[channelId]);
  const stageInstance = useAppSelector(s => stageInstanceId ? s.stageInstances.instances[stageInstanceId] : null);
  const participants = useAppSelector(s => s.stageInstances.participantsByChannel[channelId] ?? EMPTY_ARRAY);

  const isConnected = voiceState.connected && voiceState.channelId === channelId;
  const [showStartModal, setShowStartModal] = useState(false);

  const speakers = participants.filter(p => p.isSpeaker);
  const audience = participants.filter(p => !p.isSpeaker);
  const currentParticipant = participants.find(p => p.userId === currentUserId);
  const isModerator = currentParticipant?.isModerator ?? false;
  const isSpeaker = currentParticipant?.isSpeaker ?? false;
  const isRequestingToSpeak = currentParticipant?.requestingToSpeak ?? false;

  const handleDisconnect = useCallback(() => {
    playLeaveSound();
    if (selectedGuildId) {
      gateway.sendVoiceStateUpdate(selectedGuildId, null);
    }
    dispatch(leaveVoice());
  }, [dispatch, selectedGuildId]);

  const handleToggleMute = useCallback(() => {
    dispatch(toggleMute());
  }, [dispatch]);

  const handleToggleDeaf = useCallback(() => {
    dispatch(toggleDeaf());
  }, [dispatch]);

  const handleStartStage = useCallback((topic: string) => {
    setShowStartModal(false);
    api.createStageInstance({ channel_id: channelId, topic, privacy_level: 2 }).then(instance => {
      dispatch(setStageInstance(instance));
      // Add self as speaker/moderator
      if (currentUserId) {
        const currentUser = {
          userId: currentUserId,
          username: '',
          avatar: null,
          isSpeaker: true,
          isModerator: true,
          requestingToSpeak: false,
          suppress: false,
        };
        dispatch(addStageParticipant({ channelId, participant: currentUser }));
      }
    }).catch(() => {
      // Handle error silently
    });
  }, [channelId, currentUserId, dispatch]);

  const handleEndStage = useCallback(() => {
    api.deleteStageInstance(channelId).then(() => {
      if (stageInstanceId) {
        dispatch(removeStageInstance({ id: stageInstanceId, channelId }));
      }
    }).catch(() => {
      // Handle error silently
    });
  }, [channelId, stageInstanceId, dispatch]);

  const handleRequestToSpeak = useCallback(() => {
    if (!selectedGuildId || !currentUserId) return;
    if (isRequestingToSpeak) {
      // Cancel request
      api.updateVoiceState(selectedGuildId, {
        channel_id: channelId,
        suppress: true,
        request_to_speak_timestamp: null,
      }).then(() => {
        dispatch(cancelRequestToSpeak({ channelId, userId: currentUserId }));
      }).catch(() => {
        // Handle error silently
      });
    } else {
      // Request to speak
      api.updateVoiceState(selectedGuildId, {
        channel_id: channelId,
        suppress: false,
        request_to_speak_timestamp: new Date().toISOString(),
      }).then(() => {
        dispatch(requestToSpeak({ channelId, userId: currentUserId }));
      }).catch(() => {
        // Handle error silently
      });
    }
  }, [selectedGuildId, channelId, currentUserId, isRequestingToSpeak, dispatch]);

  const handleInviteToSpeak = useCallback((userId: string) => {
    dispatch(updateParticipantRole({
      channelId,
      userId,
      isSpeaker: true,
      suppress: false,
    }));
  }, [channelId, dispatch]);

  const handleMoveToAudience = useCallback((userId: string) => {
    dispatch(updateParticipantRole({
      channelId,
      userId,
      isSpeaker: false,
      suppress: true,
    }));
  }, [channelId, dispatch]);

  return (
    <div className={styles.container} data-testid="stage-view">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <svg className={styles.headerIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19.61 18.25a1.08 1.08 0 0 1-.07-1.33 9 9 0 1 0-15.07 0c.26.42.25.97-.08 1.33l-.02.02c-.41.44-1.12.43-1.46-.07a11 11 0 1 1 18.17 0c-.33.5-1.04.51-1.45.07l-.02-.02Z" />
            <path d="M16.83 15.23c.2-.45.11-.98-.2-1.34a5.5 5.5 0 1 0-9.25 0 1.11 1.11 0 0 1-.21 1.34c-.41.39-1.07.34-1.39-.13a7.5 7.5 0 1 1 12.44 0c-.31.47-.97.52-1.39.13Z" />
            <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          </svg>
          <div className={styles.headerTitles}>
            <span className={styles.headerName}>{channelName}</span>
            {serverName && <span className={styles.headerServer}>{serverName}</span>}
          </div>
        </div>
        <div className={styles.headerRight}>
          {isModerator && stageInstance && (
            <button
              className={styles.headerBtn}
              onClick={handleEndStage}
              title="End Stage"
              type="button"
              aria-label="End Stage"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 3.27L19.73 2L2 19.73L3.27 21L21 3.27Z" />
                <path d="M15 11V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14C12.33 14 12.65 13.95 12.94 13.86L15 11V11Z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Stage topic banner (shown when stage is live) */}
      {stageInstance && (
        <div className={styles.topicBanner} data-testid="stage-topic-banner">
          <span className={styles.topicLiveBadge}>LIVE</span>
          <span className={styles.topicText}>{stageInstance.topic}</span>
          <span className={styles.topicParticipants}>
            {participants.length} participant{participants.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Main content */}
      {stageInstance ? (
        <div className={styles.mainContent}>
          {/* Speakers section */}
          <div className={styles.sectionHeader} role="heading" aria-level={2}>
            Speakers — {speakers.length}
          </div>
          <div className={styles.speakerGrid} role="list" aria-label="Stage speakers">
            {speakers.map(speaker => (
              <SpeakerTile
                key={speaker.userId}
                participant={speaker}
                isSpeaking={speakingUsers.includes(speaker.userId)}
                isSelf={speaker.userId === currentUserId}
                isModerator={isModerator}
                onInviteToAudience={() => handleMoveToAudience(speaker.userId)}
              />
            ))}
            {speakers.length === 0 && (
              <div className={styles.emptyText}>No speakers yet</div>
            )}
          </div>

          {/* Audience section */}
          <div className={styles.sectionHeader} role="heading" aria-level={2}>
            Audience — {audience.length}
          </div>
          <div className={styles.audienceList} role="list" aria-label="Stage audience">
            {audience.map(member => (
              <AudienceItem
                key={member.userId}
                participant={member}
                isModerator={isModerator}
                onInviteToSpeak={() => handleInviteToSpeak(member.userId)}
              />
            ))}
            {audience.length === 0 && (
              <div className={styles.emptyText}>No audience members</div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.emptyState} data-testid="stage-empty-state">
          <svg className={styles.emptyIcon} width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M19.61 18.25a1.08 1.08 0 0 1-.07-1.33 9 9 0 1 0-15.07 0c.26.42.25.97-.08 1.33l-.02.02c-.41.44-1.12.43-1.46-.07a11 11 0 1 1 18.17 0c-.33.5-1.04.51-1.45.07l-.02-.02Z" />
            <path d="M16.83 15.23c.2-.45.11-.98-.2-1.34a5.5 5.5 0 1 0-9.25 0 1.11 1.11 0 0 1-.21 1.34c-.41.39-1.07.34-1.39-.13a7.5 7.5 0 1 1 12.44 0c-.31.47-.97.52-1.39.13Z" />
            <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          </svg>
          <h3 className={styles.emptyTitle}>No Stage Event</h3>
          <p className={styles.emptyText}>There is no stage event currently running in this channel.</p>
          {isConnected && (
            <button
              className={styles.startStageBtn}
              onClick={() => setShowStartModal(true)}
              type="button"
              aria-label="Start a Stage"
            >
              Start a Stage
            </button>
          )}
        </div>
      )}

      {/* Floating control cluster */}
      {isConnected && (
        <div className={styles.controlBar}>
          <div className={styles.controlCluster} role="toolbar" aria-label="Stage controls">
            {/* Mute */}
            <button
              className={`${styles.controlBtn} ${voiceState.selfMute ? styles.controlBtnMuted : ''}`}
              onClick={handleToggleMute}
              type="button"
              title={voiceState.selfMute ? 'Unmute' : 'Mute'}
              aria-label={voiceState.selfMute ? 'Unmute' : 'Mute'}
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
                  <path d="M12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2Z" />
                  <path d="M12 16.1C15.76 16.1 18.3 14 18.3 11H20C20 14.41 17.41 17.6 14 18.1V22H10V18.1C6.59 17.6 4 14.41 4 11H5.7C5.7 14 8.24 16.1 12 16.1Z" />
                </svg>
              )}
            </button>

            {/* Deafen */}
            <button
              className={`${styles.controlBtn} ${voiceState.selfDeaf ? styles.controlBtnMuted : ''}`}
              onClick={handleToggleDeaf}
              type="button"
              title={voiceState.selfDeaf ? 'Undeafen' : 'Deafen'}
              aria-label={voiceState.selfDeaf ? 'Undeafen' : 'Deafen'}
            >
              {voiceState.selfDeaf ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6.16204 15.0065C6.10859 15.0022 6.05455 15 6 15H4V12C4 7.588 7.589 4 12 4C13.4809 4 14.8691 4.40439 16.0599 5.10859L17.5102 3.65835C15.9292 2.61064 14.0346 2 12 2C6.486 2 2 6.485 2 12V19.1685L6.16204 15.0065Z" />
                  <path d="M19.725 9.91686C19.9043 10.5813 20 11.2796 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 10.7075 21.7536 9.47149 21.3053 8.33658L19.725 9.91686Z" />
                  <path d="M3.20101 23.6243L1.7868 22.2101L21.5858 2.41113L23 3.82535L3.20101 23.6243Z" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.486 2 2 6.485 2 12V20C2 21.104 2.896 22 4 22H6C7.104 22 8 21.104 8 20V17C8 15.896 7.104 15 6 15H4V12C4 7.588 7.589 4 12 4C16.411 4 20 7.588 20 12V15H18C16.896 15 16 15.896 16 17V20C16 21.104 16.896 22 18 22H20C21.105 22 22 21.104 22 20V12C22 6.485 17.514 2 12 2Z" />
                </svg>
              )}
            </button>

            {/* Request to Speak (for audience members only) */}
            {!isSpeaker && stageInstance && (
              <button
                className={`${styles.controlBtn} ${isRequestingToSpeak ? styles.controlBtnActive : ''}`}
                onClick={handleRequestToSpeak}
                type="button"
                title={isRequestingToSpeak ? 'Lower Hand' : 'Raise Hand'}
                aria-label={isRequestingToSpeak ? 'Cancel request to speak' : 'Request to speak'}
                data-testid="request-to-speak-btn"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.5 3C18.5 2.17 17.83 1.5 17 1.5S15.5 2.17 15.5 3V11H14.5V1.5C14.5 0.67 13.83 0 13 0S11.5 0.67 11.5 1.5V11H10.5V2C10.5 1.17 9.83 0.5 9 0.5S7.5 1.17 7.5 2V11H6.5V4.5C6.5 3.67 5.83 3 5 3S3.5 3.67 3.5 4.5V15C3.5 19.14 6.86 22.5 11 22.5C15.14 22.5 18.5 19.14 18.5 15V3Z" />
                </svg>
              </button>
            )}

            <span className={styles.controlDivider} aria-hidden="true" />

            {/* Disconnect */}
            <button
              className={`${styles.controlBtn} ${styles.controlBtnLeave}`}
              onClick={handleDisconnect}
              type="button"
              title="Disconnect"
              aria-label="Disconnect"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.1169 1.11603L22.8839 2.88403L19.7679 6.00003L22.8839 9.11603L21.1169 10.884L17.9999 7.76803L14.8839 10.884L13.1169 9.11603L16.2329 6.00003L13.1169 2.88403L14.8839 1.11603L17.9999 4.23203L21.1169 1.11603ZM18 22H13C6.925 22 2 17.075 2 11V6C2 5.447 2.447 5 3 5H7C7.553 5 8 5.447 8 6V10C8 10.553 7.553 11 7 11H5.07C5.555 14.955 8.795 18.07 12.75 18.405V16C12.75 15.447 13.197 15 13.75 15H17.75C18.303 15 18.75 15.447 18.75 16V21.25C18.75 21.803 18.303 22.25 17.75 22.25L18 22Z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Start Stage modal */}
      {showStartModal && (
        <StartStageModal
          channelId={channelId}
          onClose={() => setShowStartModal(false)}
          onStart={handleStartStage}
        />
      )}
    </div>
  );
};
