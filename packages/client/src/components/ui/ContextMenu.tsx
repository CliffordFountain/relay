import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './contextMenu.module.scss';

// ─── Types ───

export interface ContextMenuItemData {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children?: ContextMenuItemData[];
}

export interface ContextMenuSeparator {
  id: string;
  separator: true;
}

export type ContextMenuEntry = ContextMenuItemData | ContextMenuSeparator;

export function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry && entry.separator === true;
}

// ─── Props ───

export interface ContextMenuProps {
  items: ContextMenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  header?: React.ReactNode;
}

// ─── Submenu Component ───

interface SubmenuProps {
  items: ContextMenuEntry[];
  parentRect: DOMRect;
  onClose: () => void;
}

const Submenu = ({ items, parentRect, onClose }: SubmenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number }>({
    top: parentRect.top,
    left: parentRect.right + 4,
  });

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let { top, left } = adjustedPos;

    if (left + rect.width > window.innerWidth) {
      left = parentRect.left - rect.width - 4;
    }
    if (top + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - 8;
    }
    if (top < 8) top = 8;

    if (top !== adjustedPos.top || left !== adjustedPos.left) {
      setAdjustedPos({ top, left });
    }
  }, [parentRect, adjustedPos]);

  return (
    <div
      className={styles.menu}
      ref={menuRef}
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
      role="menu"
    >
      {items.map(entry => {
        if (isSeparator(entry)) {
          return <div key={entry.id} className={styles.separator} role="separator" />;
        }
        return (
          <MenuItemComponent
            key={entry.id}
            item={entry}
            onClose={onClose}
          />
        );
      })}
    </div>
  );
};

// ─── MenuItem Component ───

interface MenuItemComponentProps {
  item: ContextMenuItemData;
  onClose: () => void;
}

const MenuItemComponent = ({ item, onClose }: MenuItemComponentProps) => {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (item.children && item.children.length > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSubmenuOpen(true), 100);
    }
  }, [item.children]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSubmenuOpen(false), 200);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (item.disabled) return;
    if (item.children && item.children.length > 0) {
      setSubmenuOpen(open => !open);
      return;
    }
    if (item.onClick) {
      item.onClick();
    }
    onClose();
  }, [item, onClose]);

  const classNames = [
    styles.item,
    item.danger ? styles.danger : '',
    item.disabled ? styles.disabled : '',
    item.children && item.children.length > 0 ? styles.hasSubmenu : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={itemRef}
      className={classNames}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="menuitem"
      aria-disabled={item.disabled}
      tabIndex={item.disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
      <span className={styles.itemLabel}>{item.label}</span>
      {item.children && item.children.length > 0 && (
        <svg className={styles.submenuArrow} width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.29 6.71a.996.996 0 0 0 0 1.41L13.17 12l-3.88 3.88a.996.996 0 1 0 1.41 1.41l4.59-4.59a.996.996 0 0 0 0-1.41L10.7 6.7c-.38-.38-1.02-.38-1.41.01z" />
        </svg>
      )}
      {submenuOpen && item.children && item.children.length > 0 && itemRef.current && (
        <Submenu
          items={item.children}
          parentRect={itemRef.current.getBoundingClientRect()}
          onClose={onClose}
        />
      )}
    </div>
  );
};

// ─── Main ContextMenu Component ───

export const ContextMenu = ({ items, x, y, onClose, header }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number }>({ top: y, left: x });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleContextMenu = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let newX = x;
    let newY = y;

    if (newX + rect.width > window.innerWidth) {
      newX = x - rect.width;
    }
    if (newY + rect.height > window.innerHeight) {
      newY = window.innerHeight - rect.height - 8;
    }
    if (newX < 8) newX = 8;
    if (newY < 8) newY = 8;

    if (newX !== adjustedPos.left || newY !== adjustedPos.top) {
      setAdjustedPos({ top: newY, left: newX });
    }
  }, [x, y, adjustedPos]);

  const portal = (
    <div className={styles.overlay}>
      <div
        className={styles.menu}
        ref={menuRef}
        style={{ top: adjustedPos.top, left: adjustedPos.left }}
        role="menu"
        aria-label="Context menu"
      >
        {header}
        {items.map(entry => {
          if (isSeparator(entry)) {
            return <div key={entry.id} className={styles.separator} role="separator" />;
          }
          return (
            <MenuItemComponent
              key={entry.id}
              item={entry}
              onClose={onClose}
            />
          );
        })}
      </div>
    </div>
  );

  return createPortal(portal, document.body);
};

