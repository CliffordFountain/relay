import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { QuickSwitcher } from './QuickSwitcher';
import { uiSlice } from '../../stores/uiSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { dmSlice } from '../../stores/dmSlice';
import { notificationsSlice } from '../../stores/notificationsSlice';
import { presenceSlice } from '../../stores/presenceSlice';

function createTestStore(overrides?: {
  quickSwitcherOpen?: boolean;
  guilds?: Record<string, { id: string; name: string; icon: string | null; owner_id: string; member_count: number }>;
  channels?: Record<string, { id: string; guild_id: string | null; type: number; name: string | null; topic: string | null; position: number; parent_id: string | null }>;
  dmChannels?: Array<{ id: string; type: number; recipients: Array<{ id: string; username: string; avatar: string | null }>; last_message_id: string | null }>;
}) {
  return configureStore({
    reducer: {
      ui: uiSlice.reducer,
      channels: channelsSlice.reducer,
      guilds: guildsSlice.reducer,
      dm: dmSlice.reducer,
      notifications: notificationsSlice.reducer,
      presence: presenceSlice.reducer,
    },
    preloadedState: {
      ui: {
        activeModal: null,
        modalProps: {},
        memberSidebarOpen: true,
        channelSidebarWidth: 240,
        sidebarCollapsed: false,
        activePopoverUserId: null,
        activePopoverPosition: null,
        activePopoverGuildId: null,
        replyingToMessageId: null,
        editingMessageId: null,
        appLoading: false,
        lightboxImage: null,
        quickSwitcherOpen: overrides?.quickSwitcherOpen ?? false,
        pinnedMessagesPanelOpen: false,
        inboxPanelOpen: false,
        inboxPanelTab: 'forYou' as const,
      },
      channels: {
        channels: overrides?.channels ?? {},
        selectedChannelId: null,
      },
      guilds: {
        guilds: overrides?.guilds ?? {},
        selectedGuildId: null,
        folders: [],
      },
      dm: {
        dmChannels: overrides?.dmChannels ?? [],
        selectedDmChannelId: null,
      },
      notifications: {
        unreadByChannel: {},
        mentionsByChannel: {},
      },
      presence: {
        presences: {},
        selfStatus: 'online' as const,
      },
    },
  });
}

function renderWithProviders(store: ReturnType<typeof createTestStore>) {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <QuickSwitcher />
      </MemoryRouter>
    </Provider>,
  );
}

describe('QuickSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('does not render when quickSwitcherOpen is false', () => {
    const store = createTestStore({ quickSwitcherOpen: false });
    const { container } = renderWithProviders(store);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the modal when quickSwitcherOpen is true', () => {
    const store = createTestStore({ quickSwitcherOpen: true });
    renderWithProviders(store);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Where would you like to go?')).toBeInTheDocument();
  });

  it('shows DM channels in results', () => {
    const store = createTestStore({
      quickSwitcherOpen: true,
      dmChannels: [
        { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
      ],
    });
    renderWithProviders(store);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows guild channels in results when searching', () => {
    const store = createTestStore({
      quickSwitcherOpen: true,
      guilds: {
        g1: { id: 'g1', name: 'My Server', icon: null, owner_id: '1', member_count: 10 },
      },
      channels: {
        c1: { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      },
    });
    renderWithProviders(store);

    const input = screen.getByPlaceholderText('Where would you like to go?');
    fireEvent.change(input, { target: { value: 'general' } });

    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('My Server')).toBeInTheDocument();
  });

  it('shows guilds in results when searching by server name', () => {
    const store = createTestStore({
      quickSwitcherOpen: true,
      guilds: {
        g1: { id: 'g1', name: 'Cool Server', icon: null, owner_id: '1', member_count: 10 },
      },
    });
    renderWithProviders(store);

    const input = screen.getByPlaceholderText('Where would you like to go?');
    fireEvent.change(input, { target: { value: 'Cool' } });

    expect(screen.getByText('Cool Server')).toBeInTheDocument();
  });

  it('shows no results message when nothing matches', () => {
    const store = createTestStore({
      quickSwitcherOpen: true,
    });
    renderWithProviders(store);

    const input = screen.getByPlaceholderText('Where would you like to go?');
    fireEvent.change(input, { target: { value: 'zzzznonexistent' } });

    expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    const store = createTestStore({ quickSwitcherOpen: true });
    renderWithProviders(store);

    const input = screen.getByPlaceholderText('Where would you like to go?');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(store.getState().ui.quickSwitcherOpen).toBe(false);
  });

  it('closes on overlay click', () => {
    const store = createTestStore({ quickSwitcherOpen: true });
    renderWithProviders(store);

    // The dialog element IS the overlay with the click handler
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);

    expect(store.getState().ui.quickSwitcherOpen).toBe(false);
  });

  it('supports arrow key navigation', () => {
    const store = createTestStore({
      quickSwitcherOpen: true,
      dmChannels: [
        { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'Alice', avatar: null }], last_message_id: null },
        { id: 'dm2', type: 1, recipients: [{ id: '11', username: 'Bob', avatar: null }], last_message_id: null },
      ],
    });
    renderWithProviders(store);

    const input = screen.getByPlaceholderText('Where would you like to go?');

    // First result should be selected by default
    const firstResult = screen.getByText('Alice').closest('[role="option"]');
    expect(firstResult).toHaveAttribute('aria-selected', 'true');

    // Press ArrowDown to select second
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const secondResult = screen.getByText('Bob').closest('[role="option"]');
    expect(secondResult).toHaveAttribute('aria-selected', 'true');
  });

  it('has proper accessibility attributes', () => {
    const store = createTestStore({ quickSwitcherOpen: true });
    renderWithProviders(store);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Quick Switcher');

    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('shows # icon for channels and @ icon for DMs', () => {
    const store = createTestStore({
      quickSwitcherOpen: true,
      guilds: {
        g1: { id: 'g1', name: 'Server', icon: null, owner_id: '1', member_count: 5 },
      },
      channels: {
        c1: { id: 'c1', guild_id: 'g1', type: 0, name: 'text-channel', topic: null, position: 0, parent_id: null },
      },
      dmChannels: [
        { id: 'dm1', type: 1, recipients: [{ id: '10', username: 'User', avatar: null }], last_message_id: null },
      ],
    });
    renderWithProviders(store);

    // Both should be visible without searching since there are few results
    expect(screen.getByText('@')).toBeInTheDocument();
    expect(screen.getByText('#')).toBeInTheDocument();
  });
});
