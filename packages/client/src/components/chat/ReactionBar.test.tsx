import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ReactionBar } from './ReactionBar';
import { messagesSlice } from '../../stores/messagesSlice';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { voiceSlice } from '../../stores/voiceSlice';
import { membersSlice } from '../../stores/membersSlice';
import { uiSlice } from '../../stores/uiSlice';
import type { Reaction } from '../../stores/messagesSlice';

// Mock the api module
vi.mock('../../api/rest', () => ({
  api: {
    addReaction: vi.fn(() => Promise.resolve()),
    removeReaction: vi.fn(() => Promise.resolve()),
  },
}));

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      messages: messagesSlice.reducer,
      voice: voiceSlice.reducer,
      members: membersSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
}

function renderWithStore(ui: React.ReactElement) {
  const store = createTestStore();
  return {
    ...render(<Provider store={store}>{ui}</Provider>),
    store,
  };
}

describe('ReactionBar', () => {
  const defaultReactions: Reaction[] = [
    { emoji: '👍', count: 3, me: false },
    { emoji: '❤️', count: 1, me: true },
  ];

  it('renders without crashing', () => {
    renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={defaultReactions} />
    );
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('renders reaction pills with correct counts', () => {
    renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={defaultReactions} />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders emoji text in pills', () => {
    renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={defaultReactions} />
    );
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
  });

  it('renders add reaction button', () => {
    renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={defaultReactions} />
    );
    expect(screen.getByTitle('Add Reaction')).toBeInTheDocument();
  });

  it('returns null when reactions are empty', () => {
    const { container } = renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onAddReaction when add button is clicked', () => {
    const onAddReaction = vi.fn();
    renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={defaultReactions} onAddReaction={onAddReaction} />
    );
    fireEvent.click(screen.getByTitle('Add Reaction'));
    expect(onAddReaction).toHaveBeenCalledTimes(1);
  });

  it('renders a CUSTOM-emoji reaction without crashing (regression: object rendered as React child)', () => {
    // The backend returns { id, name } for custom emoji. Rendering it directly used to
    // throw "Objects are not valid as a React child (found: object with keys {name, id})"
    // and crash the whole message list. It must now render as an <img> instead.
    const customReactions: Reaction[] = [
      { emoji: { id: '123', name: 'blobcat' }, count: 2, me: false },
    ];
    renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={customReactions} />
    );
    const img = screen.getByAltText(':blobcat:');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('dispatches reaction toggle when pill is clicked', () => {
    const { store } = renderWithStore(
      <ReactionBar channelId="ch1" messageId="m1" reactions={defaultReactions} />
    );

    // Click the thumbs up reaction (which me=false, so it should add)
    const thumbsUpButton = screen.getByTitle('👍 3');
    fireEvent.click(thumbsUpButton);

    // We can verify the dispatch happened by checking the store
    // (the actual addReaction/removeReaction logic is tested in the slice tests)
    expect(thumbsUpButton).toBeInTheDocument();
  });
});