// ─── Helper: useContextMenu hook ───

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  header?: React.ReactNode;
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const openContextMenu = useCallback((e: React.MouseEvent, items: ContextMenuEntry[], header?: React.ReactNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items, header });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, openContextMenu, closeContextMenu };
}

// ─── Helper: Copy ID context menu item ───

const COPY_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
  </svg>
);

export const makeCopyIdItem = (id: string): ContextMenuItemData => ({
  id: 'copy-id',
  label: 'Copy ID',
  icon: COPY_ICON,
  onClick: () => {
    void navigator.clipboard.writeText(id);
  },
});

// ─── Helper: message context menu items ───

export const getMessageContextItems = (
  message: { id: string; content: string; author: { id: string }; channelId?: string },
  currentUserId: string | undefined,
  actions: {
    onAddReaction?: () => void;
    onReply?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    onPin?: () => void;
    onForward?: () => void;
    onCopyText?: () => void;
    onCopyMessageLink?: () => void;
    onMarkUnread?: () => void;
    onSpeakMessage?: () => void;
  },
  permissions: { canManageMessages?: boolean } = {},
  options: { developerMode?: boolean } = {}
): ContextMenuEntry[] => {
  const isOwn = message.author.id === currentUserId;
  const items: ContextMenuEntry[] = [];

  if (actions.onAddReaction) {
    items.push({
      id: 'add-reaction',
      label: 'Add Reaction',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm-4-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm8 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-4 6c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
        </svg>
      ),
      onClick: actions.onAddReaction,
    });
  }

  if (actions.onReply) {
    items.push({
      id: 'reply',
      label: 'Reply',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 8.26667V4L3 11.4667L10 18.9333V14.56C15 14.56 18.5 16.2667 21 20C20 14.6667 17 9.33333 10 8.26667Z" />
        </svg>
      ),
      onClick: actions.onReply,
    });
  }
  if (isOwn && actions.onEdit) {
    items.push({
      id: 'edit',
      label: 'Edit Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64696 16.2301 2.64696 14.818 4.05892L14.1708 4.70711L19.2929 9.8299ZM12.8556 6.02225L4.10034 14.7794C3.84927 15.0306 3.67399 15.3489 3.59496 15.6974L2.04626 22.6337C1.9872 22.894 2.06584 23.1664 2.25445 23.355C2.44306 23.5437 2.71537 23.6223 2.97571 23.5632L9.912 22.0145C10.2605 21.9355 10.5788 21.7602 10.83 21.5091L19.5836 12.7536L12.8556 6.02225Z" />
        </svg>
      ),
      onClick: actions.onEdit,
    });
  }
  if (actions.onPin) {
    items.push({
      id: 'pin',
      label: 'Pin Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22 12L12.101 2.10101L10.686 3.51401L12.101 4.92901L7.15098 9.87901L5.73598 8.46401L4.32198 9.87901L8.56498 14.122L2.90698 19.778L4.32198 21.192L9.97898 15.536L14.222 19.778L15.636 18.364L14.222 16.95L19.171 12L20.586 13.414L22 12Z" />
        </svg>
      ),
      onClick: actions.onPin,
    });
  }

  if (actions.onForward) {
    items.push({
      id: 'forward',
      label: 'Forward Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 8.26667V4L21 11.4667L14 18.9333V14.56C9 14.56 5.5 16.2667 3 20C4 14.6667 7 9.33333 14 8.26667Z" />
        </svg>
      ),
      onClick: actions.onForward,
    });
  }

  items.push({ id: 'sep1', separator: true as const });

  if (actions.onCopyText) {
    items.push({
      id: 'copy-text',
      label: 'Copy Text',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
        </svg>
      ),
      onClick: actions.onCopyText,
    });
  }
  if (actions.onCopyMessageLink) {
    items.push({
      id: 'copy-link',
      label: 'Copy Message Link',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a2.982 2.982 0 0 0 0-4.24 2.982 2.982 0 0 0-4.24 0l-3.53 3.53a2.982 2.982 0 0 0 0 4.24zm2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0 5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.42l-.47.48a2.982 2.982 0 0 0 0 4.24 2.982 2.982 0 0 0 4.24 0l3.53-3.53a2.982 2.982 0 0 0 0-4.24.973.973 0 0 1 0-1.42z" />
        </svg>
      ),
      onClick: actions.onCopyMessageLink,
    });
  }

  if (actions.onMarkUnread) {
    items.push({
      id: 'mark-unread',
      label: 'Mark Unread',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm-1-13h2v6h-2V7zm0 8h2v2h-2v-2z" />
        </svg>
      ),
      onClick: actions.onMarkUnread,
    });
  }

  if (actions.onSpeakMessage) {
    items.push({
      id: 'speak-message',
      label: 'Speak Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
      ),
      onClick: actions.onSpeakMessage,
    });
  }

  if ((isOwn || permissions.canManageMessages) && actions.onDelete) {
    items.push({ id: 'sep2', separator: true as const });
    items.push({
      id: 'delete',
      label: 'Delete Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15ZM5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" />
        </svg>
      ),
      onClick: actions.onDelete,
      danger: true,
    });
  }

  if (options.developerMode) {
    items.push({ id: 'sep-dev', separator: true as const });
    items.push(makeCopyIdItem(message.id));
  }

  return items;
};

