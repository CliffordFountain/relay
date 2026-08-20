import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  setQuery,
  setFilters,
  setResults,
  setSearching,
  closeSearch,
  setCurrentOffset,
} from '../../stores/searchSlice';
import type { SearchFilters, SearchResult } from '../../stores/searchSlice';
import { api } from '../../api/rest';
import styles from './searchBar.module.scss';

const FILTER_SUGGESTIONS = [
  { key: 'from:', description: 'user' },
  { key: 'in:', description: 'channel' },
  { key: 'has:', description: 'file, link, embed' },
  { key: 'before:', description: 'date' },
  { key: 'after:', description: 'date' },
] as const;

interface ParsedQuery {
  content: string;
  filters: Partial<SearchFilters>;
}

const parseSearchQuery = (raw: string): ParsedQuery => {
  const filters: Partial<SearchFilters> = {};
  let content = raw;

  const fromMatch = content.match(/from:(\S+)/);
  if (fromMatch?.[1]) {
    filters.authorId = fromMatch[1];
    content = content.replace(fromMatch[0], '').trim();
  }

  const inMatch = content.match(/in:(\S+)/);
  if (inMatch?.[1]) {
    filters.channelId = inMatch[1];
    content = content.replace(inMatch[0], '').trim();
  }

  const hasMatch = content.match(/has:(\S+)/);
  if (hasMatch?.[1]) {
    filters.has = hasMatch[1];
    content = content.replace(hasMatch[0], '').trim();
  }

  const beforeMatch = content.match(/before:(\S+)/);
  if (beforeMatch?.[1]) {
    filters.before = beforeMatch[1];
    content = content.replace(beforeMatch[0], '').trim();
  }

  const afterMatch = content.match(/after:(\S+)/);
  if (afterMatch?.[1]) {
    filters.after = afterMatch[1];
    content = content.replace(afterMatch[0], '').trim();
  }

  return { content: content.trim(), filters };
};

export interface SearchBarProps {
  guildId: string | null;
}

export const SearchBar = ({ guildId }: SearchBarProps) => {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector(s => s.search.isOpen);
  const query = useAppSelector(s => s.search.query);
  const isSearching = useAppSelector(s => s.search.isSearching);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setInputValue(query);
    } else {
      setInputValue('');
    }
  }, [isOpen, query]);

  const executeSearch = useCallback(async (searchQuery: string) => {
    if (!guildId || !searchQuery.trim()) return;

    dispatch(setSearching(true));
    dispatch(setCurrentOffset(0));

    const parsed = parseSearchQuery(searchQuery);
    dispatch(setQuery(searchQuery));
    dispatch(setFilters(parsed.filters));

    try {
      const response = await api.searchMessages(guildId, {
        content: parsed.content || undefined,
        author_id: parsed.filters.authorId || undefined,
        channel_id: parsed.filters.channelId || undefined,
        has: parsed.filters.has || undefined,
        before: parsed.filters.before || undefined,
        after: parsed.filters.after || undefined,
        limit: 25,
        offset: 0,
      });

      const flatResults: SearchResult[] = response.messages.flatMap(group =>
        group.map(msg => ({
          id: msg.id,
          channel_id: msg.channel_id,
          guild_id: msg.guild_id,
          author: msg.author,
          content: msg.content,
          timestamp: msg.timestamp,
          hit: msg.hit,
        }))
      );

      dispatch(setResults({
        results: flatResults,
        totalResults: response.total_results,
      }));
    } catch {
      dispatch(setResults({ results: [], totalResults: 0 }));
    } finally {
      dispatch(setSearching(false));
    }
  }, [guildId, dispatch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setShowSuggestions(false);
      void executeSearch(inputValue);
    } else if (e.key === 'Escape') {
      dispatch(closeSearch());
    }
  }, [inputValue, executeSearch, dispatch]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);

    // Show suggestions when user types a colon or just started typing
    const lastWord = value.split(' ').pop() ?? '';
    setShowSuggestions(lastWord.length > 0 && !lastWord.includes(':'));
  }, []);

  const handleFilterClick = useCallback((filterKey: string) => {
    const newValue = inputValue + filterKey;
    setInputValue(newValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [inputValue]);

  const handleClose = useCallback(() => {
    dispatch(closeSearch());
  }, [dispatch]);

  if (!isOpen) return null;

  return (
    <div className={styles.container} role="search" aria-label="Message search">
      <div className={styles.inputWrapper}>
        <svg
          className={styles.searchIcon}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z" />
        </svg>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder="Search"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Delay to allow click on suggestions
            setTimeout(() => setShowSuggestions(false), 200);
          }}
          aria-label="Search messages"
        />
        {isSearching && (
          <div className={styles.spinner} role="status" aria-label="Searching" />
        )}
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close search"
          title="Close search"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
      </div>

      {showSuggestions && inputValue.length === 0 && (
        <div className={styles.suggestions} role="listbox" aria-label="Search filters">
          <div className={styles.suggestionsHeader}>Search Filters</div>
          {FILTER_SUGGESTIONS.map(filter => (
            <button
              key={filter.key}
              className={styles.suggestion}
              onClick={() => handleFilterClick(filter.key)}
              role="option"
              aria-selected={false}
              type="button"
            >
              <span className={styles.filterKey}>{filter.key}</span>
              <span className={styles.filterDesc}>{filter.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
