import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface ThreadMetadata {
  archived: boolean;
  auto_archive_duration: number;
  archive_timestamp: string | null;
  locked: boolean;
  create_timestamp: string;
}

export interface Thread {
  id: string;
  guild_id: string | null;
  type: number;
  name: string | null;
  parent_id: string | null;
  owner_id: string | null;
  last_message_id: string | null;
  thread_metadata: ThreadMetadata | null;
  message_count: number;
  member_count: number;
}

interface ThreadsState {
  entities: Record<string, Thread>;
  threadsByParent: Record<string, string[]>;
  activeThreadsByGuild: Record<string, string[]>;
  selectedThreadId: string | null;
  threadsPanelOpen: boolean;
}

const initialState: ThreadsState = {
  entities: {},
  threadsByParent: {},
  activeThreadsByGuild: {},
  selectedThreadId: null,
  threadsPanelOpen: false,
};

export const threadsSlice = createSlice({
  name: 'threads',
  initialState,
  reducers: {
    setThreads: (state, action: PayloadAction<Thread[]>) => {
      for (const thread of action.payload) {
        state.entities[thread.id] = thread;

        // Index by parent channel
        if (thread.parent_id) {
          const existing = state.threadsByParent[thread.parent_id] ?? [];
          if (!existing.includes(thread.id)) {
            state.threadsByParent[thread.parent_id] = [...existing, thread.id];
          }
        }

        // Index by guild
        if (thread.guild_id) {
          const existing = state.activeThreadsByGuild[thread.guild_id] ?? [];
          if (!existing.includes(thread.id)) {
            state.activeThreadsByGuild[thread.guild_id] = [...existing, thread.id];
          }
        }
      }
    },
    addThread: (state, action: PayloadAction<Thread>) => {
      const thread = action.payload;
      state.entities[thread.id] = thread;

      if (thread.parent_id) {
        const existing = state.threadsByParent[thread.parent_id] ?? [];
        if (!existing.includes(thread.id)) {
          state.threadsByParent[thread.parent_id] = [...existing, thread.id];
        }
      }

      if (thread.guild_id) {
        const existing = state.activeThreadsByGuild[thread.guild_id] ?? [];
        if (!existing.includes(thread.id)) {
          state.activeThreadsByGuild[thread.guild_id] = [...existing, thread.id];
        }
      }
    },
    removeThread: (state, action: PayloadAction<string>) => {
      const thread = state.entities[action.payload];
      if (thread) {
        if (thread.parent_id) {
          const parentThreads = state.threadsByParent[thread.parent_id];
          if (parentThreads) {
            state.threadsByParent[thread.parent_id] = parentThreads.filter(id => id !== action.payload);
          }
        }
        if (thread.guild_id) {
          const guildThreads = state.activeThreadsByGuild[thread.guild_id];
          if (guildThreads) {
            state.activeThreadsByGuild[thread.guild_id] = guildThreads.filter(id => id !== action.payload);
          }
        }
      }
      delete state.entities[action.payload];
      if (state.selectedThreadId === action.payload) {
        state.selectedThreadId = null;
      }
    },
    updateThread: (state, action: PayloadAction<{ id: string; changes: Partial<Omit<Thread, 'id'>> }>) => {
      const thread = state.entities[action.payload.id];
      if (thread) {
        Object.assign(thread, action.payload.changes);
      }
    },
    selectThread: (state, action: PayloadAction<string | null>) => {
      state.selectedThreadId = action.payload;
    },
    toggleThreadsPanel: (state) => {
      state.threadsPanelOpen = !state.threadsPanelOpen;
    },
    setThreadsPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.threadsPanelOpen = action.payload;
    },
  },
});

export const {
  setThreads,
  addThread,
  removeThread,
  updateThread,
  selectThread,
  toggleThreadsPanel,
  setThreadsPanelOpen,
} = threadsSlice.actions;
