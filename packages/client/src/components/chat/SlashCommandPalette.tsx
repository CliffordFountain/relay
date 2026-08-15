import { useCallback, useEffect, useRef, useMemo } from 'react';
import styles from './slashCommandPalette.module.scss';

export interface SlashCommand {
  name: string;
  description: string;
  /** If the command takes a parameter, its placeholder label */
  paramLabel?: string;
}

export const BUILT_IN_COMMANDS: SlashCommand[] = [
  { name: 'giphy', description: 'Search for a GIF from Giphy', paramLabel: 'query' },
  { name: 'shrug', description: 'Appends \u00AF\\_(\u30C4)_/\u00AF to your message' },
  { name: 'tableflip', description: 'Appends (\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B to your message' },
  { name: 'unflip', description: 'Appends \u252C\u2500\u252C \u30CE( \u309C-\u309C\u30CE) to your message' },
  { name: 'spoiler', description: 'Wraps your message in a spoiler tag', paramLabel: 'text' },
  { name: 'me', description: 'Sends an italic action message', paramLabel: 'action' },
];

export interface SlashCommandPaletteProps {
  query: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

export const SlashCommandPalette = ({
  query,
  selectedIndex,
  onSelect,
  onHover,
}: SlashCommandPaletteProps) => {
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return BUILT_IN_COMMANDS.filter(cmd => cmd.name.startsWith(q));
  }, [query]);

  // Scroll the selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleClick = useCallback(
    (cmd: SlashCommand) => {
      onSelect(cmd);
    },
    [onSelect],
  );

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div
      className={styles.palette}
      role="listbox"
      aria-label="Slash commands"
      ref={listRef}
    >
      <div className={styles.header}>
        <span className={styles.headerLabel}>Commands</span>
      </div>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ''}`}
          role="option"
          aria-selected={i === selectedIndex}
          data-index={i}
          onClick={() => handleClick(cmd)}
          onMouseEnter={() => onHover(i)}
          type="button"
        >
          <div className={styles.commandIcon} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 3l3.057-3 11.943 12-11.943 12-3.057-3 9-9z" transform="rotate(-90 12 12)" />
            </svg>
          </div>
          <div className={styles.commandInfo}>
            <span className={styles.commandName}>/{cmd.name}</span>
            {cmd.paramLabel && (
              <span className={styles.commandParam}>[{cmd.paramLabel}]</span>
            )}
            <span className={styles.commandDesc}>{cmd.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
};
