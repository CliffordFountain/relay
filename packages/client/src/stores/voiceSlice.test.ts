import { describe, it, expect } from 'vitest';
import {
  voiceSlice,
  applyVoiceState,
  addVoiceUser,
  setVoiceStates,
  type VoiceUser,
} from './voiceSlice';

const { reducer } = voiceSlice;

function makeUser(userId: string, username: string): VoiceUser {
  return {
    userId,
    username,
    avatar: null,
    selfMute: false,
    selfDeaf: false,
    streaming: false,
  };
}

describe('voiceSlice applyVoiceState', () => {
  it('adds a user to a channel on join', () => {
    const state = reducer(
      undefined,
      applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }),
    );
    expect(state.voiceUsersByChannel['chan-a']).toHaveLength(1);
    expect(state.voiceUsersByChannel['chan-a']?.[0]?.userId).toBe('2');
    expect(state.voiceUsersByChannel['chan-a']?.[0]?.username).toBe('Bob');
  });

  it('appends a joining user alongside existing users', () => {
    const initial = reducer(
      undefined,
      addVoiceUser({ channelId: 'chan-a', user: makeUser('1', 'Alice') }),
    );
    const state = reducer(
      initial,
      applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }),
    );
    expect(state.voiceUsersByChannel['chan-a']).toHaveLength(2);
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['1', '2']);
  });

  it('moves a user from one channel to another', () => {
    const initial = reducer(
      undefined,
      applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }),
    );
    const state = reducer(
      initial,
      applyVoiceState({ userId: '2', channelId: 'chan-b', username: 'Bob' }),
    );
    // Removed from the old channel entirely (channel key cleaned up when empty)...
    expect(state.voiceUsersByChannel['chan-a']).toBeUndefined();
    // ...and present in the new channel.
    expect(state.voiceUsersByChannel['chan-b']).toHaveLength(1);
    expect(state.voiceUsersByChannel['chan-b']?.[0]?.userId).toBe('2');
  });

  it('keeps other users in the source channel when one moves out', () => {
    let state = reducer(
      undefined,
      applyVoiceState({ userId: '1', channelId: 'chan-a', username: 'Alice' }),
    );
    state = reducer(state, applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }));
    // Bob moves to chan-b; Alice must remain in chan-a.
    state = reducer(state, applyVoiceState({ userId: '2', channelId: 'chan-b', username: 'Bob' }));
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['1']);
    expect(state.voiceUsersByChannel['chan-b']?.map(u => u.userId)).toEqual(['2']);
  });

  it('removes a user entirely on leave (channelId null)', () => {
    const initial = reducer(
      undefined,
      applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }),
    );
    const state = reducer(initial, applyVoiceState({ userId: '2', channelId: null }));
    expect(state.voiceUsersByChannel['chan-a']).toBeUndefined();
  });

  it('leaves the channel intact for remaining users when one leaves', () => {
    let state = reducer(
      undefined,
      applyVoiceState({ userId: '1', channelId: 'chan-a', username: 'Alice' }),
    );
    state = reducer(state, applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }));
    state = reducer(state, applyVoiceState({ userId: '2', channelId: null }));
    expect(state.voiceUsersByChannel['chan-a']).toHaveLength(1);
    expect(state.voiceUsersByChannel['chan-a']?.[0]?.userId).toBe('1');
  });

  it('updates mute/deaf/streaming flags in place without duplicating the user', () => {
    const initial = reducer(
      undefined,
      applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob' }),
    );
    const state = reducer(
      initial,
      applyVoiceState({
        userId: '2',
        channelId: 'chan-a',
        username: 'Bob',
        selfMute: true,
        selfDeaf: true,
        streaming: true,
      }),
    );
    expect(state.voiceUsersByChannel['chan-a']).toHaveLength(1);
    const user = state.voiceUsersByChannel['chan-a']?.[0];
    expect(user?.selfMute).toBe(true);
    expect(user?.selfDeaf).toBe(true);
    expect(user?.streaming).toBe(true);
  });

  it('preserves previously known identity when a later update omits it', () => {
    const initial = reducer(
      undefined,
      applyVoiceState({ userId: '2', channelId: 'chan-a', username: 'Bob', avatar: 'hash1' }),
    );
    // A mute toggle arrives without username/avatar; they must not be lost.
    const state = reducer(
      initial,
      applyVoiceState({ userId: '2', channelId: 'chan-a', selfMute: true }),
    );
    const user = state.voiceUsersByChannel['chan-a']?.[0];
    expect(user?.username).toBe('Bob');
    expect(user?.avatar).toBe('hash1');
    expect(user?.selfMute).toBe(true);
  });

  it('is a no-op leave when the user was not in any channel', () => {
    const state = reducer(undefined, applyVoiceState({ userId: '99', channelId: null }));
    expect(state.voiceUsersByChannel).toEqual({});
  });
});