// ─── Helper: channel context menu items ───

export const getChannelContextItems = (
  channel: { id: string; name: string | null },
  actions: {
    onMarkAsRead?: () => void;
    onEditChannel?: () => void;
    onCreateInvite?: () => void;
    onMuteChannel?: () => void;
    onDeleteChannel?: () => void;
    onCloneChannel?: () => void;
  },
  permissions: { canManage?: boolean } = {},
  options: { developerMode?: boolean } = {}
): ContextMenuEntry[] => {
  const items: ContextMenuEntry[] = [];

  if (actions.onMarkAsRead) {
    items.push({
      id: 'mark-read',
      label: 'Mark as Read',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 15l-5-5 1.41-1.41L11 14.17l7.59-7.59L20 8l-9 9z" />
        </svg>
      ),
      onClick: actions.onMarkAsRead,
    });
  }

  if (actions.onMuteChannel) {
    items.push({
      id: 'mute',
      label: 'Mute Channel',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.902 7.902 0 0 1 12 20zm6.31-3.1L7.1 5.69A7.902 7.902 0 0 1 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z" />
        </svg>
      ),
      onClick: actions.onMuteChannel,
    });
  }

  if (actions.onCreateInvite) {
    items.push({
      id: 'invite',
      label: 'Create Invite',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" />
        </svg>
      ),
      onClick: actions.onCreateInvite,
    });
  }

  if (permissions.canManage) {
    items.push({ id: 'sep1', separator: true as const });

    if (actions.onEditChannel) {
      items.push({
        id: 'edit',
        label: 'Edit Channel',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        ),
        onClick: actions.onEditChannel,
      });
    }

    if (actions.onCloneChannel) {
      items.push({
        id: 'clone',
        label: 'Clone Channel',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
          </svg>
        ),
        onClick: actions.onCloneChannel,
      });
    }

    if (actions.onDeleteChannel) {
      items.push({
        id: 'delete',
        label: 'Delete Channel',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15ZM5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" />
          </svg>
        ),
        onClick: actions.onDeleteChannel,
        danger: true,
      });
    }
  }

  if (options.developerMode) {
    items.push({ id: 'sep-dev', separator: true as const });
    items.push(makeCopyIdItem(channel.id));
  }

  return items;
};

