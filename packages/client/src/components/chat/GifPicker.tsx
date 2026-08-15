import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './gifPicker.module.scss';

// GIF search is powered by GIPHY. Get a free API key at https://developers.giphy.com
// and set VITE_GIPHY_API_KEY. Without a key the picker shows a friendly prompt.
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyResult {
  id: string;
  title: string;
  images: {
    original: GiphyImage;
    fixed_width: GiphyImage;
  };
}

interface GiphyResponse {
  data: GiphyResult[];
  meta: { status: number; msg: string };
}

export interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export const GifPicker = ({ onSelect, onClose }: GifPickerProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGifs = useCallback(async (searchQuery: string) => {
    setIsLoading(true);
    setError(null);
    const apiKey = import.meta.env.VITE_GIPHY_API_KEY || '';
    if (!apiKey) {
      setError('GIF search needs a free GIPHY API key. Set VITE_GIPHY_API_KEY (get one at developers.giphy.com).');
      setResults([]);
      setIsLoading(false);
      return;
    }
    try {
      const q = searchQuery.trim();
      const url = q
        ? `${GIPHY_BASE}/search?api_key=${apiKey}&limit=20&rating=pg-13&q=${encodeURIComponent(q)}`
        : `${GIPHY_BASE}/trending?api_key=${apiKey}&limit=20&rating=pg-13`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`GIPHY API error: ${String(res.status)}`);
      }
      const data: GiphyResponse = await res.json() as GiphyResponse;
      setResults(data.data);
    } catch {
      setError('Failed to load GIFs. Please try again.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load trending on mount
  useEffect(() => {
    void fetchGifs('');
  }, [fetchGifs]);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void fetchGifs(value);
    }, 300);
  }, [fetchGifs]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleGifClick = useCallback((gif: GiphyResult) => {
    const fullUrl = gif.images.original.url;
    onSelect(fullUrl);
    onClose();
  }, [onSelect, onClose]);

  return (
    <div
      className={styles.gifPicker}
      ref={containerRef}
      role="dialog"
      aria-label="GIF picker"
    >
      <div className={styles.header}>
        <div className={styles.searchWrapper}>
          <svg
            className={styles.searchIcon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z"
            />
          </svg>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Search GIPHY"
            value={query}
            onChange={handleSearchChange}
            aria-label="Search GIFs"
          />
          {query && (
            <button
              className={styles.clearButton}
              onClick={() => {
                setQuery('');
                void fetchGifs('');
                searchInputRef.current?.focus();
              }}
              type="button"
              aria-label="Clear search"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className={styles.content}>
        {isLoading && (
          <div className={styles.loadingState}>
            <div className={styles.skeletonGrid}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={`skeleton-${String(i)}`} className={styles.skeletonItem} />
              ))}
            </div>
          </div>
        )}

        {error && !isLoading && (
          <div className={styles.errorState}>
            <span className={styles.errorText}>{error}</span>
            <button
              className={styles.retryButton}
              onClick={() => void fetchGifs(query)}
              type="button"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && results.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyText}>No GIFs found</span>
          </div>
        )}

        {!isLoading && !error && results.length > 0 && (
          <div className={styles.gifGrid} role="listbox" aria-label="GIF results">
            {results.map((gif) => (
              <button
                key={gif.id}
                className={styles.gifItem}
                onClick={() => handleGifClick(gif)}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={gif.title || 'GIF'}
              >
                <img
                  src={gif.images.fixed_width.url}
                  alt={gif.title || 'GIF'}
                  className={styles.gifImage}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.gifBranding}>Powered by GIPHY</span>
      </div>
    </div>
  );
};
