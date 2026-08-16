import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThreadsPanel } from './ThreadsPanel';
import { threadsSlice } from '../../stores/threadsSlice';
import { uiSlice } from '../../stores/uiSlice';
import type { Thread } from '../../stores/threadsSlice';

vi.mock('../../api/rest', () => ({
  api: {
    getActiveThreads: vi.fn().mockResolvedValue({ threads: [], has_more: false }),
  },
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
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
  };
}

function createTestStore(threads: Thread[] = []) {
  const entities: Record<string, Thread> = {};
  const threadsByParent: Record<string, string[]> = {};

  for (const t of threads) {
    entities[t.id] = t;
    if (t.parent_id) {
      const existing = threadsByParent[t.parent_id] ?? [];
      existing.push(t.id);
      threadsByParent[t.parent_id] = existing;
    }
  }

  return configureStore({
    reducer: {
      threads: threadsSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: {
      threads: {
        entities,
        threadsByParent,
        activeThreadsByGuild: {},
        selectedThreadId: null,
        threadsPanelOpen: true,
      },
    },
  });
}

describe('ThreadsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ThreadsPanel channelId="100" />
      </Provider>,
    );
    expect(screen.getByText('Threads')).toBeInTheDocument();
  });

  it('shows empty message when no threads exist', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ThreadsPanel channelId="100" />
      </Provider>,
    );
    expect(screen.getByText('No active threads in this channel.')).toBeInTheDocument();
  });

  it('renders thread items when threads exist', () => {
    const threads = [
      makeThread({ id: '1001', name: 'Thread One', parent_id: '100' }),
      makeThread({ id: '1002', name: 'Thread Two', parent_id: '100' }),
    ];
    const store = createTestStore(threads);
    render(
      <Provider store={store}>
        <ThreadsPanel channelId="100" />
      </Provider>,
    );
    expect(screen.getByText('Thread One')).toBeInTheDocument();
    expect(screen.getByText('Thread Two')).toBeInTheDocument();
  });

  it('does not show archived threads', () => {
    const threads = [
      makeThread({ id: '1001', name: 'Active Thread', parent_id: '100' }),
      makeThread({
        id: '1002',
        name: 'Archived Thread',
        parent_id: '100',
        thread_metadata: {
          archived: true,
          auto_archive_duration: 1440,
          archive_timestamp: '2026-03-24T00:00:00Z',
          locked: false,
          create_timestamp: '2026-03-24T00:00:00Z',
        },
      }),
    ];
    const store = createTestStore(threads);
    render(
      <Provider store={store}>
        <ThreadsPanel channelId="100" />
      </Provider>,
    );
    expect(screen.getByText('Active Thread')).toBeInTheDocument();
    expect(screen.queryByText('Archived Thread')).not.toBeInTheDocument();
  });

  it('dispatches selectThread on thread click', () => {
    const threads = [makeThread({ id: '1001', name: 'Thread One', parent_id: '100' })];
    const store = createTestStore(threads);
    render(
      <Provider store={store}>
        <ThreadsPanel channelId="100" />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Thread One'));
    expect(store.getState().threads.selectedThreadId).toBe('1001');
  });

  it('closes the threads panel (ui slice) on close', () => {
    const store = createTestStore();
    store.dispatch(uiSlice.actions.toggleThreadsPanel()); // open it in ui state
    expect(store.getState().ui.threadsPanelOpen).toBe(true);
    render(
      <Provider store={store}>
        <ThreadsPanel channelId="100" />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Close threads panel'));
    expect(store.getState().ui.threadsPanelOpen).toBe(false);
  });
});