// ─── Helper: user context menu items ───

export interface RoleEntry {
  id: string;
  name: string;
  color: string | null;
  assigned: boolean;
}

export const getUserContextItems = (
  user: { id: string; username: string },
  actions: {
    onProfile?: () => void;
    onMessage?: () => void;
    onMention?: () => void;
    onChangeNickname?: () => void;
    onKick?: () => void;
    onBan?: () => void;
    onToggleRole?: (roleId: string) => void;
  },
  permissions: { canManage?: boolean; canKick?: boolean; canBan?: boolean } = {},
  options: { developerMode?: boolean; roles?: RoleEntry[] } = {}
): ContextMenuEntry[] => {
  const items: ContextMenuEntry[] = [];

  if (actions.onProfile) {
    items.push({
      id: 'profile',
      label: 'Profile',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22z" />
        </svg>
      ),
      onClick: actions.onProfile,
    });
  }

  if (actions.onMessage) {
    items.push({
      id: 'message',
      label: 'Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H8.39805V20.2C8.39805 20.7 8.88045 21.0352 9.33645 20.8648L15.5981 17.4H19.198C20.1924 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1924 3 19.198 3H4.79805Z" />
        </svg>
      ),
      onClick: actions.onMessage,
    });
  }

  if (actions.onMention) {
    items.push({
      id: 'mention',
      label: 'Mention',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.486 2 2 6.486 2 12C2 17.515 6.486 22 12 22C14.039 22 15.993 21.398 17.652 20.259L16.521 18.611C15.195 19.519 13.633 20 12 20C7.589 20 4 16.411 4 12C4 7.589 7.589 4 12 4C16.411 4 20 7.589 20 12V12.782C20 14.17 19.402 15 18.4 15L18.398 15.018C18.338 15.005 18.273 15 18.209 15H18C17.437 15 16.6 14.182 16.6 13.631V12C16.6 9.464 14.537 7.4 12 7.4C9.464 7.4 7.4 9.464 7.4 12C7.4 14.537 9.464 16.6 12 16.6C13.234 16.6 14.35 16.106 15.177 15.313C15.826 15.937 16.777 16.6 18 16.6L18.018 16.602C19.785 16.811 22 15.631 22 12.782V12C22 6.486 17.514 2 12 2ZM12 14.599C10.566 14.599 9.4 13.433 9.4 11.999C9.4 10.565 10.566 9.39901 12 9.39901C13.434 9.39901 14.6 10.565 14.6 11.999C14.6 13.433 13.434 14.599 12 14.599Z" />
        </svg>
      ),
      onClick: actions.onMention,
    });
  }

  if (actions.onChangeNickname) {
    items.push({
      id: 'nickname',
      label: 'Change Nickname',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64696 16.2301 2.64696 14.818 4.05892L14.1708 4.70711L19.2929 9.8299ZM12.8556 6.02225L4.10034 14.7794C3.84927 15.0306 3.67399 15.3489 3.59496 15.6974L2.04626 22.6337C1.9872 22.894 2.06584 23.1664 2.25445 23.355C2.44306 23.5437 2.71537 23.6223 2.97571 23.5632L9.912 22.0145C10.2605 21.9355 10.5788 21.7602 10.83 21.5091L19.5836 12.7536L12.8556 6.02225Z" />
        </svg>
      ),
      onClick: actions.onChangeNickname,
    });
  }

  // Roles submenu
  if (permissions.canManage && actions.onToggleRole && options.roles && options.roles.length > 0) {
    const roleChildren: ContextMenuItemData[] = options.roles.map(role => ({
      id: `role-${role.id}`,
      label: `${role.assigned ? '\u2611' : '\u2610'} ${role.name}`,
      icon: role.color ? (
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: role.color,
          }}
        />
      ) : undefined,
      onClick: () => actions.onToggleRole?.(role.id),
    }));

    items.push({ id: 'sep-roles', separator: true as const });
    items.push({
      id: 'roles',
      label: 'Roles',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.794 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006ZM20.0001 20.006H22.0001V19.006C22.0001 16.4469 20.2331 14.4606 17.4961 13.506C19.0741 14.565 20.0001 16.1649 20.0001 18.006V20.006ZM14.8781 11.9939C16.0481 11.0459 16.9991 9.62895 16.9991 8.00598C16.9991 6.44898 16.1211 5.08398 14.8351 4.19398C16.3281 4.39698 17.9991 5.75498 17.9991 8.00598C17.9991 10.088 16.7861 11.5929 14.8781 11.9939Z" />
        </svg>
      ),
      children: roleChildren,
    });
  }

  // Moderation actions
  const modItems: ContextMenuEntry[] = [];

  if (permissions.canKick && actions.onKick) {
    modItems.push({
      id: 'kick',
      label: 'Kick',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16.707 2.293a1 1 0 0 0-1.414 0l-6 6a1 1 0 0 0 0 1.414l5 5a1 1 0 0 0 1.414 0l6-6a1 1 0 0 0 0-1.414l-5-5zM11 17H6l-4 4V3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5.586l-2-2V3H4v14.586l1.707-1.707.293-.293h5v1.414z" />
        </svg>
      ),
      onClick: actions.onKick,
      danger: true,
    });
  }

  if (permissions.canBan && actions.onBan) {
    modItems.push({
      id: 'ban',
      label: 'Ban',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31A7.902 7.902 0 0 1 12 20zm6.31-3.1L7.1 5.69A7.902 7.902 0 0 1 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z" />
        </svg>
      ),
      onClick: actions.onBan,
      danger: true,
    });
  }

  if (modItems.length > 0) {
    items.push({ id: 'sep-mod', separator: true as const });
    items.push(...modItems);
  }

  if (options.developerMode) {
    items.push({ id: 'sep-dev', separator: true as const });
    items.push(makeCopyIdItem(user.id));
  }

  return items;
};

