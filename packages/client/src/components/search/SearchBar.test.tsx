import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { SearchBar } from './SearchBar';
import { searchSlice } from '../../stores/searchSlice';

vi.mock('../../api/rest', () => ({
  api: {
    searchMessages: vi.fn().mockResolvedValue({
      messages: [],
      total_results: 0,
    }),
  },
}));

function createTestStore(searchState?: Partial<ReturnType<typeof searchSlice.getInitialState>>) {
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
        ...searchState,
      },
    },
  });
}

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when open', () => {
    const store = createTestStore({ isOpen: true });
    const { container } = render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    expect(container).toBeTruthy();
  });

  it('renders nothing when not open', () => {
    const store = createTestStore({ isOpen: false });
    const { container } = render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders search input with placeholder', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
  });

  it('renders close button', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    expect(screen.getByLabelText('Close search')).toBeInTheDocument();
  });

  it('closes search when close button is clicked', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    fireEvent.click(screen.getByLabelText('Close search'));
    expect(store.getState().search.isOpen).toBe(false);
  });

  it('closes search on Escape key', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    const input = screen.getByPlaceholderText('Search');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(store.getState().search.isOpen).toBe(false);
  });

  it('has search role and aria-label', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    expect(screen.getByRole('search', { name: 'Message search' })).toBeInTheDocument();
  });

  it('shows filter suggestions when input is focused and empty', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    const input = screen.getByPlaceholderText('Search');
    fireEvent.focus(input);
    expect(screen.getByText('Search Filters')).toBeInTheDocument();
    expect(screen.getByText('from:')).toBeInTheDocument();
    expect(screen.getByText('in:')).toBeInTheDocument();
    expect(screen.getByText('has:')).toBeInTheDocument();
    expect(screen.getByText('before:')).toBeInTheDocument();
    expect(screen.getByText('after:')).toBeInTheDocument();
  });

  it('shows filter descriptions for all filter types', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    const input = screen.getByPlaceholderText('Search');
    fireEvent.focus(input);
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('channel')).toBeInTheDocument();
    expect(screen.getByText('file, link, embed')).toBeInTheDocument();
    // both before: and after: show "date" description
    expect(screen.getAllByText('date')).toHaveLength(2);
  });

  it('inserts filter key into input when suggestion is clicked', () => {
    const store = createTestStore({ isOpen: true });
    render(
      <Provider store={store}>
        <SearchBar guildId="g-1" />
      </Provider>
    );
    const input = screen.getByPlaceholderText('Search');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('from:'));
    expect((input as HTMLInputElement).value).toBe('from:');
  });
});
