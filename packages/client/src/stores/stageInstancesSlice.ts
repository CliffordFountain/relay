import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface StageInstance {
  id: string;
  guild_id: string;
  channel_id: string;
  topic: string;
  privacy_level: number; // 1 = PUBLIC, 2 = GUILD_ONLY
  discoverable_disabled: boolean;
  guild_scheduled_event_id: string | null;
}

export interface StageParticipant {
  userId: string;
  username: string;
  avatar: string | null;
  isSpeaker: boolean;
  isModerator: boolean;
  requestingToSpeak: boolean;
  suppress: boolean;
}

interface StageInstancesState {
  /** Maps stage instance ID to the instance data */
  instances: Record<string, StageInstance>;
  /** Maps channel ID to the stage instance ID */
  instanceByChannel: Record<string, string>;
  /** Maps channel ID to participants list */
  participantsByChannel: Record<string, StageParticipant[]>;
  /** Maps channel ID to hand-raise requests (user IDs that requested to speak) */
  handRaisesByChannel: Record<string, string[]>;
}

const initialState: StageInstancesState = {
  instances: {},
  instanceByChannel: {},
  participantsByChannel: {},
  handRaisesByChannel: {},
};

export const stageInstancesSlice = createSlice({
  name: 'stageInstances',
  initialState,
  reducers: {
    setStageInstance: (state, action: PayloadAction<StageInstance>) => {
      const instance = action.payload;
      state.instances[instance.id] = instance;
      state.instanceByChannel[instance.channel_id] = instance.id;
    },
    removeStageInstance: (state, action: PayloadAction<{ id: string; channelId: string }>) => {
      delete state.instances[action.payload.id];
      delete state.instanceByChannel[action.payload.channelId];
      delete state.participantsByChannel[action.payload.channelId];
      delete state.handRaisesByChannel[action.payload.channelId];
    },
    updateStageInstanceTopic: (state, action: PayloadAction<{ id: string; topic: string }>) => {
      const instance = state.instances[action.payload.id];
      if (instance) {
        instance.topic = action.payload.topic;
      }
    },
    setStageParticipants: (state, action: PayloadAction<{ channelId: string; participants: StageParticipant[] }>) => {
      state.participantsByChannel[action.payload.channelId] = action.payload.participants;
    },
    addStageParticipant: (state, action: PayloadAction<{ channelId: string; participant: StageParticipant }>) => {
      const { channelId, participant } = action.payload;
      if (!state.participantsByChannel[channelId]) {
        state.participantsByChannel[channelId] = [];
      }
      const existing = state.participantsByChannel[channelId].findIndex(
        p => p.userId === participant.userId
      );
      if (existing < 0) {
        state.participantsByChannel[channelId].push(participant);
      } else {
        state.participantsByChannel[channelId][existing] = participant;
      }
    },
    removeStageParticipant: (state, action: PayloadAction<{ channelId: string; userId: string }>) => {
      const { channelId, userId } = action.payload;
      if (state.participantsByChannel[channelId]) {
        state.participantsByChannel[channelId] = state.participantsByChannel[channelId].filter(
          p => p.userId !== userId
        );
      }
      // Also remove from hand raises
      if (state.handRaisesByChannel[channelId]) {
        state.handRaisesByChannel[channelId] = state.handRaisesByChannel[channelId].filter(
          id => id !== userId
        );
      }
    },
    updateParticipantRole: (state, action: PayloadAction<{
      channelId: string;
      userId: string;
      isSpeaker: boolean;
      suppress: boolean;
    }>) => {
      const { channelId, userId, isSpeaker, suppress } = action.payload;
      const participants = state.participantsByChannel[channelId];
      if (participants) {
        const p = participants.find(pp => pp.userId === userId);
        if (p) {
          p.isSpeaker = isSpeaker;
          p.suppress = suppress;
          if (isSpeaker) {
            p.requestingToSpeak = false;
          }
        }
      }
      // Remove from hand raises if moved to speaker
      if (isSpeaker && state.handRaisesByChannel[channelId]) {
        state.handRaisesByChannel[channelId] = state.handRaisesByChannel[channelId].filter(
          id => id !== userId
        );
      }
    },
    requestToSpeak: (state, action: PayloadAction<{ channelId: string; userId: string }>) => {
      const { channelId, userId } = action.payload;
      if (!state.handRaisesByChannel[channelId]) {
        state.handRaisesByChannel[channelId] = [];
      }
      if (!state.handRaisesByChannel[channelId].includes(userId)) {
        state.handRaisesByChannel[channelId].push(userId);
      }
      // Mark participant as requesting
      const participants = state.participantsByChannel[channelId];
      if (participants) {
        const p = participants.find(pp => pp.userId === userId);
        if (p) {
          p.requestingToSpeak = true;
        }
      }
    },
    cancelRequestToSpeak: (state, action: PayloadAction<{ channelId: string; userId: string }>) => {
      const { channelId, userId } = action.payload;
      if (state.handRaisesByChannel[channelId]) {
        state.handRaisesByChannel[channelId] = state.handRaisesByChannel[channelId].filter(
          id => id !== userId
        );
      }
      const participants = state.participantsByChannel[channelId];
      if (participants) {
        const p = participants.find(pp => pp.userId === userId);
        if (p) {
          p.requestingToSpeak = false;
        }
      }
    },
  },
});

export const {
  setStageInstance,
  removeStageInstance,
  updateStageInstanceTopic,
  setStageParticipants,
  addStageParticipant,
  removeStageParticipant,
  updateParticipantRole,
  requestToSpeak,
  cancelRequestToSpeak,
} = stageInstancesSlice.actions;
