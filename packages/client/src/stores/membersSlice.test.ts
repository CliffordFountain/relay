import { describe, it, expect } from 'vitest';
import { membersSlice, setMembers, addMember, removeMember, updateMember, setMembersLoading } from './membersSlice';
import type { GuildMember } from './membersSlice';

const { reducer } = membersSlice;

function mockMember(id: string, username: string): GuildMember {
  return {
    user: { id, username, displayName: username, avatar: null, bot: false },
    roles: [],
    nick: null,
    joinedAt: '2026-01-01T00:00:00Z',
  };
}

describe('membersSlice', () => {
  it('sets members for a guild', () => {
    const members = [mockMember('1', 'Alice'), mockMember('2', 'Bob')];
    const state = reducer(undefined, setMembers({ guildId: 'g1', members }));
    expect(state.membersByGuild['g1']).toHaveLength(2);
    expect(state.membersByGuild['g1']?.[0]?.user.username).toBe('Alice');
  });

  it('adds a member to a guild', () => {
    const initial = reducer(undefined, setMembers({ guildId: 'g1', members: [mockMember('1', 'Alice')] }));
    const state = reducer(initial, addMember({ guildId: 'g1', member: mockMember('2', 'Bob') }));
    expect(state.membersByGuild['g1']).toHaveLength(2);
  });

  it('updates existing member on add', () => {
    const initial = reducer(undefined, setMembers({ guildId: 'g1', members: [mockMember('1', 'Alice')] }));
    const updated = mockMember('1', 'AliceUpdated');
    const state = reducer(initial, addMember({ guildId: 'g1', member: updated }));
    expect(state.membersByGuild['g1']).toHaveLength(1);
    expect(state.membersByGuild['g1']?.[0]?.user.username).toBe('AliceUpdated');
  });

  it('removes a member from a guild', () => {
    const initial = reducer(undefined, setMembers({ guildId: 'g1', members: [mockMember('1', 'Alice'), mockMember('2', 'Bob')] }));
    const state = reducer(initial, removeMember({ guildId: 'g1', userId: '1' }));
    expect(state.membersByGuild['g1']).toHaveLength(1);
    expect(state.membersByGuild['g1']?.[0]?.user.username).toBe('Bob');
  });

  it('updates a member in a guild', () => {
    const initial = reducer(undefined, setMembers({ guildId: 'g1', members: [mockMember('1', 'Alice')] }));
    const state = reducer(initial, updateMember({ guildId: 'g1', userId: '1', changes: { nick: 'AliceNick' } }));
    expect(state.membersByGuild['g1']?.[0]?.nick).toBe('AliceNick');
  });

  it('sets loading state', () => {
    const state = reducer(undefined, setMembersLoading(true));
    expect(state.isLoading).toBe(true);
    const state2 = reducer(state, setMembersLoading(false));
    expect(state2.isLoading).toBe(false);
  });

  it('adds member to non-existent guild list', () => {
    const state = reducer(undefined, addMember({ guildId: 'new-guild', member: mockMember('1', 'Alice') }));
    expect(state.membersByGuild['new-guild']).toHaveLength(1);
  });
});
