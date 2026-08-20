import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { SearchResults } from './SearchResults';
import { searchSlice } from '../../stores/searchSlice';
import type { SearchResult } from '../../stores/searchSlice';

vi.mock('../../api/rest', () => ({
  api: {
    searchMessages: vi.fn().mockResolvedValue({
      messages: [],
      total_results: 0,
    }),
  },
}));

function makeResult(id: string, content = 'test message'): SearchResult {
  return {
    id,
    channel_id: 'ch-1',
    guild_id: 'g-1',
    author: { id: 'u-1', username: 'Alice', avatar: null },
    content,
    timestamp: '2026-01-01T00:00:00Z',
    hit: true,
  };
}

function createTestStore(overrides?: Partial<ReturnType<typeof searchSlice.getInitialState>>) {
  return configureStore({
    reducer: {
      search: searchSlice.reducer,
    },
    preloadedState: {
      search: {
        query: '',
        filters: {
          content: '',
          authorId: '',
          channelId: '',
          has: '',
          before: '',
          after: '',
        },
        results: [],
        isSearching: false,
        isOpen: true,
        totalResults: 0,
        currentOffset: 0,
        ...overrides,
      },
    },
  });
}

describe('SearchResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when open', () => {
    const store = createTestStore({ isOpen: true });
    const { container } = render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(container).toBeTruthy();
  });

  it('renders nothing when not open', () => {
    const store = createTestStore({ isOpen: false });
    const { container } = render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders header with title', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('Search Results')).toBeInTheDocument();
  });

  it('displays result count', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'test',
      results: [makeResult('1')],
      totalResults: 1,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('displays plural result count', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'test',
      results: [makeResult('1'), makeResult('2')],
      totalResults: 2,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('2 results')).toBeInTheDocument();
  });

  it('displays no results message', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'nonexistent',
      results: [],
      totalResults: 0,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('No results found for your search.')).toBeInTheDocument();
  });

  it('renders result items with author name', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'test',
      results: [makeResult('1', 'Hello world')],
      totalResults: 1,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('calls onJumpToMessage when result is clicked', () => {
    const onJump = vi.fn();
    const store = createTestStore({
      isOpen: true,
      query: 'test',
      results: [makeResult('msg-1', 'Hello')],
      totalResults: 1,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" onJumpToMessage={onJump} />
      </Provider>
    );
    fireEvent.click(screen.getByText('Hello'));
    expect(onJump).toHaveBeenCalledWith('ch-1', 'msg-1');
  });

  it('closes search when close button is clicked', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    fireEvent.click(screen.getByLabelText('Close search results'));
    expect(store.getState().search.isOpen).toBe(false);
  });

  it('has complementary role with aria-label', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByRole('complementary', { name: 'Search results' })).toBeInTheDocument();
  });

  it('shows load more button when there are more results', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'test',
      results: [makeResult('1')],
      totalResults: 50,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('Load more results')).toBeInTheDocument();
  });

  it('does not show load more when all results loaded', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'test',
      results: [makeResult('1')],
      totalResults: 1,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.queryByText('Load more results')).toBeNull();
  });

  it('displays active filter chips when filters are set', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'from:Alice has:link test',
      filters: {
        content: 'test',
        authorId: 'Alice',
        channelId: '',
        has: 'link',
        before: '',
        after: '',
      },
      results: [],
      totalResults: 0,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('link')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove from filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove has filter')).toBeInTheDocument();
  });

  it('removes filter chip when remove button is clicked', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'from:Alice test',
      filters: {
        content: 'test',
        authorId: 'Alice',
        channelId: '',
        has: '',
        before: '',
        after: '',
      },
      results: [],
      totalResults: 0,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    fireEvent.click(screen.getByLabelText('Remove from filter'));
    expect(store.getState().search.filters.authorId).toBe('');
  });

  it('does not show filter chips when no filters are active', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'plain search',
      filters: {
        content: 'plain search',
        authorId: '',
        channelId: '',
        has: '',
        before: '',
        after: '',
      },
      results: [],
      totalResults: 0,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.queryByRole('list', { name: 'Active search filters' })).toBeNull();
  });

  it('displays before and after date filter chips', () => {
    const store = createTestStore({
      isOpen: true,
      query: 'before:2026-01-01 after:2025-06-01',
      filters: {
        content: '',
        authorId: '',
        channelId: '',
        has: '',
        before: '2026-01-01',
        after: '2025-06-01',
      },
      results: [],
      totalResults: 0,
    });
    render(
      <Provider store={store}>
        <SearchResults guildId="g-1" />
      </Provider>
    );
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    expect(screen.getByText('2025-06-01')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove before filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove after filter')).toBeInTheDocument();
  });
});
