import { describe, it, expect } from 'vitest';
import {
  uiSlice,
  setReplyingToMessageId,
  setEditingMessageId,
  toggleInboxPanel,
  closeInboxPanel,
  setInboxPanelTab,
} from './uiSlice';

const { reducer } = uiSlice;

describe('uiSlice', () => {
  describe('setReplyingToMessageId', () => {
    it('sets the replying message id', () => {
      const state = reducer(undefined, setReplyingToMessageId('msg1'));
      expect(state.replyingToMessageId).toBe('msg1');
    });

    it('clears editing when starting a reply', () => {
      let state = reducer(undefined, setEditingMessageId('msg1'));
      expect(state.editingMessageId).toBe('msg1');
      state = reducer(state, setReplyingToMessageId('msg2'));
      expect(state.replyingToMessageId).toBe('msg2');
      expect(state.editingMessageId).toBeNull();
    });

    it('clears the replying message id with null', () => {
      let state = reducer(undefined, setReplyingToMessageId('msg1'));
      state = reducer(state, setReplyingToMessageId(null));
      expect(state.replyingToMessageId).toBeNull();
    });
  });

  describe('setEditingMessageId', () => {
    it('sets the editing message id', () => {
      const state = reducer(undefined, setEditingMessageId('msg1'));
      expect(state.editingMessageId).toBe('msg1');
    });

    it('clears replying when starting an edit', () => {
      let state = reducer(undefined, setReplyingToMessageId('msg1'));
      expect(state.replyingToMessageId).toBe('msg1');
      state = reducer(state, setEditingMessageId('msg2'));
      expect(state.editingMessageId).toBe('msg2');
      expect(state.replyingToMessageId).toBeNull();
    });

    it('clears the editing message id with null', () => {
      let state = reducer(undefined, setEditingMessageId('msg1'));
      state = reducer(state, setEditingMessageId(null));
      expect(state.editingMessageId).toBeNull();
    });
  });

  describe('inbox panel', () => {
    it('toggles inbox panel open', () => {
      const state = reducer(undefined, toggleInboxPanel());
      expect(state.inboxPanelOpen).toBe(true);
    });

    it('toggles inbox panel closed', () => {
      let state = reducer(undefined, toggleInboxPanel());
      state = reducer(state, toggleInboxPanel());
      expect(state.inboxPanelOpen).toBe(false);
    });

    it('closes inbox panel', () => {
      let state = reducer(undefined, toggleInboxPanel());
      state = reducer(state, closeInboxPanel());
      expect(state.inboxPanelOpen).toBe(false);
    });

    it('sets inbox panel tab', () => {
      const state = reducer(undefined, setInboxPanelTab('unreads'));
      expect(state.inboxPanelTab).toBe('unreads');
    });

    it('defaults to forYou tab', () => {
      const state = reducer(undefined, { type: 'init' });
      expect(state.inboxPanelTab).toBe('forYou');
    });
  });
});
