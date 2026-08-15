import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from '../../stores/messagesSlice';
import styles from './messageMoreMenu.module.scss';

export interface MessageMoreMenuProps {
  msg: Message;
  isOwnMessage: boolean;
  canManageMessages: boolean;
  channelId: string;
  selectedGuildId: string | null;
  onEdit: (msg: Message) => void;
  onDelete: (msg: Message) => void;
  onPin: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onCopyText: (msg: Message) => void;
  onCopyMessageLink: (msg: Message) => void;
  onCreateThread?: (msg: Message) => void;
}

export const MessageMoreMenu = ({
  msg,
  isOwnMessage,
  canManageMessages,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onCopyText,
  onCopyMessageLink,
  onCreateThread,
}: MessageMoreMenuProps) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // The button's anchor point, captured when the menu opens. The reposition pass reads from
  // this stable ref (NOT from menuPosition), so it can't feed back into itself.
  const anchorRef = useRef<{ top: number; right: number }>({ top: 0, right: 0 });

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      anchorRef.current = { top: rect.bottom + 4, right: rect.right };
      // Provisional; corrected in useLayoutEffect once the menu's width is measured.
      setMenuPosition({ top: rect.bottom + 4, left: rect.right });
    }
    setOpen(prev => !prev);
  }, [open]);

  // Close on outside click or escape
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Position the menu once rendered: right-align it under the button and keep it in the
  // viewport. Computed from the stable anchor (never from menuPosition), so it runs once
  // per open instead of subtracting the menu width on every render (which slid it far-left).
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const { top: aTop, right: aRight } = anchorRef.current;

    let left = aRight - rect.width; // align the menu's right edge to the button's right edge
    if (left < 8) left = 8;
    let top = aTop;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }

    setMenuPosition(prev => (prev.top === top && prev.left === left ? prev : { top, left }));
  }, [open]);

  const handleAction = useCallback((action: () => void) => {
    action();
    setOpen(false);
  }, []);

  const hasActions = isOwnMessage || canManageMessages;

  return (
    <>
      <button
        ref={buttonRef}
        className={styles.moreButton}
        title="More"
        aria-label="More"
        aria-haspopup="true"
        aria-expanded={open}
        type="button"
        onClick={handleToggle}
      >
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M7 12.001C7 10.8964 6.10457 10.001 5 10.001C3.89543 10.001 3 10.8964 3 12.001C3 13.1055 3.89543 14.001 5 14.001C6.10457 14.001 7 13.1055 7 12.001ZM14 12.001C14 10.8964 13.1046 10.001 12 10.001C10.8954 10.001 10 10.8964 10 12.001C10 13.1055 10.8954 14.001 12 14.001C13.1046 14.001 14 13.1055 14 12.001ZM21 12.001C21 10.8964 20.1046 10.001 19 10.001C17.8954 10.001 17 10.8964 17 12.001C17 13.1055 17.8954 14.001 19 14.001C20.1046 14.001 21 13.1055 21 12.001Z"
          />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className={styles.dropdown}
          style={{ top: menuPosition.top, left: menuPosition.left }}
          role="menu"
          aria-label="Message actions menu"
        >
          {isOwnMessage && (
            <button
              className={styles.dropdownItem}
              role="menuitem"
              onClick={() => handleAction(() => onEdit(msg))}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64696 16.2301 2.64696 14.818 4.05892L14.1708 4.70711L19.2929 9.8299ZM12.8556 6.02225L4.10034 14.7794C3.84927 15.0306 3.67399 15.3489 3.59496 15.6974L2.04626 22.6337C1.9872 22.894 2.06584 23.1664 2.25445 23.355C2.44306 23.5437 2.71537 23.6223 2.97571 23.5632L9.912 22.0145C10.2605 21.9355 10.5788 21.7602 10.83 21.5091L19.5836 12.7536L12.8556 6.02225Z" />
              </svg>
              <span>Edit Message</span>
            </button>
          )}
          {onCreateThread && (
            <button
              className={styles.dropdownItem}
              role="menuitem"
              onClick={() => handleAction(() => onCreateThread(msg))}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.81L15.22 3.73L12.34 5.64L14.22 8.98L10.89 8.47L9.98 11.81L7.74 9.15L5.01 11.38L5.83 7.97L2.65 7.07L5.7 5.36L4.17 2.15L7.31 3.12L8.67 0L10.25 3.05L12 2.81Z" />
              </svg>
              <span>Create Thread</span>
            </button>
          )}
          <button
            className={styles.dropdownItem}
            role="menuitem"
            onClick={() => handleAction(() => onPin(msg))}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22 12L12.101 2.10101L10.686 3.51401L12.101 4.92901L7.15098 9.87901L5.73598 8.46401L4.32198 9.87901L8.56498 14.122L2.90698 19.778L4.32198 21.192L9.97898 15.536L14.222 19.778L15.636 18.364L14.222 16.95L19.171 12L20.586 13.414L22 12Z" />
            </svg>
            <span>Pin Message</span>
          </button>
          <button
            className={styles.dropdownItem}
            role="menuitem"
            onClick={() => handleAction(() => onForward(msg))}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 8.26667V4L21 11.4667L14 18.9333V14.56C9 14.56 5.5 16.2667 3 20C4 14.6667 7 9.33333 14 8.26667Z" />
            </svg>
            <span>Forward Message</span>
          </button>
          <button
            className={styles.dropdownItem}
            role="menuitem"
            onClick={() => handleAction(() => onCopyText(msg))}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
            </svg>
            <span>Copy Text</span>
          </button>
          <button
            className={styles.dropdownItem}
            role="menuitem"
            onClick={() => handleAction(() => onCopyMessageLink(msg))}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a2.982 2.982 0 0 0 0-4.24 2.982 2.982 0 0 0-4.24 0l-3.53 3.53a2.982 2.982 0 0 0 0 4.24zm2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0 5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.42l-.47.48a2.982 2.982 0 0 0 0 4.24 2.982 2.982 0 0 0 4.24 0l3.53-3.53a2.982 2.982 0 0 0 0-4.24.973.973 0 0 1 0-1.42z" />
            </svg>
            <span>Copy Message Link</span>
          </button>
          {hasActions && (
            <>
              <div className={styles.dropdownSeparator} role="separator" />
              <button
                className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                role="menuitem"
                onClick={() => handleAction(() => onDelete(msg))}
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15ZM5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" />
                </svg>
                <span>Delete Message</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
};
