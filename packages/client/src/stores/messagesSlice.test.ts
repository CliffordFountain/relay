import { describe, it, expect } from 'vitest';
import {
  messagesSlice,
  setMessages,
  addMessage,
  prependMessages,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  setHasMore,
  setLoadingMore,
} from './messagesSlice';
import type { Message } from './messagesSlice';

const { reducer } = messagesSlice;

function mockMessage(id: string, channelId: string, authorId: string = 'u1'): Message {
  return {
    id,
    channel_id: channelId,
    author: { id: authorId, username: 'TestUser', avatar: null },
    content: `Message ${id}`,
    timestamp: '2026-03-22T12:00:00Z',
    edited_timestamp: null,
  };
}

describe('messagesSlice', () => {
  describe('basic message operations', () => {
    it('sets messages for a channel', () => {
      const msgs = [mockMessage('1', 'ch1'), mockMessage('2', 'ch1')];
      const state = reducer(undefined, setMessages({ channelId: 'ch1', messages: msgs }));
      expect(state.messagesByChannel['ch1']).toHaveLength(2);
    });

    it('adds a message avoiding duplicates', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      const state = reducer(initial, addMessage(mockMessage('1', 'ch1')));
      expect(state.messagesByChannel['ch1']).toHaveLength(1);
    });

    it('adds a new message', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      const state = reducer(initial, addMessage(mockMessage('2', 'ch1')));
      expect(state.messagesByChannel['ch1']).toHaveLength(2);
    });

    it('updates an existing message', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      const updated: Message = {
        ...mockMessage('1', 'ch1'),
        content: 'Edited content',
        edited_timestamp: '2026-03-22T12:05:00Z',
      };
      const state = reducer(initial, updateMessage(updated));
      expect(state.messagesByChannel['ch1']?.[0]?.content).toBe('Edited content');
    });

    it('deletes a message', () => {
      const initial = reducer(undefined, setMessages({
        channelId: 'ch1',
        messages: [mockMessage('1', 'ch1'), mockMessage('2', 'ch1')],
      }));
      const state = reducer(initial, deleteMessage({ channelId: 'ch1', messageId: '1' }));
      expect(state.messagesByChannel['ch1']).toHaveLength(1);
      expect(state.messagesByChannel['ch1']?.[0]?.id).toBe('2');
    });
  });

  describe('reactions', () => {
    it('adds a reaction to a message', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      const state = reducer(initial, addReaction({
        channelId: 'ch1',
        messageId: '1',
        emoji: '👍',
        me: true,
      }));
      const msg = state.messagesByChannel['ch1']?.[0];
      expect(msg?.reactions).toHaveLength(1);
      expect(msg?.reactions?.[0]?.emoji).toBe('👍');
      expect(msg?.reactions?.[0]?.count).toBe(1);
      expect(msg?.reactions?.[0]?.me).toBe(true);
    });

    it('increments count for existing reaction', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      let state = reducer(initial, addReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: false,
      }));
      state = reducer(state, addReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: true,
      }));
      const msg = state.messagesByChannel['ch1']?.[0];
      expect(msg?.reactions?.[0]?.count).toBe(2);
      expect(msg?.reactions?.[0]?.me).toBe(true);
    });

    it('removes a reaction', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      let state = reducer(initial, addReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: true,
      }));
      state = reducer(state, addReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: false,
      }));
      state = reducer(state, removeReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: true,
      }));
      const msg = state.messagesByChannel['ch1']?.[0];
      expect(msg?.reactions?.[0]?.count).toBe(1);
      expect(msg?.reactions?.[0]?.me).toBe(false);
    });

    it('removes reaction entry when count reaches 0', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      let state = reducer(initial, addReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: true,
      }));
      state = reducer(state, removeReaction({
        channelId: 'ch1', messageId: '1', emoji: '👍', me: true,
      }));
      const msg = state.messagesByChannel['ch1']?.[0];
      expect(msg?.reactions).toHaveLength(0);
    });

    it('handles adding reaction to nonexistent message gracefully', () => {
      const initial = reducer(undefined, setMessages({ channelId: 'ch1', messages: [mockMessage('1', 'ch1')] }));
      const state = reducer(initial, addReaction({
        channelId: 'ch1', messageId: 'nonexistent', emoji: '👍', me: true,
      }));
      // Should not crash
      expect(state.messagesByChannel['ch1']?.[0]?.reactions).toBeUndefined();
    });
  });

  describe('pagination', () => {
    it('prependMessages adds messages to the beginning', () => {
      let state = reducer(undefined, setMessages({
        channelId: 'ch1',
        messages: [mockMessage('3', 'ch1'), mockMessage('4', 'ch1')],
      }));
      state = reducer(state, prependMessages({
        channelId: 'ch1',
        messages: [mockMessage('1', 'ch1'), mockMessage('2', 'ch1')],
      }));
      const msgs = state.messagesByChannel['ch1'];
      expect(msgs).toHaveLength(4);
      expect(msgs?.[0]?.id).toBe('1');
      expect(msgs?.[1]?.id).toBe('2');
      expect(msgs?.[2]?.id).toBe('3');
      expect(msgs?.[3]?.id).toBe('4');
    });

    it('prependMessages avoids duplicates', () => {
      let state = reducer(undefined, setMessages({
        channelId: 'ch1',
        messages: [mockMessage('2', 'ch1'), mockMessage('3', 'ch1')],
      }));
      state = reducer(state, prependMessages({
        channelId: 'ch1',
        messages: [mockMessage('1', 'ch1'), mockMessage('2', 'ch1')],
      }));
      const msgs = state.messagesByChannel['ch1'];
      expect(msgs).toHaveLength(3);
    });

    it('prependMessages creates array if channel has no messages', () => {
      const state = reducer(undefined, prependMessages({
        channelId: 'ch-new',
        messages: [mockMessage('1', 'ch-new')],
      }));
      expect(state.messagesByChannel['ch-new']).toHaveLength(1);
    });

    it('setHasMore updates hasMoreByChannel', () => {
      let state = reducer(undefined, setHasMore({ channelId: 'ch1', hasMore: false }));
      expect(state.hasMoreByChannel['ch1']).toBe(false);
      state = reducer(state, setHasMore({ channelId: 'ch1', hasMore: true }));
      expect(state.hasMoreByChannel['ch1']).toBe(true);
    });

    it('setLoadingMore updates loadingMoreByChannel', () => {
      let state = reducer(undefined, setLoadingMore({ channelId: 'ch1', loading: true }));
      expect(state.loadingMoreByChannel['ch1']).toBe(true);
      state = reducer(state, setLoadingMore({ channelId: 'ch1', loading: false }));
      expect(state.loadingMoreByChannel['ch1']).toBe(false);
    });
  });
});
