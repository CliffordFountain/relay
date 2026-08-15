import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ContextMenu,
  getMessageContextItems,
  getChannelContextItems,
  getUserContextItems,
  getGuildContextItems,
  makeCopyIdItem,
} from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';

describe('ContextMenu', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultItems: ContextMenuEntry[] = [
    { id: 'reply', label: 'Reply', onClick: vi.fn() },
    { id: 'sep', separator: true },
    { id: 'delete', label: 'Delete', onClick: vi.fn(), danger: true },
  ];

  it('renders without crashing', () => {
    render(
      <ContextMenu
        items={defaultItems}
        x={100}
        y={200}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('renders menu items with correct labels', () => {
    render(
      <ContextMenu
        items={defaultItems}
        x={100}
        y={200}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByText('Reply')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('renders separators', () => {
    render(
      <ContextMenu
        items={defaultItems}
        x={100}
        y={200}
        onClose={mockOnClose}
      />
    );
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('calls onClick and onClose when item is clicked', () => {
    const onClick = vi.fn();
    const items: ContextMenuEntry[] = [
      { id: 'test', label: 'Test Item', onClick },
    ];
    render(
      <ContextMenu items={items} x={100} y={200} onClose={mockOnClose} />
    );
    fireEvent.click(screen.getByText('Test Item'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    render(
      <ContextMenu items={defaultItems} x={100} y={200} onClose={mockOnClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('closes on click outside', () => {
    render(
      <ContextMenu items={defaultItems} x={100} y={200} onClose={mockOnClose} />
    );
    fireEvent.mouseDown(document.body);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders disabled items', () => {
    const items: ContextMenuEntry[] = [
      { id: 'disabled', label: 'Disabled', onClick: vi.fn(), disabled: true },
    ];
    render(
      <ContextMenu items={items} x={100} y={200} onClose={mockOnClose} />
    );
    const item = screen.getByText('Disabled');
    expect(item.closest('[aria-disabled="true"]')).toBeInTheDocument();
  });

  it('renders items with icons', () => {
    const items: ContextMenuEntry[] = [
      {
        id: 'with-icon',
        label: 'With Icon',
        onClick: vi.fn(),
        icon: <svg data-testid="test-icon" />,
      },
    ];
    render(
      <ContextMenu items={items} x={100} y={200} onClose={mockOnClose} />
    );
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });
});

describe('getMessageContextItems', () => {
  it('returns Reply and Copy Text for other user messages', () => {
    const items = getMessageContextItems(
      { id: '1', content: 'hello', author: { id: 'other' } },
      'me',
      {
        onReply: vi.fn(),
        onCopyText: vi.fn(),
        onCopyMessageLink: vi.fn(),
      }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Reply');
    expect(labels).toContain('Copy Text');
    expect(labels).toContain('Copy Message Link');
    expect(labels).not.toContain('Edit Message');
    expect(labels).not.toContain('Delete Message');
  });

  it('returns Edit and Delete for own messages', () => {
    const items = getMessageContextItems(
      { id: '1', content: 'hello', author: { id: 'me' } },
      'me',
      {
        onReply: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onCopyText: vi.fn(),
      }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Edit Message');
    expect(labels).toContain('Delete Message');
  });

  it('marks Delete as danger', () => {
    const items = getMessageContextItems(
      { id: '1', content: 'hello', author: { id: 'me' } },
      'me',
      { onDelete: vi.fn() }
    );
    const deleteItem = items.find(i => 'label' in i && (i as { label: string }).label === 'Delete Message');
    expect(deleteItem && 'danger' in deleteItem && deleteItem.danger).toBe(true);
  });
});

describe('getChannelContextItems', () => {
  it('returns basic items without manage permission', () => {
    const items = getChannelContextItems(
      { id: '1', name: 'general' },
      {
        onMarkAsRead: vi.fn(),
        onMuteChannel: vi.fn(),
        onCreateInvite: vi.fn(),
      },
      { canManage: false }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Mark as Read');
    expect(labels).toContain('Mute Channel');
    expect(labels).toContain('Create Invite');
    expect(labels).not.toContain('Edit Channel');
    expect(labels).not.toContain('Delete Channel');
  });

  it('returns management items with canManage permission', () => {
    const items = getChannelContextItems(
      { id: '1', name: 'general' },
      {
        onMarkAsRead: vi.fn(),
        onEditChannel: vi.fn(),
        onDeleteChannel: vi.fn(),
      },
      { canManage: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Edit Channel');
    expect(labels).toContain('Delete Channel');
  });
});

describe('getUserContextItems', () => {
  it('returns Message and Mention for regular users', () => {
    const items = getUserContextItems(
      { id: '1', username: 'testuser' },
      {
        onMessage: vi.fn(),
        onMention: vi.fn(),
      }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Message');
    expect(labels).toContain('Mention');
    expect(labels).not.toContain('Kick');
    expect(labels).not.toContain('Ban');
  });

  it('returns Kick and Ban with permissions', () => {
    const items = getUserContextItems(
      { id: '1', username: 'testuser' },
      {
        onMessage: vi.fn(),
        onKick: vi.fn(),
        onBan: vi.fn(),
      },
      { canKick: true, canBan: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Kick');
    expect(labels).toContain('Ban');
  });

  it('marks Kick and Ban as danger', () => {
    const items = getUserContextItems(
      { id: '1', username: 'testuser' },
      { onKick: vi.fn(), onBan: vi.fn() },
      { canKick: true, canBan: true }
    );
    const kickItem = items.find(i => 'label' in i && (i as { label: string }).label === 'Kick');
    const banItem = items.find(i => 'label' in i && (i as { label: string }).label === 'Ban');
    expect(kickItem && 'danger' in kickItem && kickItem.danger).toBe(true);
    expect(banItem && 'danger' in banItem && banItem.danger).toBe(true);
  });
});

describe('getGuildContextItems', () => {
  it('returns Create Channel and Invite People for all users', () => {
    const items = getGuildContextItems(
      { id: '1', name: 'Test Server' },
      {
        onCreateChannel: vi.fn(),
        onCreateInvite: vi.fn(),
        onLeaveServer: vi.fn(),
      }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Create Channel');
    expect(labels).toContain('Invite People');
    expect(labels).toContain('Leave Server');
  });

  it('returns Server Settings for owners', () => {
    const items = getGuildContextItems(
      { id: '1', name: 'Test Server' },
      {
        onServerSettings: vi.fn(),
        onCreateChannel: vi.fn(),
      },
      { isOwner: true, canManage: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Server Settings');
  });

  it('does not include Server Settings without permissions', () => {
    const items = getGuildContextItems(
      { id: '1', name: 'Test Server' },
      {
        onServerSettings: vi.fn(),
        onCreateChannel: vi.fn(),
      },
      { isOwner: false, canManage: false }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).not.toContain('Server Settings');
  });

  it('marks Leave Server as danger', () => {
    const items = getGuildContextItems(
      { id: '1', name: 'Test Server' },
      { onLeaveServer: vi.fn() }
    );
    const leaveItem = items.find(i => 'label' in i && (i as { label: string }).label === 'Leave Server');
    expect(leaveItem && 'danger' in leaveItem && leaveItem.danger).toBe(true);
  });
});

describe('Developer Mode - Copy ID', () => {
  it('adds Copy ID to message context menu when developer mode is on', () => {
    const items = getMessageContextItems(
      { id: '12345', content: 'hello', author: { id: 'other' } },
      'me',
      { onReply: vi.fn() },
      {},
      { developerMode: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Copy ID');
  });

  it('does not add Copy ID to message context menu when developer mode is off', () => {
    const items = getMessageContextItems(
      { id: '12345', content: 'hello', author: { id: 'other' } },
      'me',
      { onReply: vi.fn() },
      {},
      { developerMode: false }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).not.toContain('Copy ID');
  });

  it('adds Copy ID to channel context menu when developer mode is on', () => {
    const items = getChannelContextItems(
      { id: '12345', name: 'general' },
      { onMarkAsRead: vi.fn() },
      {},
      { developerMode: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Copy ID');
  });

  it('adds Copy ID to user context menu when developer mode is on', () => {
    const items = getUserContextItems(
      { id: '12345', username: 'testuser' },
      { onMessage: vi.fn() },
      {},
      { developerMode: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Copy ID');
  });

  it('adds Copy ID to guild context menu when developer mode is on', () => {
    const items = getGuildContextItems(
      { id: '12345', name: 'Test Server' },
      { onCreateChannel: vi.fn() },
      {},
      { developerMode: true }
    );
    const labels = items.filter(i => 'label' in i).map(i => (i as { label: string }).label);
    expect(labels).toContain('Copy ID');
  });

  it('Copy ID calls clipboard.writeText with correct ID', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const items = getMessageContextItems(
      { id: '99887766', content: 'test', author: { id: 'other' } },
      'me',
      {},
      {},
      { developerMode: true }
    );
    const copyItem = items.find(i => 'label' in i && (i as { label: string }).label === 'Copy ID');
    expect(copyItem).toBeDefined();
    if (copyItem && 'onClick' in copyItem && copyItem.onClick) {
      copyItem.onClick();
      expect(writeText).toHaveBeenCalledWith('99887766');
    }
  });
});
