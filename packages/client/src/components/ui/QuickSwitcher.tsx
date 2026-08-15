import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { closeQuickSwitcher } from '../../stores/uiSlice';
import { selectChannel } from '../../stores/channelsSlice';
import { selectGuild } from '../../stores/guildsSlice';
import { selectDmChannel } from '../../stores/dmSlice';
import { addChannel } from '../../stores/channelsSlice';
import { markRead } from '../../stores/notificationsSlice';
import styles from './quickSwitcher.module.scss';

interface QuickSwitcherResult {
  id: string;
  type: 'channel' | 'dm' | 'guild';
  name: string;
  icon: string;
  subtitle: string;
  guildId: string | null;
  channelId: string | null;
}

export interface QuickSwitcherProps {
  /** No external props needed; reads state from Redux */
}

export const QuickSwitcher = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isOpen = useAppSelector(s => s.ui.quickSwitcherOpen);
  const channels = useAppSelector(s => s.channels.channels);
  const guilds = useAppSelector(s => s.guilds.guilds);
  const dmChannels = useAppSelector(s => s.dm.dmChannels);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build the searchable results list
  const allResults = useMemo((): QuickSwitcherResult[] => {
    const results: QuickSwitcherResult[] = [];

    // Add DM channels
    for (const dm of dmChannels) {
      const recipient = dm.recipients[0];
      if (!recipient) continue;
      results.push({
        id: `dm-${dm.id}`,
        type: 'dm',
        name: recipient.username,
        icon: '@',
        subtitle: 'Direct Message',
        guildId: null,
        channelId: dm.id,
      });
    }

    // Add guild channels
    for (const channel of Object.values(channels)) {
      if (!channel.guild_id || !channel.name) continue;
      // Only text-like channels (type 0 = text, 5 = announcement)
      if (channel.type !== 0 && channel.type !== 5) continue;
      const guild = guilds[channel.guild_id];
      if (!guild) continue;
      results.push({
        id: `channel-${channel.id}`,
        type: 'channel',
        name: channel.name,
        icon: '#',
        subtitle: guild.name,
        guildId: channel.guild_id,
        channelId: channel.id,
      });
    }

    // Add guilds/servers
    for (const guild of Object.values(guilds)) {
      results.push({
        id: `guild-${guild.id}`,
        type: 'guild',
        name: guild.name,
        icon: '*',
        subtitle: 'Server',
        guildId: guild.id,
        channelId: null,
      });
    }

    return results;
  }, [channels, guilds, dmChannels]);

  // Filter results based on query
  const filteredResults = useMemo((): QuickSwitcherResult[] => {
    if (!query.trim()) {
      // Show recent DMs first when no query
      return allResults.slice(0, 10);
    }

    const lowerQuery = query.toLowerCase().trim();

    return allResults
      .filter(r => {
        const nameMatch = r.name.toLowerCase().includes(lowerQuery);
        const subtitleMatch = r.subtitle.toLowerCase().includes(lowerQuery);
        return nameMatch || subtitleMatch;
      })
      .slice(0, 20);
  }, [query, allResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredResults.length]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Use a small delay so the DOM has rendered
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedItem = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result: QuickSwitcherResult) => {
    dispatch(closeQuickSwitcher());

    switch (result.type) {
      case 'dm': {
        if (!result.channelId) break;
        const dm = dmChannels.find(d => d.id === result.channelId);
        if (dm) {
          dispatch(addChannel({
            id: dm.id,
            guild_id: null,
            type: dm.type,
            name: dm.recipients[0]?.username ?? 'Direct Message',
            topic: null,
            position: 0,
            parent_id: null,
          }));
        }
        dispatch(selectDmChannel(result.channelId));
        dispatch(selectChannel(result.channelId));
        dispatch(markRead(result.channelId));
        navigate(`/channels/@me/${result.channelId}`);
        break;
      }
      case 'channel': {
        if (!result.channelId || !result.guildId) break;
        dispatch(selectGuild(result.guildId));
        dispatch(selectChannel(result.channelId));
        dispatch(markRead(result.channelId));
        navigate(`/channels/${result.guildId}/${result.channelId}`);
        break;
      }
      case 'guild': {
        if (!result.guildId) break;
        dispatch(selectGuild(result.guildId));
        navigate(`/channels/${result.guildId}`);
        break;
      }
    }
  }, [dispatch, navigate, dmChannels]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredResults.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : filteredResults.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredResults[selectedIndex]) {
          handleSelect(filteredResults[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        dispatch(closeQuickSwitcher());
        break;
    }
  }, [filteredResults, selectedIndex, handleSelect, dispatch]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      dispatch(closeQuickSwitcher());
    }
  }, [dispatch]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Quick Switcher"
    >
      <div className={styles.modal}>
        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Where would you like to go?"
            aria-label="Quick Switcher search"
            aria-activedescendant={
              filteredResults[selectedIndex]
                ? `qs-result-${filteredResults[selectedIndex].id}`
                : undefined
            }
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-switcher-results"
            aria-autocomplete="list"
          />
        </div>

        <div
          className={styles.results}
          ref={listRef}
          id="quick-switcher-results"
          role="listbox"
          aria-label="Search results"
        >
          {filteredResults.length === 0 ? (
            <div className={styles.noResults}>
              No results found.
            </div>
          ) : (
            filteredResults.map((result, index) => (
              <div
                key={result.id}
                id={`qs-result-${result.id}`}
                className={`${styles.resultItem} ${index === selectedIndex ? styles.resultItemSelected : ''}`}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelectedIndex(index)}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <span className={styles.resultIcon} aria-hidden="true">
                  {result.icon}
                </span>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>{result.name}</span>
                  <span className={styles.resultSubtitle}>{result.subtitle}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerTip}>
            <kbd className={styles.kbd}>&#8593;</kbd>
            <kbd className={styles.kbd}>&#8595;</kbd>
            to navigate
          </span>
          <span className={styles.footerTip}>
            <kbd className={styles.kbd}>Enter</kbd>
            to select
          </span>
          <span className={styles.footerTip}>
            <kbd className={styles.kbd}>Esc</kbd>
            to dismiss
          </span>
        </div>
      </div>
    </div>
  );
};
