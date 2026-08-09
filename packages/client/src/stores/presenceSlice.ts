import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface Activity {
  name: string;
  type: 0 | 1 | 2 | 3 | 4 | 5; // Playing, Streaming, Listening, Watching, Custom, Competing
  url?: string;
  state?: string;
  details?: string;
  timestamps?: { start?: number; end?: number };
  assets?: {
    largeImage?: string;
    largeText?: string;
    smallImage?: string;
    smallText?: string;
  };
  party?: { id?: string; size?: [number, number] };
  emoji?: { name: string; id?: string; animated?: boolean };
  applicationId?: string;
}

export type PresenceStatusType = 'online' | 'idle' | 'dnd' | 'offline';

export interface UserPresence {
  userId: string;
  status: PresenceStatusType;
  clientStatus: {
    desktop?: 'online' | 'idle' | 'dnd';
    mobile?: 'online' | 'idle' | 'dnd';
    web?: 'online' | 'idle' | 'dnd';
  };
  activities: Activity[];
}

export interface PresenceState {
  presences: Record<string, UserPresence>;
  selfStatus: 'online' | 'idle' | 'dnd' | 'invisible';
}

const initialState: PresenceState = {
  presences: {},
  selfStatus: 'online',
};

export const presenceSlice = createSlice({
  name: 'presence',
  initialState,
  reducers: {
    setPresence: (state, action: PayloadAction<UserPresence>) => {
      const presence = action.payload;
      if (presence.status === 'offline') {
        delete state.presences[presence.userId];
      } else {
        state.presences[presence.userId] = presence;
      }
    },
    removePresence: (state, action: PayloadAction<string>) => {
      delete state.presences[action.payload];
    },
    setSelfStatus: (state, action: PayloadAction<'online' | 'idle' | 'dnd' | 'invisible'>) => {
      state.selfStatus = action.payload;
    },
    bulkSetPresences: (state, action: PayloadAction<UserPresence[]>) => {
      for (const presence of action.payload) {
        if (presence.status === 'offline') {
          delete state.presences[presence.userId];
        } else {
          state.presences[presence.userId] = presence;
        }
      }
    },
    clearPresences: (state) => {
      state.presences = {};
    },
  },
});

export const {
  setPresence,
  removePresence,
  setSelfStatus,
  bulkSetPresences,
  clearPresences,
} = presenceSlice.actions;
