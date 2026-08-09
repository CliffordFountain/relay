import { describe, it, expect } from 'vitest';
import {
  notificationsSlice,
  addUnread,
  addMention,
  markRead,
  clearChannel,
} from './notificationsSlice';

describe('notificationsSlice', () => {
  const initialState = notificationsSlice.getInitialState();

  it('has correct initial state', () => {
    expect(initialState.unreadByChannel).toEqual({});
    expect(initialState.mentionsByChannel).toEqual({});
  });

  it('addUnread increments unread count for a channel', () => {
    let state = notificationsSlice.reducer(initialState, addUnread('ch1'));
    expect(state.unreadByChannel['ch1']).toBe(1);
    state = notificationsSlice.reducer(state, addUnread('ch1'));
    expect(state.unreadByChannel['ch1']).toBe(2);
  });

  it('addMention increments mention count for a channel', () => {
    let state = notificationsSlice.reducer(initialState, addMention('ch1'));
    expect(state.mentionsByChannel['ch1']).toBe(1);
    state = notificationsSlice.reducer(state, addMention('ch1'));
    expect(state.mentionsByChannel['ch1']).toBe(2);
  });

  it('markRead resets both unread and mention counts', () => {
    let state = notificationsSlice.reducer(initialState, addUnread('ch1'));
    state = notificationsSlice.reducer(state, addUnread('ch1'));
    state = notificationsSlice.reducer(state, addMention('ch1'));
    state = notificationsSlice.reducer(state, markRead('ch1'));
    expect(state.unreadByChannel['ch1']).toBe(0);
    expect(state.mentionsByChannel['ch1']).toBe(0);
  });

  it('clearChannel removes channel from both records', () => {
    let state = notificationsSlice.reducer(initialState, addUnread('ch1'));
    state = notificationsSlice.reducer(state, addMention('ch1'));
    state = notificationsSlice.reducer(state, clearChannel('ch1'));
    expect(state.unreadByChannel['ch1']).toBeUndefined();
    expect(state.mentionsByChannel['ch1']).toBeUndefined();
  });

  it('handles independent channels correctly', () => {
    let state = notificationsSlice.reducer(initialState, addUnread('ch1'));
    state = notificationsSlice.reducer(state, addUnread('ch2'));
    state = notificationsSlice.reducer(state, addUnread('ch2'));
    expect(state.unreadByChannel['ch1']).toBe(1);
    expect(state.unreadByChannel['ch2']).toBe(2);

    state = notificationsSlice.reducer(state, markRead('ch1'));
    expect(state.unreadByChannel['ch1']).toBe(0);
    expect(state.unreadByChannel['ch2']).toBe(2);
  });
});
