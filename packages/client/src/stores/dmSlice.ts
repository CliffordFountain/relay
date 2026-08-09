import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface DmRecipient {
  id: string;
  username: string;
  avatar: string | null;
}

export interface DmChannel {
  id: string;
  type: number;
  recipients: DmRecipient[];
  last_message_id: string | null;
}

interface DmState {
  dmChannels: DmChannel[];
  selectedDmChannelId: string | null;
}

const initialState: DmState = {
  dmChannels: [],
  selectedDmChannelId: null,
};

export const dmSlice = createSlice({
  name: 'dm',
  initialState,
  reducers: {
    setDmChannels: (state, action: PayloadAction<DmChannel[]>) => {
      state.dmChannels = action.payload;
    },
    addDmChannel: (state, action: PayloadAction<DmChannel>) => {
      const exists = state.dmChannels.find(c => c.id === action.payload.id);
      if (!exists) {
        state.dmChannels.unshift(action.payload);
      }
    },
    removeDmChannel: (state, action: PayloadAction<string>) => {
      state.dmChannels = state.dmChannels.filter(c => c.id !== action.payload);
      if (state.selectedDmChannelId === action.payload) {
        state.selectedDmChannelId = null;
      }
    },
    selectDmChannel: (state, action: PayloadAction<string | null>) => {
      state.selectedDmChannelId = action.payload;
    },
    updateDmLastMessage: (state, action: PayloadAction<{ channelId: string; messageId: string }>) => {
      const channel = state.dmChannels.find(c => c.id === action.payload.channelId);
      if (channel) {
        channel.last_message_id = action.payload.messageId;
      }
    },
  },
});

export const {
  setDmChannels,
  addDmChannel,
  removeDmChannel,
  selectDmChannel,
  updateDmLastMessage,
} = dmSlice.actions;
