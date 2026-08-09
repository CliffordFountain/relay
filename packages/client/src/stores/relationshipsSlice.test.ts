import { describe, it, expect } from 'vitest';
import {
  relationshipsSlice,
  setRelationships,
  addRelationship,
  removeRelationship,
  updateRelationship,
  setRelationshipsLoading,
  RelationshipType,
} from './relationshipsSlice';
import type { Relationship } from './relationshipsSlice';

const mockFriend: Relationship = {
  id: '100',
  type: RelationshipType.FRIEND,
  user: { id: '200', username: 'FriendUser', avatar: null },
};

const mockIncoming: Relationship = {
  id: '101',
  type: RelationshipType.INCOMING_REQUEST,
  user: { id: '201', username: 'IncomingUser', avatar: null },
};

const mockBlocked: Relationship = {
  id: '102',
  type: RelationshipType.BLOCKED,
  user: { id: '202', username: 'BlockedUser', avatar: null },
};

const mockOutgoing: Relationship = {
  id: '103',
  type: RelationshipType.OUTGOING_REQUEST,
  user: { id: '203', username: 'OutgoingUser', avatar: null },
};

describe('relationshipsSlice', () => {
  const initialState = relationshipsSlice.getInitialState();

  it('has correct initial state', () => {
    expect(initialState.relationships).toEqual({});
    expect(initialState.isLoading).toBe(false);
  });

  it('setRelationships replaces all relationships keyed by user id', () => {
    const state = relationshipsSlice.reducer(
      initialState,
      setRelationships([mockFriend, mockIncoming, mockBlocked]),
    );
    expect(Object.keys(state.relationships)).toHaveLength(3);
    expect(state.relationships['200']).toEqual(mockFriend);
    expect(state.relationships['201']).toEqual(mockIncoming);
    expect(state.relationships['202']).toEqual(mockBlocked);
  });

  it('setRelationships clears previous relationships', () => {
    let state = relationshipsSlice.reducer(initialState, setRelationships([mockFriend, mockIncoming]));
    state = relationshipsSlice.reducer(state, setRelationships([mockBlocked]));
    expect(Object.keys(state.relationships)).toHaveLength(1);
    expect(state.relationships['202']).toEqual(mockBlocked);
    expect(state.relationships['200']).toBeUndefined();
  });

  it('addRelationship adds a new relationship', () => {
    const state = relationshipsSlice.reducer(initialState, addRelationship(mockFriend));
    expect(state.relationships['200']).toEqual(mockFriend);
  });

  it('addRelationship overwrites existing relationship for same user', () => {
    let state = relationshipsSlice.reducer(initialState, addRelationship(mockIncoming));
    const updatedRel: Relationship = {
      ...mockIncoming,
      type: RelationshipType.FRIEND,
    };
    state = relationshipsSlice.reducer(state, addRelationship(updatedRel));
    expect(state.relationships['201']!.type).toBe(RelationshipType.FRIEND);
  });

  it('removeRelationship removes by user id', () => {
    let state = relationshipsSlice.reducer(initialState, setRelationships([mockFriend, mockIncoming]));
    state = relationshipsSlice.reducer(state, removeRelationship('200'));
    expect(state.relationships['200']).toBeUndefined();
    expect(state.relationships['201']).toEqual(mockIncoming);
  });

  it('removeRelationship does nothing for non-existent id', () => {
    const state = relationshipsSlice.reducer(initialState, setRelationships([mockFriend]));
    const nextState = relationshipsSlice.reducer(state, removeRelationship('999'));
    expect(Object.keys(nextState.relationships)).toHaveLength(1);
  });

  it('updateRelationship updates an existing relationship', () => {
    let state = relationshipsSlice.reducer(initialState, addRelationship(mockOutgoing));
    const updated: Relationship = {
      ...mockOutgoing,
      type: RelationshipType.FRIEND,
    };
    state = relationshipsSlice.reducer(state, updateRelationship(updated));
    expect(state.relationships['203']!.type).toBe(RelationshipType.FRIEND);
  });

  it('setRelationshipsLoading toggles loading state', () => {
    let state = relationshipsSlice.reducer(initialState, setRelationshipsLoading(true));
    expect(state.isLoading).toBe(true);
    state = relationshipsSlice.reducer(state, setRelationshipsLoading(false));
    expect(state.isLoading).toBe(false);
  });

  it('handles all relationship types in setRelationships', () => {
    const state = relationshipsSlice.reducer(
      initialState,
      setRelationships([mockFriend, mockIncoming, mockBlocked, mockOutgoing]),
    );
    expect(state.relationships['200']!.type).toBe(RelationshipType.FRIEND);
    expect(state.relationships['201']!.type).toBe(RelationshipType.INCOMING_REQUEST);
    expect(state.relationships['202']!.type).toBe(RelationshipType.BLOCKED);
    expect(state.relationships['203']!.type).toBe(RelationshipType.OUTGOING_REQUEST);
  });
});
