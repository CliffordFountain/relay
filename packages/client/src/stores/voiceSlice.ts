import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface VoiceUser {
  userId: string;
  username: string;
  avatar: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Screen-share ("Go Live") active. */
  streaming: boolean;
  /** Camera on. Distinct from `streaming` so the UI can tell camera from screen-share. */
  video?: boolean;
}

export interface StreamQualitySettings {
  resolution: 480 | 720 | 1080 | 1440 | 2160 | 0;
  frameRate: 15 | 30 | 60;
}

/**
 * Normalized payload for a remote VOICE_STATE_UPDATE. `channelId === null` means the
 * user left voice entirely. When it is a channel id the user joined (or moved to) that
 * channel. Identity/flag fields are optional so callers can omit what they don't know
 * (existing values are preserved).
 */
export interface VoiceStateUpdatePayload {
  userId: string;
  channelId: string | null;
  username?: string;
  avatar?: string | null;
  selfMute?: boolean;
  selfDeaf?: boolean;
  streaming?: boolean;
  video?: boolean;
}

interface VoiceSliceState {
  channelId: string | null;
  guildId: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  selfVideo: boolean;
  selfScreenShare: boolean;
  connected: boolean;
  /** Whether the local user is currently speaking (detected by VAD) */
  isSpeaking: boolean;
  speakingUsers: string[];
  /** Maps channelId -> list of voice users in that channel */
  voiceUsersByChannel: Record<string, VoiceUser[]>;
  /** Stream quality settings for screen share */
  streamQuality: StreamQualitySettings;
  /** Maps channelId -> custom status text for voice channels */
  voiceChannelStatuses: Record<string, string>;
}

const initialState: VoiceSliceState = {
  channelId: null,
  guildId: null,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfScreenShare: false,
  connected: false,
  isSpeaking: false,
  speakingUsers: [],
  voiceUsersByChannel: {},
  streamQuality: { resolution: 720, frameRate: 30 },
  voiceChannelStatuses: {},
};

