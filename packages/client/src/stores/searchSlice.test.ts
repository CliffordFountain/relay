import { describe, it, expect } from 'vitest';
import { searchSlice, openSearch, closeSearch, setQuery, setResults, setSearching, appendResults, setCurrentOffset, setFilters } from './searchSlice';
import type { SearchResult } from './searchSlice';

const { reducer } = searchSlice;

function makeResult(id: string): SearchResult {
  return {
    id,
    channel_id: 'ch-1',
    guild_id: 'g-1',
    author: { id: 'u-1', username: 'Alice', avatar: null },
    content: 'test message',
    timestamp: '2026-01-01T00:00:00Z',
    hit: true,
  };
}

describe('searchSlice', () => {
  it('has correct initial state', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.isOpen).toBe(false);
    expect(state.query).toBe('');
    expect(state.results).toEqual([]);
    expect(state.isSearching).toBe(false);
    expect(state.totalResults).toBe(0);
    expect(state.currentOffset).toBe(0);
  });

  it('openSearch sets isOpen to true', () => {
    const state = reducer(undefined, openSearch());
    expect(state.isOpen).toBe(true);
  });

  it('closeSearch resets all state', () => {
    let state = reducer(undefined, openSearch());
    state = reducer(state, setQuery('hello'));
    state = reducer(state, setResults({ results: [makeResult('1')], totalResults: 1 }));
    state = reducer(state, closeSearch());
    expect(state.isOpen).toBe(false);
    expect(state.query).toBe('');
    expect(state.results).toEqual([]);
    expect(state.totalResults).toBe(0);
    expect(state.isSearching).toBe(false);
  });

  it('setQuery updates query', () => {
    const state = reducer(undefined, setQuery('test query'));
    expect(state.query).toBe('test query');
  });

  it('setResults replaces results and total', () => {
    const results = [makeResult('1'), makeResult('2')];
    const state = reducer(undefined, setResults({ results, totalResults: 50 }));
    expect(state.results).toHaveLength(2);
    expect(state.totalResults).toBe(50);
  });

  it('appendResults appends to existing results', () => {
    let state = reducer(undefined, setResults({ results: [makeResult('1')], totalResults: 50 }));
    state = reducer(state, appendResults({ results: [makeResult('2')], totalResults: 50 }));
    expect(state.results).toHaveLength(2);
    expect(state.results[0]?.id).toBe('1');
    expect(state.results[1]?.id).toBe('2');
  });

  it('setSearching updates isSearching', () => {
    let state = reducer(undefined, setSearching(true));
    expect(state.isSearching).toBe(true);
    state = reducer(state, setSearching(false));
    expect(state.isSearching).toBe(false);
  });

  it('setCurrentOffset updates offset', () => {
    const state = reducer(undefined, setCurrentOffset(25));
    expect(state.currentOffset).toBe(25);
  });

  it('setFilters partially updates filters', () => {
    let state = reducer(undefined, setFilters({ content: 'hello' }));
    expect(state.filters.content).toBe('hello');
    expect(state.filters.authorId).toBe('');

    state = reducer(state, setFilters({ authorId: 'user-123' }));
    expect(state.filters.content).toBe('hello');
    expect(state.filters.authorId).toBe('user-123');
  });
});
