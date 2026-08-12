import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setPresenceStatus, setCustomStatus as setCustomStatusAction, setCustomStatusEmoji, setCustomStatusClearAt, type PresenceStatus } from '../../stores/authSlice';
import { setSelfStatus, setPresence } from '../../stores/presenceSlice';
import { gateway } from '../../api/gateway';
import styles from './statusSelector.module.scss';

interface StatusOption {
  status: PresenceStatus;
  label: string;
  description: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { status: 'online', label: 'Online', description: '' },
  { status: 'idle', label: 'Idle', description: '' },
  { status: 'dnd', label: 'Do Not Disturb', description: 'You will not receive desktop notifications.' },
  { status: 'invisible', label: 'Invisible', description: 'You will appear offline.' },
];

export interface StatusSelectorProps {
  anchorRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

interface ClearAfterOption {
  label: string;
  durationMs: number | null; // null = don't clear
}

const CLEAR_AFTER_OPTIONS: ClearAfterOption[] = [
  { label: "Don't clear", durationMs: null },
  { label: '30 minutes', durationMs: 30 * 60 * 1000 },
  { label: '1 hour', durationMs: 60 * 60 * 1000 },
  { label: '4 hours', durationMs: 4 * 60 * 60 * 1000 },
  { label: 'Today', durationMs: -1 }, // Special: clear at end of day
];

const COMMON_EMOJI = [
  '\u{1F600}', '\u{1F60A}', '\u{1F60E}', '\u{1F914}', '\u{1F634}',
  '\u{1F6AB}', '\u{1F3E0}', '\u{1F4BB}', '\u{1F3AE}', '\u{1F3B5}',
  '\u{2615}', '\u{1F4DA}', '\u{1F4F1}', '\u{2708}\uFE0F', '\u{1F525}',
  '\u{2764}\uFE0F', '\u{1F389}', '\u{1F4A4}', '\u{1F44D}', '\u{1F937}',
];

export const StatusSelector = ({ anchorRef, onClose }: StatusSelectorProps) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(s => s.auth.user);
  const currentStatus = useAppSelector(s => s.auth.status);
  const savedCustomStatus = useAppSelector(s => s.auth.customStatus);
  const savedCustomEmoji = useAppSelector(s => s.auth.customStatusEmoji);
  const [customStatus, setCustomStatus] = useState(savedCustomStatus ?? '');
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(savedCustomEmoji ?? null);
  const [showEmojiGrid, setShowEmojiGrid] = useState(false);
  const [clearAfterIndex, setClearAfterIndex] = useState(0); // Index into CLEAR_AFTER_OPTIONS
  const [popupPosition, setPopupPosition] = useState<{ bottom: number; left: number }>({
    bottom: 0,
    left: 0,
  });

