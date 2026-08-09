import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { MessageAuthor } from './messagesSlice';

export interface SearchResult {
  id: string;
  channel_id: string;
  guild_id: string;
  author: MessageAuthor;
  content: string;
  timestamp: string;
  hit: boolean;
}

export interface SearchFilters {
  content: string;
  authorId: string;
  channelId: string;
  has: string;
  before: string;
  after: string;
}

interface SearchState {
  query: string;
  filters: SearchFilters;
  results: SearchResult[];
  isSearching: boolean;
  isOpen: boolean;
  totalResults: number;
  currentOffset: number;
}

const emptyFilters: SearchFilters = {
  content: '',
  authorId: '',
  channelId: '',
  has: '',
  before: '',
  after: '',
};

const initialState: SearchState = {
  query: '',
  filters: { ...emptyFilters },
  results: [],
  isSearching: false,
  isOpen: false,
  totalResults: 0,
  currentOffset: 0,
};

export const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setQuery: (state, action: PayloadAction<string>) => {
      state.query = action.payload;
    },
    setFilters: (state, action: PayloadAction<Partial<SearchFilters>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    setResults: (state, action: PayloadAction<{
      results: SearchResult[];
      totalResults: number;
    }>) => {
      state.results = action.payload.results;
      state.totalResults = action.payload.totalResults;
    },
    appendResults: (state, action: PayloadAction<{
      results: SearchResult[];
      totalResults: number;
    }>) => {
      state.results = [...state.results, ...action.payload.results];
      state.totalResults = action.payload.totalResults;
    },
    setSearching: (state, action: PayloadAction<boolean>) => {
      state.isSearching = action.payload;
    },
    openSearch: (state) => {
      state.isOpen = true;
    },
    closeSearch: (state) => {
      state.isOpen = false;
      state.query = '';
      state.filters = { ...emptyFilters };
      state.results = [];
      state.totalResults = 0;
      state.currentOffset = 0;
      state.isSearching = false;
    },
    setCurrentOffset: (state, action: PayloadAction<number>) => {
      state.currentOffset = action.payload;
    },
    removeFilter: (state, action: PayloadAction<keyof SearchFilters>) => {
      state.filters[action.payload] = '';
      // Also strip the filter token from the query string so re-searching
      // does not re-add it.
      const prefixMap: Record<keyof SearchFilters, string> = {
        content: '',
        authorId: 'from:',
        channelId: 'in:',
        has: 'has:',
        before: 'before:',
        after: 'after:',
      };
      const prefix = prefixMap[action.payload];
      if (prefix) {
        state.query = state.query.replace(new RegExp(`${prefix}\\S+\\s*`), '').trim();
      }
    },
  },
});

export const {
  setQuery,
  setFilters,
  setResults,
  appendResults,
  setSearching,
  openSearch,
  closeSearch,
  setCurrentOffset,
  removeFilter,
} = searchSlice.actions;
