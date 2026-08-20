import { useCallback, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  closeSearch,
  appendResults,
  setSearching,
  setCurrentOffset,
  removeFilter,
} from '../../stores/searchSlice';
import type { SearchResult, SearchFilters } from '../../stores/searchSlice';
import { api } from '../../api/rest';
import styles from './searchResults.module.scss';

const formatTimestamp = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 86400000) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 604800000) {
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

export interface SearchResultsProps {
  guildId: string | null;
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}

export const SearchResults = ({ guildId, onJumpToMessage }: SearchResultsProps) => {
  const dispatch = useAppDispatch();
  const results = useAppSelector(s => s.search.results);
  const totalResults = useAppSelector(s => s.search.totalResults);
  const isSearching = useAppSelector(s => s.search.isSearching);
  const isOpen = useAppSelector(s => s.search.isOpen);
  const query = useAppSelector(s => s.search.query);
  const currentOffset = useAppSelector(s => s.search.currentOffset);
  const filters = useAppSelector(s => s.search.filters);

  const handleClose = useCallback(() => {
    dispatch(closeSearch());
  }, [dispatch]);

  const handleJump = useCallback((result: SearchResult) => {
    if (onJumpToMessage) {
      onJumpToMessage(result.channel_id, result.id);
    }
  }, [onJumpToMessage]);

  const handleLoadMore = useCallback(async () => {
    if (!guildId || isSearching) return;

    const newOffset = currentOffset + 25;
    dispatch(setSearching(true));
    dispatch(setCurrentOffset(newOffset));

    try {
      const response = await api.searchMessages(guildId, {
        content: filters.content || undefined,
        author_id: filters.authorId || undefined,
        channel_id: filters.channelId || undefined,
        has: filters.has || undefined,
        before: filters.before || undefined,
        after: filters.after || undefined,
        limit: 25,
        offset: newOffset,
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

      dispatch(appendResults({
        results: flatResults,
        totalResults: response.total_results,
      }));
    } catch {
      // Silently handle error
    } finally {
      dispatch(setSearching(false));
    }
  }, [guildId, isSearching, currentOffset, filters, dispatch]);

  const handleRemoveFilter = useCallback((key: keyof SearchFilters) => {
    dispatch(removeFilter(key));
  }, [dispatch]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof SearchFilters; label: string; value: string }> = [];
    if (filters.authorId) chips.push({ key: 'authorId', label: 'from', value: filters.authorId });
    if (filters.channelId) chips.push({ key: 'channelId', label: 'in', value: filters.channelId });
    if (filters.has) chips.push({ key: 'has', label: 'has', value: filters.has });
    if (filters.before) chips.push({ key: 'before', label: 'before', value: filters.before });
    if (filters.after) chips.push({ key: 'after', label: 'after', value: filters.after });
    return chips;
  }, [filters]);

  if (!isOpen) return null;

  const hasMoreResults = results.length < totalResults;

  return (
    <div className={styles.panel} role="complementary" aria-label="Search results">
      <div className={styles.header}>
        <h3 className={styles.title}>Search Results</h3>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close search results"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
      </div>

      {query && (
        <div className={styles.resultCount}>
          {totalResults > 0
            ? `${totalResults} result${totalResults === 1 ? '' : 's'}`
            : isSearching ? 'Searching...' : 'No results'}
        </div>
      )}

      {activeFilterChips.length > 0 && (
        <div className={styles.activeFilters} role="list" aria-label="Active search filters">
          {activeFilterChips.map(chip => (
            <span key={chip.key} className={styles.filterChip} role="listitem">
              <span className={styles.filterChipLabel}>{chip.label}:</span>
              <span className={styles.filterChipValue}>{chip.value}</span>
              <button
                type="button"
                className={styles.filterChipRemove}
                onClick={() => handleRemoveFilter(chip.key)}
                aria-label={`Remove ${chip.label} filter`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.resultsList}>
        {results.map(result => (
          <button
            key={result.id}
            className={styles.resultItem}
            onClick={() => handleJump(result)}
            type="button"
          >
            <div className={styles.resultMeta}>
              <span className={styles.channelName}>#{result.channel_id}</span>
              <span className={styles.resultTimestamp}>{formatTimestamp(result.timestamp)}</span>
            </div>
            <div className={styles.resultMessage}>
              <div className={styles.resultAvatar}>
                {result.author.username.charAt(0).toUpperCase()}
              </div>
              <div className={styles.resultBody}>
                <span className={styles.resultAuthor}>{result.author.username}</span>
                <div className={styles.resultContent}>{result.content}</div>
              </div>
            </div>
          </button>
        ))}

        {isSearching && results.length > 0 && (
          <div className={styles.loadingMore} role="status">
            Loading more results...
          </div>
        )}

        {hasMoreResults && !isSearching && (
          <button
            className={styles.loadMoreButton}
            onClick={() => { void handleLoadMore(); }}
            type="button"
          >
            Load more results
          </button>
        )}

        {!isSearching && results.length === 0 && query && (
          <div className={styles.noResults}>
            <div className={styles.noResultsIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z" />
              </svg>
            </div>
            <div className={styles.noResultsText}>
              No results found for your search.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