  // Position the popup above the anchor
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPopupPosition({
        bottom: window.innerHeight - rect.top + 4,
        left: rect.left,
      });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    // Defer the listener to avoid closing immediately on the same click
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose, anchorRef]);

  const handleSelectStatus = (status: PresenceStatus) => {
    dispatch(setPresenceStatus(status));
    dispatch(setSelfStatus(status));
    gateway.sendPresenceUpdate(status, savedCustomStatus);

    // Update the presences map so the member list reflects the change immediately.
    // 'invisible' appears as 'offline' to others (the behavior).
    if (currentUser?.id) {
      const mappedStatus = status === 'invisible' ? 'offline' : status;
      dispatch(setPresence({
        userId: currentUser.id,
        status: mappedStatus as 'online' | 'idle' | 'dnd' | 'offline',
        clientStatus: status !== 'invisible' ? { web: status as 'online' | 'idle' | 'dnd' } : {},
        activities: [],
      }));
    }

    onClose();
  };

  const handleSetCustomStatus = () => {
    const trimmed = customStatus.trim();
    const newCustomStatus = trimmed.length > 0 ? trimmed : null;
    dispatch(setCustomStatusAction(newCustomStatus));
    dispatch(setCustomStatusEmoji(selectedEmoji));

    // Calculate clear-at time
    const clearOption = CLEAR_AFTER_OPTIONS[clearAfterIndex];
    let clearAt: number | null = null;
    if (clearOption && clearOption.durationMs !== null && (newCustomStatus || selectedEmoji)) {
      if (clearOption.durationMs === -1) {
        // End of today
        const now = new Date();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        clearAt = endOfDay.getTime();
      } else {
        clearAt = Date.now() + clearOption.durationMs;
      }
    }
    dispatch(setCustomStatusClearAt(clearAt));

    gateway.sendPresenceUpdate(currentStatus, newCustomStatus);
    onClose();
  };

  const statusDotClass = (status: PresenceStatus): string => {
    switch (status) {
      case 'online':
        return styles.dotOnline ?? '';
      case 'idle':
        return styles.dotIdle ?? '';
      case 'dnd':
        return styles.dotDnd ?? '';
      case 'invisible':
        return styles.dotInvisible ?? '';
    }
  };

  return createPortal(
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ bottom: popupPosition.bottom, left: popupPosition.left }}
      role="menu"
      aria-label="Set status"
    >
      {/* Custom status section */}
      <div className={styles.customStatusSection}>
        <div className={styles.customStatusHeader}>Set Custom Status</div>
        <div className={styles.customStatusInputRow}>
          <button
            className={styles.emojiBtn}
            onClick={() => setShowEmojiGrid(prev => !prev)}
            title="Select emoji"
            aria-label="Select status emoji"
            type="button"
          >
            {selectedEmoji ?? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm3.5-9c.828 0 1.5-.672 1.5-1.5S16.328 8 15.5 8 14 8.672 14 9.5s.672 1.5 1.5 1.5zm-7 0c.828 0 1.5-.672 1.5-1.5S9.328 8 8.5 8 7 8.672 7 9.5 7.672 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
              </svg>
            )}
          </button>
          <input
            className={styles.customStatusInput}
            type="text"
            placeholder="What's going on?"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSetCustomStatus();
            }}
            aria-label="Custom status text"
          />
        </div>
        {showEmojiGrid && (
          <div className={styles.emojiGrid} role="listbox" aria-label="Pick an emoji">
            {COMMON_EMOJI.map((emoji) => (
              <button
                key={emoji}
                className={`${styles.emojiGridItem} ${selectedEmoji === emoji ? styles.emojiGridItemSelected : ''}`}
                onClick={() => {
                  setSelectedEmoji(selectedEmoji === emoji ? null : emoji);
                  setShowEmojiGrid(false);
                }}
                title={emoji}
                type="button"
                role="option"
                aria-selected={selectedEmoji === emoji}
              >
                {emoji}
              </button>
            ))}
            {selectedEmoji && (
              <button
                className={`${styles.emojiGridItem} ${styles.emojiGridClear}`}
                onClick={() => {
                  setSelectedEmoji(null);
                  setShowEmojiGrid(false);
                }}
                title="Clear emoji"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className={styles.clearAfterRow}>
          <span className={styles.clearAfterLabel}>Clear After</span>
          <select
            className={styles.clearAfterSelect}
            value={clearAfterIndex}
            onChange={(e) => setClearAfterIndex(Number(e.target.value))}
            aria-label="Clear status after"
          >
            {CLEAR_AFTER_OPTIONS.map((option, i) => (
              <option key={option.label} value={i}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          className={styles.saveStatusBtn}
          onClick={handleSetCustomStatus}
          type="button"
        >
          Save
        </button>
      </div>

      <div className={styles.separator} />

      {/* Status options */}
      <div className={styles.statusList}>
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.status}
            className={`${styles.statusOption} ${currentStatus === option.status ? styles.statusOptionActive : ''}`}
            onClick={() => handleSelectStatus(option.status)}
            role="menuitem"
            type="button"
          >
            <div className={`${styles.statusDot} ${statusDotClass(option.status)}`}>
              {option.status === 'dnd' && (
                <div className={styles.dndLine} />
              )}
              {option.status === 'idle' && (
                <div className={styles.idleMoon} />
              )}
            </div>
            <div className={styles.statusInfo}>
              <div className={styles.statusLabel}>{option.label}</div>
              {option.description && (
                <div className={styles.statusDescription}>{option.description}</div>
              )}
            </div>
            {currentStatus === option.status && (
              <svg className={styles.checkmark} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8.99991 16.17L4.82991 12L3.40991 13.41L8.99991 19L20.9999 7.00003L19.5899 5.59003L8.99991 16.17Z" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
};
