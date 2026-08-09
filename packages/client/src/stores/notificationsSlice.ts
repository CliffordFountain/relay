import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface NotificationsState {
  unreadByChannel: Record<string, number>;
  mentionsByChannel: Record<string, number>;
  lastReadMessageIdByChannel: Record<string, string>;
}

const initialState: NotificationsState = {
  unreadByChannel: {},
  mentionsByChannel: {},
  lastReadMessageIdByChannel: {},
};

export const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addUnread: (state, action: PayloadAction<string>) => {
      const channelId = action.payload;
      state.unreadByChannel[channelId] = (state.unreadByChannel[channelId] ?? 0) + 1;
    },
    addMention: (state, action: PayloadAction<string>) => {
      const channelId = action.payload;
      state.mentionsByChannel[channelId] = (state.mentionsByChannel[channelId] ?? 0) + 1;
    },
    markRead: (state, action: PayloadAction<string>) => {
      const channelId = action.payload;
      state.unreadByChannel[channelId] = 0;
      state.mentionsByChannel[channelId] = 0;
    },
    setLastReadMessageId: (state, action: PayloadAction<{ channelId: string; messageId: string }>) => {
      state.lastReadMessageIdByChannel[action.payload.channelId] = action.payload.messageId;
    },
    clearChannel: (state, action: PayloadAction<string>) => {
      delete state.unreadByChannel[action.payload];
      delete state.mentionsByChannel[action.payload];
    },
  },
});

export const { addUnread, addMention, markRead, setLastReadMessageId, clearChannel } = notificationsSlice.actions;
