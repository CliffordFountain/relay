import { describe, it, expect } from 'vitest';
import {
  dmSlice,
  setDmChannels,
  addDmChannel,
  removeDmChannel,
  selectDmChannel,
  updateDmLastMessage,
} from './dmSlice';
import type { DmChannel } from './dmSlice';

const mockDm: DmChannel = {
  id: '100',
  type: 1,
  recipients: [{ id: '200', username: 'TestUser', avatar: null }],
  last_message_id: '300',
};

const mockDm2: DmChannel = {
  id: '101',
  type: 1,
  recipients: [{ id: '201', username: 'AnotherUser', avatar: null }],
  last_message_id: '301',
};

describe('dmSlice', () => {
  const initialState = dmSlice.getInitialState();

  it('has correct initial state', () => {
    expect(initialState.dmChannels).toEqual([]);
    expect(initialState.selectedDmChannelId).toBeNull();
  });

  it('setDmChannels replaces all DM channels', () => {
    const state = dmSlice.reducer(initialState, setDmChannels([mockDm, mockDm2]));
    expect(state.dmChannels).toHaveLength(2);
    expect(state.dmChannels[0]!.id).toBe('100');
    expect(state.dmChannels[1]!.id).toBe('101');
  });

  it('addDmChannel prepends a new DM channel', () => {
    const stateWithOne = dmSlice.reducer(initialState, setDmChannels([mockDm]));
    const state = dmSlice.reducer(stateWithOne, addDmChannel(mockDm2));
    expect(state.dmChannels).toHaveLength(2);
    expect(state.dmChannels[0]!.id).toBe('101');
  });

  it('addDmChannel does not duplicate existing channels', () => {
    const stateWithOne = dmSlice.reducer(initialState, setDmChannels([mockDm]));
    const state = dmSlice.reducer(stateWithOne, addDmChannel(mockDm));
    expect(state.dmChannels).toHaveLength(1);
  });

  it('removeDmChannel removes a channel', () => {
    const stateWithTwo = dmSlice.reducer(initialState, setDmChannels([mockDm, mockDm2]));
    const state = dmSlice.reducer(stateWithTwo, removeDmChannel('100'));
    expect(state.dmChannels).toHaveLength(1);
    expect(state.dmChannels[0]!.id).toBe('101');
  });

  it('removeDmChannel clears selection if removed channel was selected', () => {
    let state = dmSlice.reducer(initialState, setDmChannels([mockDm]));
    state = dmSlice.reducer(state, selectDmChannel('100'));
    state = dmSlice.reducer(state, removeDmChannel('100'));
    expect(state.selectedDmChannelId).toBeNull();
  });

  it('selectDmChannel sets the selected DM channel', () => {
    const state = dmSlice.reducer(initialState, selectDmChannel('100'));
    expect(state.selectedDmChannelId).toBe('100');
  });

  it('selectDmChannel can be set to null', () => {
    let state = dmSlice.reducer(initialState, selectDmChannel('100'));
    state = dmSlice.reducer(state, selectDmChannel(null));
    expect(state.selectedDmChannelId).toBeNull();
  });

  it('updateDmLastMessage updates the last message id', () => {
    const stateWithDm = dmSlice.reducer(initialState, setDmChannels([mockDm]));
    const state = dmSlice.reducer(
      stateWithDm,
      updateDmLastMessage({ channelId: '100', messageId: '999' }),
    );
    expect(state.dmChannels[0]!.last_message_id).toBe('999');
  });
});