// ─── Helper: guild context menu items ───

export const getGuildContextItems = (
  guild: { id: string; name: string },
  actions: {
    onServerSettings?: () => void;
    onCreateChannel?: () => void;
    onCreateInvite?: () => void;
    onLeaveServer?: () => void;
  },
  permissions: { isOwner?: boolean; canManage?: boolean } = {},
  options: { developerMode?: boolean } = {}
): ContextMenuEntry[] => {
  const items: ContextMenuEntry[] = [];

  if ((permissions.isOwner || permissions.canManage) && actions.onServerSettings) {
    items.push({
      id: 'settings',
      label: 'Server Settings',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
      ),
      onClick: actions.onServerSettings,
    });
  }

  if (actions.onCreateChannel) {
    items.push({
      id: 'create-channel',
      label: 'Create Channel',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11.1111H12.8889V4H11.1111V11.1111H4V12.8889H11.1111V20H12.8889V12.8889H20V11.1111Z" />
        </svg>
      ),
      onClick: actions.onCreateChannel,
    });
  }

  if (actions.onCreateInvite) {
    items.push({
      id: 'invite',
      label: 'Invite People',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" />
        </svg>
      ),
      onClick: actions.onCreateInvite,
    });
  }

  if (actions.onLeaveServer) {
    items.push({ id: 'sep-leave', separator: true as const });
    items.push({
      id: 'leave',
      label: 'Leave Server',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10.418 13L12.708 15.294L11.292 16.706L6.586 12L11.292 7.29401L12.706 8.70601L10.414 11H21.998V13H10.418ZM3 3H12V5H5V19H12V21H3V3Z" />
        </svg>
      ),
      onClick: actions.onLeaveServer,
      danger: true,
    });
  }

  if (options.developerMode) {
    items.push({ id: 'sep-dev', separator: true as const });
    items.push(makeCopyIdItem(guild.id));
  }

  return items;
};
