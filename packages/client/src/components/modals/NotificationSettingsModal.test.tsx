import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { NotificationSettingsModal } from './NotificationSettingsModal';
import { guildsSlice } from '../../stores/guildsSlice';

const mockGetGuildNotificationSettings = vi.fn();
const mockUpdateGuildNotificationSettings = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getGuildNotificationSettings: (...args: unknown[]) => mockGetGuildNotificationSettings(...args),
    updateGuildNotificationSettings: (...args: unknown[]) => mockUpdateGuildNotificationSettings(...args),
  },
}));

function createTestStore(guild?: { id: string; name: string }) {
  const guilds: Record<string, { id: string; name: string; icon: string | null; owner_id: string; member_count: number }> = {};
  if (guild) {
    guilds[guild.id] = { ...guild, icon: null, owner_id: '1', member_count: 10 };
  }
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds,
        selectedGuildId: guild?.id ?? null,
      },
    },
  });
}

describe('NotificationSettingsModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGuildNotificationSettings.mockResolvedValue({
      guild_id: '1',
      channel_id: null,
      muted: false,
      message_notifications: 0,
      suppress_everyone: false,
      suppress_roles: false,
    });
    mockUpdateGuildNotificationSettings.mockResolvedValue({
      guild_id: '1',
      channel_id: null,
      muted: false,
      message_notifications: 0,
      suppress_everyone: false,
      suppress_roles: false,
    });
  });

  it('renders without crashing', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    const { container } = render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the title "Notification Settings"', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Notification Settings')).toBeInTheDocument();
  });

  it('renders the server name', () => {
    const store = createTestStore({ id: '1', name: 'My Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('My Server')).toBeInTheDocument();
  });

  it('renders all notification level options', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('All Messages')).toBeInTheDocument();
    expect(screen.getByText('Only @mentions')).toBeInTheDocument();
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(screen.getByText('Use Server Default')).toBeInTheDocument();
  });

  it('renders suppression toggles', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Suppress @everyone and @here')).toBeInTheDocument();
    expect(screen.getByText('Suppress All Role @mentions')).toBeInTheDocument();
  });

  it('renders mobile push toggle', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Mobile Push Notifications')).toBeInTheDocument();
  });

  it('changes notification level on radio select', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    const allMessagesRadio = screen.getByDisplayValue('all');
    fireEvent.click(allMessagesRadio);
    expect(allMessagesRadio).toBeChecked();
  });

  it('toggles suppression switches', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    const everyoneToggle = screen.getByRole('switch', { name: 'Suppress @everyone and @here' });
    expect(everyoneToggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(everyoneToggle);
    expect(everyoneToggle).toHaveAttribute('aria-checked', 'true');
  });

  it('closes when Escape is pressed', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when Cancel is clicked', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when Done is clicked', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('loads current notification settings for the guild on open', async () => {
    mockGetGuildNotificationSettings.mockResolvedValue({
      guild_id: '1',
      channel_id: null,
      muted: false,
      message_notifications: 1,
      suppress_everyone: true,
      suppress_roles: false,
    });
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );

    expect(mockGetGuildNotificationSettings).toHaveBeenCalledWith('1');
    await waitFor(() => {
      expect(screen.getByDisplayValue('mentions')).toBeChecked();
    });
    expect(screen.getByRole('switch', { name: 'Suppress @everyone and @here' })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves the selected notification settings when Done is clicked', () => {
    const store = createTestStore({ id: '1', name: 'Test Server' });
    render(
      <Provider store={store}>
        <NotificationSettingsModal guildId="1" onClose={onClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByDisplayValue('mentions'));
    fireEvent.click(screen.getByRole('switch', { name: 'Suppress @everyone and @here' }));
    fireEvent.click(screen.getByText('Done'));

    expect(mockUpdateGuildNotificationSettings).toHaveBeenCalledWith('1', {
      message_notifications: 1,
      suppress_everyone: true,
      suppress_roles: false,
    });
    expect(onClose).toHaveBeenCalled();
  });
});