export const voiceSlice = createSlice({
  name: 'voice',
  initialState,
  reducers: {
    joinVoice: (state, action: PayloadAction<{ channelId: string; guildId: string }>) => {
      state.channelId = action.payload.channelId;
      state.guildId = action.payload.guildId;
      state.connected = true;
    },
    leaveVoice: (state) => {
      // Remove self from old channel's user list
      if (state.channelId && state.voiceUsersByChannel[state.channelId]) {
        // Self removal is handled via removeVoiceUser dispatch from the component
      }
      state.channelId = null;
      state.guildId = null;
      state.connected = false;
      state.selfVideo = false;
      state.selfScreenShare = false;
      state.isSpeaking = false;
      state.speakingUsers = [];
    },
    setLocalSpeaking: (state, action: PayloadAction<{ userId: string; speaking: boolean }>) => {
      state.isSpeaking = action.payload.speaking;
      // Also update the speakingUsers array so the UI reflects it everywhere
      if (action.payload.speaking) {
        if (!state.speakingUsers.includes(action.payload.userId)) {
          state.speakingUsers.push(action.payload.userId);
        }
      } else {
        state.speakingUsers = state.speakingUsers.filter(id => id !== action.payload.userId);
      }
    },
    toggleMute: (state) => {
      state.selfMute = !state.selfMute;
    },
    toggleDeaf: (state) => {
      state.selfDeaf = !state.selfDeaf;
      if (state.selfDeaf) state.selfMute = true;
    },
    toggleVideo: (state) => {
      state.selfVideo = !state.selfVideo;
    },
    toggleScreenShare: (state) => {
      state.selfScreenShare = !state.selfScreenShare;
    },
    setUserStreaming: (state, action: PayloadAction<{ channelId: string; userId: string; streaming: boolean }>) => {
      const { channelId, userId, streaming } = action.payload;
      if (state.voiceUsersByChannel[channelId]) {
        const user = state.voiceUsersByChannel[channelId].find(u => u.userId === userId);
        if (user) {
          user.streaming = streaming;
        }
      }
    },
    /**
     * Update a user's display name/avatar in the voice roster after a profile change
     * (USER_UPDATE). A user is in at most one channel, but we walk all channels to be
     * safe. Unlike applyVoiceState this does NOT move the user or need a channelId.
     */
    updateVoiceUserIdentity: (state, action: PayloadAction<{ userId: string; username?: string; avatar?: string | null }>) => {
      const { userId, username, avatar } = action.payload;
      for (const list of Object.values(state.voiceUsersByChannel)) {
        const u = list.find(x => x.userId === userId);
        if (u) {
          if (username !== undefined) u.username = username;
          if (avatar !== undefined) u.avatar = avatar;
        }
      }
    },
    setSpeaking: (state, action: PayloadAction<{ userId: string; speaking: boolean }>) => {
      if (action.payload.speaking) {
        if (!state.speakingUsers.includes(action.payload.userId)) {
          state.speakingUsers.push(action.payload.userId);
        }
      } else {
        state.speakingUsers = state.speakingUsers.filter(id => id !== action.payload.userId);
      }
    },
    setVoiceUsers: (state, action: PayloadAction<{ channelId: string; users: VoiceUser[] }>) => {
      state.voiceUsersByChannel[action.payload.channelId] = action.payload.users;
    },
    addVoiceUser: (state, action: PayloadAction<{ channelId: string; user: VoiceUser }>) => {
      const { channelId, user } = action.payload;
      if (!state.voiceUsersByChannel[channelId]) {
        state.voiceUsersByChannel[channelId] = [];
      }
      const existing = state.voiceUsersByChannel[channelId].findIndex(
        u => u.userId === user.userId
      );
      if (existing < 0) {
        state.voiceUsersByChannel[channelId].push(user);
      } else {
        state.voiceUsersByChannel[channelId][existing] = user;
      }
    },
    removeVoiceUser: (state, action: PayloadAction<{ channelId: string; userId: string }>) => {
      const { channelId, userId } = action.payload;
      if (state.voiceUsersByChannel[channelId]) {
        state.voiceUsersByChannel[channelId] = state.voiceUsersByChannel[channelId].filter(
          u => u.userId !== userId
        );
        if (state.voiceUsersByChannel[channelId].length === 0) {
          delete state.voiceUsersByChannel[channelId];
        }
      }
    },
    clearVoiceChannel: (state, action: PayloadAction<string>) => {
      delete state.voiceUsersByChannel[action.payload];
    },
    /**
     * Applies a remote VOICE_STATE_UPDATE: moves the user into `channelId`, removing
     * them from any other voice channel they were in. A null `channelId` (leave) just
     * removes them everywhere. Handles join, move, leave, and in-place flag changes
     * (mute/deaf/streaming) while preserving list order and previously known identity.
     */
    applyVoiceState: (state, action: PayloadAction<VoiceStateUpdatePayload>) => {
      const { userId, channelId } = action.payload;

      // Remove the user from every voice channel that is not their current one.
      // Covers leaves (channelId === null) and moves (they were elsewhere before).
      for (const chId of Object.keys(state.voiceUsersByChannel)) {
        if (chId === channelId) continue;
        const list = state.voiceUsersByChannel[chId];
        if (!list) continue;
        const filtered = list.filter(u => u.userId !== userId);
        if (filtered.length !== list.length) {
          if (filtered.length === 0) {
            delete state.voiceUsersByChannel[chId];
          } else {
            state.voiceUsersByChannel[chId] = filtered;
          }
        }
      }

      // Leave: no destination channel, so the removal above is all that's needed.
      if (!channelId) return;

      // Join / move / in-place update: add or update the user in their current channel.
      if (!state.voiceUsersByChannel[channelId]) {
        state.voiceUsersByChannel[channelId] = [];
      }
      const target = state.voiceUsersByChannel[channelId];
      const idx = target.findIndex(u => u.userId === userId);
      const previous = idx >= 0 ? target[idx] : undefined;
      // Nullish coalescing preserves explicit `false` flags while falling back to the
      // previously known value (or a sane default) when a field is omitted.
      const merged: VoiceUser = {
        userId,
        username: action.payload.username ?? previous?.username ?? userId,
        avatar: action.payload.avatar ?? previous?.avatar ?? null,
        selfMute: action.payload.selfMute ?? previous?.selfMute ?? false,
        selfDeaf: action.payload.selfDeaf ?? previous?.selfDeaf ?? false,
        streaming: action.payload.streaming ?? previous?.streaming ?? false,
        video: action.payload.video ?? previous?.video ?? false,
      };
      if (idx >= 0) {
        target[idx] = merged;
      } else {
        target.push(merged);
      }
    },
    /**
     * Bulk-applies the initial voice roster received in the gateway READY payload. It
     * clears and repopulates `voiceUsersByChannel` from the given list so a client that
     * connects AFTER others are already in voice sees the full roster (live
     * `applyVoiceState` updates only cover changes that happen post-connect).
     *
     * The local user's own presence is owned by the voice components (join/leave dispatch
     * their own actions), so entries for `selfUserId` in the incoming roster are skipped;
     * any existing local self entry is preserved across the reset so a READY refresh (e.g.
     * a reconnect while already in a voice channel) doesn't drop us from our own roster.
     */
    setVoiceStates: (
      state,
      action: PayloadAction<{ states: VoiceStateUpdatePayload[]; selfUserId?: string | null }>,
    ) => {
      const { states, selfUserId } = action.payload;

      // Capture the local user's current entry before we wipe the roster.
      let preserved: { channelId: string; user: VoiceUser } | null = null;
      if (selfUserId) {
        for (const [chId, list] of Object.entries(state.voiceUsersByChannel)) {
          const self = list?.find(u => u.userId === selfUserId);
          if (self) {
            preserved = { channelId: chId, user: self };
            break;
          }
        }
      }

      const next: Record<string, VoiceUser[]> = {};
      for (const vs of states) {
        // Leave entries (no destination channel) carry nothing to place in the roster.
        if (!vs.channelId) continue;
        // Skip our own id — handled locally (and re-added from `preserved` below).
        if (selfUserId && vs.userId === selfUserId) continue;

        const list = next[vs.channelId] ?? (next[vs.channelId] = []);
        const user: VoiceUser = {
          userId: vs.userId,
          username: vs.username ?? vs.userId,
          avatar: vs.avatar ?? null,
          selfMute: vs.selfMute ?? false,
          selfDeaf: vs.selfDeaf ?? false,
          streaming: vs.streaming ?? false,
          video: vs.video ?? false,
        };
        const idx = list.findIndex(u => u.userId === vs.userId);
        if (idx >= 0) list[idx] = user;
        else list.push(user);
      }

      if (preserved) {
        const list = next[preserved.channelId] ?? (next[preserved.channelId] = []);
        if (!list.some(u => u.userId === preserved!.user.userId)) {
          list.push(preserved.user);
        }
      }

      state.voiceUsersByChannel = next;
    },
    setStreamQuality: (state, action: PayloadAction<StreamQualitySettings>) => {
      state.streamQuality = action.payload;
    },
    setVoiceChannelStatus: (state, action: PayloadAction<{ channelId: string; status: string }>) => {
      const { channelId, status } = action.payload;
      if (status.trim() === '') {
        delete state.voiceChannelStatuses[channelId];
      } else {
        state.voiceChannelStatuses[channelId] = status;
      }
    },
  },
});

export const {
  joinVoice,
  leaveVoice,
  toggleMute,
  toggleDeaf,
  toggleVideo,
  toggleScreenShare,
  setUserStreaming,
  updateVoiceUserIdentity,
  setSpeaking,
  setLocalSpeaking,
  setVoiceUsers,
  addVoiceUser,
  removeVoiceUser,
  clearVoiceChannel,
  applyVoiceState,
  setVoiceStates,
  setStreamQuality,
  setVoiceChannelStatus,
} = voiceSlice.actions;
