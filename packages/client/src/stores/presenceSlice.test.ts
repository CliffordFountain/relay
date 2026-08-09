import { describe, it, expect } from 'vitest';
import {
  presenceSlice,
  setPresence,
  removePresence,
  setSelfStatus,
  bulkSetPresences,
  clearPresences,
  type UserPresence,
  type PresenceState,
} from './presenceSlice';

const reducer = presenceSlice.reducer;

const makePresence = (userId: string, status: UserPresence['status'] = 'online'): UserPresence => ({
  userId,
  status,
  clientStatus: {},
  activities: [],
});

describe('presenceSlice', () => {
  const initialState: PresenceState = {
    presences: {},
    selfStatus: 'online',
  };

  it('should return the initial state', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('setPresence', () => {
    it('should add a new presence', () => {
      const presence = makePresence('123', 'online');
      const state = reducer(initialState, setPresence(presence));
      expect(state.presences['123']).toEqual(presence);
    });

    it('should update an existing presence', () => {
      const existing: PresenceState = {
        ...initialState,
        presences: { '123': makePresence('123', 'online') },
      };
      const updated = makePresence('123', 'idle');
      const state = reducer(existing, setPresence(updated));
      expect(state.presences['123']?.status).toBe('idle');
    });

    it('should remove presence when status is offline', () => {
      const existing: PresenceState = {
        ...initialState,
        presences: { '123': makePresence('123', 'online') },
      };
      const state = reducer(existing, setPresence(makePresence('123', 'offline')));
      expect(state.presences['123']).toBeUndefined();
    });
  });

  describe('removePresence', () => {
    it('should remove a presence by user ID', () => {
      const existing: PresenceState = {
        ...initialState,
        presences: {
          '123': makePresence('123', 'online'),
          '456': makePresence('456', 'dnd'),
        },
      };
      const state = reducer(existing, removePresence('123'));
      expect(state.presences['123']).toBeUndefined();
      expect(state.presences['456']).toBeDefined();
    });

    it('should be a no-op for non-existent user', () => {
      const state = reducer(initialState, removePresence('999'));
      expect(state.presences).toEqual({});
    });
  });

  describe('setSelfStatus', () => {
    it('should update the self status', () => {
      const state = reducer(initialState, setSelfStatus('dnd'));
      expect(state.selfStatus).toBe('dnd');
    });

    it('should support invisible status', () => {
      const state = reducer(initialState, setSelfStatus('invisible'));
      expect(state.selfStatus).toBe('invisible');
    });
  });

  describe('bulkSetPresences', () => {
    it('should set multiple presences at once', () => {
      const presences = [
        makePresence('1', 'online'),
        makePresence('2', 'idle'),
        makePresence('3', 'dnd'),
      ];
      const state = reducer(initialState, bulkSetPresences(presences));
      expect(Object.keys(state.presences)).toHaveLength(3);
      expect(state.presences['1']?.status).toBe('online');
      expect(state.presences['2']?.status).toBe('idle');
      expect(state.presences['3']?.status).toBe('dnd');
    });

    it('should remove offline presences during bulk set', () => {
      const existing: PresenceState = {
        ...initialState,
        presences: { '1': makePresence('1', 'online') },
      };
      const presences = [
        makePresence('1', 'offline'),
        makePresence('2', 'online'),
      ];
      const state = reducer(existing, bulkSetPresences(presences));
      expect(state.presences['1']).toBeUndefined();
      expect(state.presences['2']?.status).toBe('online');
    });

    it('should merge with existing presences', () => {
      const existing: PresenceState = {
        ...initialState,
        presences: { '1': makePresence('1', 'online') },
      };
      const state = reducer(existing, bulkSetPresences([makePresence('2', 'dnd')]));
      expect(state.presences['1']?.status).toBe('online');
      expect(state.presences['2']?.status).toBe('dnd');
    });
  });

  describe('clearPresences', () => {
    it('should clear all presences', () => {
      const existing: PresenceState = {
        ...initialState,
        presences: {
          '1': makePresence('1', 'online'),
          '2': makePresence('2', 'idle'),
        },
      };
      const state = reducer(existing, clearPresences());
      expect(state.presences).toEqual({});
    });

    it('should preserve selfStatus when clearing', () => {
      const existing: PresenceState = {
        presences: { '1': makePresence('1', 'online') },
        selfStatus: 'dnd',
      };
      const state = reducer(existing, clearPresences());
      expect(state.selfStatus).toBe('dnd');
    });
  });
});
