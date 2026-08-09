import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface TypingUser {
  userId: string;
  username: string;
  timestamp: number;
}

interface TypingState {
  typingByChannel: Record<string, TypingUser[]>;
}

const initialState: TypingState = {
  typingByChannel: {},
};

const TYPING_TIMEOUT = 10000; // 10 seconds

export const typingSlice = createSlice({
  name: 'typing',
  initialState,
  reducers: {
    addTypingUser: (state, action: PayloadAction<{
      channelId: string;
      userId: string;
      username: string;
    }>) => {
      const { channelId, userId, username } = action.payload;
      if (!state.typingByChannel[channelId]) {
        state.typingByChannel[channelId] = [];
      }
      const users = state.typingByChannel[channelId] ?? [];
      const existing = users.findIndex(u => u.userId === userId);
      const now = Date.now();
      if (existing >= 0) {
        const target = users[existing];
        if (target) target.timestamp = now;
      } else {
        users.push({ userId, username, timestamp: now });
      }
      // Clean up expired entries
      state.typingByChannel[channelId] = users.filter(
        u => now - u.timestamp < TYPING_TIMEOUT
      );
    },
    removeTypingUser: (state, action: PayloadAction<{
      channelId: string;
      userId: string;
    }>) => {
      const { channelId, userId } = action.payload;
      if (state.typingByChannel[channelId]) {
        state.typingByChannel[channelId] = state.typingByChannel[channelId].filter(
          u => u.userId !== userId
        );
      }
    },
    cleanupExpiredTyping: (state, action: PayloadAction<{ channelId: string }>) => {
      const { channelId } = action.payload;
      if (state.typingByChannel[channelId]) {
        const now = Date.now();
        state.typingByChannel[channelId] = state.typingByChannel[channelId].filter(
          u => now - u.timestamp < TYPING_TIMEOUT
        );
      }
    },
  },
});

export const { addTypingUser, removeTypingUser, cleanupExpiredTyping } = typingSlice.actions;
