import { describe, it, expect } from 'vitest';
import {
  threadsSlice,
  setThreads,
  addThread,
  removeThread,
  updateThread,
  selectThread,
  toggleThreadsPanel,
  setThreadsPanelOpen,
} from './threadsSlice';
import type { Thread } from './threadsSlice';

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: '1001',
  guild_id: '500',
  type: 11,
  name: 'Test Thread',
  parent_id: '100',
  owner_id: '200',
  last_message_id: null,
  thread_metadata: {
    archived: false,
    auto_archive_duration: 1440,
    archive_timestamp: null,
    locked: false,
    create_timestamp: '2026-03-24T00:00:00Z',
  },
  message_count: 5,
  member_count: 3,
  ...overrides,
});

describe('threadsSlice', () => {
  const initialState = threadsSlice.getInitialState();

  it('has correct initial state', () => {
    expect(initialState.entities).toEqual({});
    expect(initialState.threadsByParent).toEqual({});
    expect(initialState.activeThreadsByGuild).toEqual({});
    expect(initialState.selectedThreadId).toBeNull();
    expect(initialState.threadsPanelOpen).toBe(false);
  });

  describe('setThreads', () => {
    it('adds multiple threads and indexes by parent and guild', () => {
      const threads = [
        makeThread({ id: '1001', parent_id: '100', guild_id: '500' }),
        makeThread({ id: '1002', parent_id: '100', guild_id: '500' }),
        makeThread({ id: '1003', parent_id: '200', guild_id: '500' }),
      ];

      const state = threadsSlice.reducer(initialState, setThreads(threads));

      expect(Object.keys(state.entities)).toHaveLength(3);
      expect(state.threadsByParent['100']).toEqual(['1001', '1002']);
      expect(state.threadsByParent['200']).toEqual(['1003']);
      expect(state.activeThreadsByGuild['500']).toEqual(['1001', '1002', '1003']);
    });

    it('does not duplicate thread IDs on repeated calls', () => {
      const thread = makeThread({ id: '1001', parent_id: '100', guild_id: '500' });
      let state = threadsSlice.reducer(initialState, setThreads([thread]));
      state = threadsSlice.reducer(state, setThreads([thread]));

      expect(state.threadsByParent['100']).toEqual(['1001']);
    });
  });

  describe('addThread', () => {
    it('adds a single thread', () => {
      const thread = makeThread();
      const state = threadsSlice.reducer(initialState, addThread(thread));

      expect(state.entities['1001']).toEqual(thread);
      expect(state.threadsByParent['100']).toContain('1001');
      expect(state.activeThreadsByGuild['500']).toContain('1001');
    });
  });

  describe('removeThread', () => {
    it('removes a thread and cleans up indexes', () => {
      const thread = makeThread();
      let state = threadsSlice.reducer(initialState, addThread(thread));
      state = threadsSlice.reducer(state, removeThread('1001'));

      expect(state.entities['1001']).toBeUndefined();
      expect(state.threadsByParent['100']).toEqual([]);
      expect(state.activeThreadsByGuild['500']).toEqual([]);
    });

    it('clears selectedThreadId when the selected thread is removed', () => {
      const thread = makeThread();
      let state = threadsSlice.reducer(initialState, addThread(thread));
      state = threadsSlice.reducer(state, selectThread('1001'));
      state = threadsSlice.reducer(state, removeThread('1001'));

      expect(state.selectedThreadId).toBeNull();
    });
  });

  describe('updateThread', () => {
    it('updates thread fields', () => {
      const thread = makeThread();
      let state = threadsSlice.reducer(initialState, addThread(thread));
      state = threadsSlice.reducer(state, updateThread({
        id: '1001',
        changes: { name: 'Updated Name', message_count: 10 },
      }));

      expect(state.entities['1001']?.name).toBe('Updated Name');
      expect(state.entities['1001']?.message_count).toBe(10);
    });
  });

  describe('selectThread', () => {
    it('sets selectedThreadId', () => {
      const state = threadsSlice.reducer(initialState, selectThread('1001'));
      expect(state.selectedThreadId).toBe('1001');
    });

    it('clears selectedThreadId with null', () => {
      let state = threadsSlice.reducer(initialState, selectThread('1001'));
      state = threadsSlice.reducer(state, selectThread(null));
      expect(state.selectedThreadId).toBeNull();
    });
  });

  describe('toggleThreadsPanel', () => {
    it('toggles threadsPanelOpen', () => {
      let state = threadsSlice.reducer(initialState, toggleThreadsPanel());
      expect(state.threadsPanelOpen).toBe(true);
      state = threadsSlice.reducer(state, toggleThreadsPanel());
      expect(state.threadsPanelOpen).toBe(false);
    });
  });

  describe('setThreadsPanelOpen', () => {
    it('sets threadsPanelOpen to a specific value', () => {
      const state = threadsSlice.reducer(initialState, setThreadsPanelOpen(true));
      expect(state.threadsPanelOpen).toBe(true);
    });
  });
});