describe('voiceSlice setVoiceStates (initial READY roster)', () => {
  it('bulk-populates voiceUsersByChannel from the initial roster', () => {
    const state = reducer(
      undefined,
      setVoiceStates({
        states: [
          { userId: '1', channelId: 'chan-a', username: 'Alice' },
          { userId: '2', channelId: 'chan-a', username: 'Bob' },
          { userId: '3', channelId: 'chan-b', username: 'Carol' },
        ],
      }),
    );
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['1', '2']);
    expect(state.voiceUsersByChannel['chan-b']?.map(u => u.userId)).toEqual(['3']);
  });

  it('carries mute/deaf/streaming flags and identity into the roster', () => {
    const state = reducer(
      undefined,
      setVoiceStates({
        states: [
          {
            userId: '1',
            channelId: 'chan-a',
            username: 'Alice',
            avatar: 'hash1',
            selfMute: true,
            selfDeaf: true,
            streaming: true,
          },
        ],
      }),
    );
    const user = state.voiceUsersByChannel['chan-a']?.[0];
    expect(user?.username).toBe('Alice');
    expect(user?.avatar).toBe('hash1');
    expect(user?.selfMute).toBe(true);
    expect(user?.selfDeaf).toBe(true);
    expect(user?.streaming).toBe(true);
  });

  it('clears any previous roster before repopulating', () => {
    let state = reducer(
      undefined,
      addVoiceUser({ channelId: 'stale-chan', user: makeUser('9', 'Stale') }),
    );
    state = reducer(
      state,
      setVoiceStates({ states: [{ userId: '1', channelId: 'chan-a', username: 'Alice' }] }),
    );
    expect(state.voiceUsersByChannel['stale-chan']).toBeUndefined();
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['1']);
  });

  it('ignores entries with a null channelId (leave placeholders)', () => {
    const state = reducer(
      undefined,
      setVoiceStates({
        states: [
          { userId: '1', channelId: 'chan-a', username: 'Alice' },
          { userId: '2', channelId: null, username: 'Ghost' },
        ],
      }),
    );
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['1']);
    // The null-channel entry produced no channel bucket.
    expect(Object.keys(state.voiceUsersByChannel)).toEqual(['chan-a']);
  });

  it('skips our own id in the incoming roster (owned locally)', () => {
    const state = reducer(
      undefined,
      setVoiceStates({
        states: [
          { userId: 'me', channelId: 'chan-a', username: 'Me' },
          { userId: 'other', channelId: 'chan-a', username: 'Other' },
        ],
        selfUserId: 'me',
      }),
    );
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['other']);
  });

  it('preserves the existing local self entry across the reset', () => {
    // Local user 'me' is already in chan-x (added by the voice components locally).
    let state = reducer(
      undefined,
      addVoiceUser({ channelId: 'chan-x', user: makeUser('me', 'Me') }),
    );
    // A READY roster arrives that does not include us (our previous session's disconnect
    // removed us server-side) — we must not vanish from our own roster.
    state = reducer(
      state,
      setVoiceStates({
        states: [{ userId: 'other', channelId: 'chan-a', username: 'Other' }],
        selfUserId: 'me',
      }),
    );
    expect(state.voiceUsersByChannel['chan-x']?.map(u => u.userId)).toEqual(['me']);
    expect(state.voiceUsersByChannel['chan-a']?.map(u => u.userId)).toEqual(['other']);
  });

  it('does not duplicate self when the roster also includes our id', () => {
    let state = reducer(
      undefined,
      addVoiceUser({ channelId: 'chan-a', user: makeUser('me', 'Me') }),
    );
    state = reducer(
      state,
      setVoiceStates({
        states: [
          { userId: 'me', channelId: 'chan-a', username: 'Me (server)' },
          { userId: 'other', channelId: 'chan-a', username: 'Other' },
        ],
        selfUserId: 'me',
      }),
    );
    const ids = state.voiceUsersByChannel['chan-a']?.map(u => u.userId);
    expect(ids?.filter(id => id === 'me')).toHaveLength(1);
    expect(ids).toContain('other');
  });
});
