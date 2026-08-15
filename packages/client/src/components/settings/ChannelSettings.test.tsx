import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ChannelSettings } from './ChannelSettings';
import { channelsSlice } from '../../stores/channelsSlice';
import { rolesSlice } from '../../stores/rolesSlice';

const mockUpdateChannel = vi.fn();
const mockDeleteChannel = vi.fn();
const mockSetPermissionOverwrite = vi.fn();
const mockDeletePermissionOverwrite = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    updateChannel: (...args: unknown[]) => mockUpdateChannel(...args),
    deleteChannel: (...args: unknown[]) => mockDeleteChannel(...args),
    setChannelPermissionOverwrite: (...args: unknown[]) => mockSetPermissionOverwrite(...args),
    deleteChannelPermissionOverwrite: (...args: unknown[]) => mockDeletePermissionOverwrite(...args),
    getChannelPermissionOverwrites: () => Promise.resolve([]),
    getGuildRoles: () => Promise.resolve([]),
    getChannelInvites: () => Promise.resolve([]),
    getChannelWebhooks: () => Promise.resolve([]),
    createWebhook: () => Promise.resolve({ id: '999', name: 'New Webhook', avatar: null, channel_id: '100', guild_id: '1', token: 'tok', type: 1 }),
    updateWebhook: () => Promise.resolve({ id: '999', name: 'Updated', avatar: null, channel_id: '100', guild_id: '1', token: 'tok', type: 1 }),
    deleteWebhook: () => Promise.resolve(),
    revokeInvite: () => Promise.resolve(),
  },
}));

const testRoles = [
  { id: '1', name: '@everyone', color: 0, hoist: false, position: 0, permissions: '0', managed: false, mentionable: false },
  { id: '10', name: 'Moderator', color: 0x3498db, hoist: true, position: 1, permissions: '0', managed: false, mentionable: true },
  { id: '11', name: 'Admin', color: 0xe74c3c, hoist: true, position: 2, permissions: '0', managed: false, mentionable: false },
];

function createTestStore(channelOverrides: Record<string, unknown> = {}) {
  return configureStore({
    reducer: {
      channels: channelsSlice.reducer,
      roles: rolesSlice.reducer,
    },
    preloadedState: {
      channels: {
        channels: {
          '100': {
            id: '100',
            guild_id: '1',
            type: 0,
            name: 'general',
            topic: 'A general chat channel',
            position: 0,
            parent_id: null,
            nsfw: false,
            rate_limit_per_user: 0,
            ...channelOverrides,
          },
          '101': {
            id: '101',
            guild_id: '1',
            type: 0,
            name: 'random',
            topic: null,
            position: 1,
            parent_id: null,
            nsfw: false,
            rate_limit_per_user: 0,
          },
        },
        selectedChannelId: '100',
      },
      roles: {
        rolesByGuild: {
          '1': testRoles,
        },
      },
    },
  });
}

describe('ChannelSettings', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays channel name in the nav header', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('#general')).toBeInTheDocument();
  });

  it('renders Overview tab by default with channel name input', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getAllByText('Overview').length).toBeGreaterThanOrEqual(1);
    const input = screen.getByLabelText('CHANNEL NAME');
    expect(input).toHaveValue('general');
  });

  it('renders topic textarea for text channels', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    const textarea = screen.getByLabelText('CHANNEL TOPIC');
    expect(textarea).toHaveValue('A general chat channel');
  });

  it('shows save bar when changes are made', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    const input = screen.getByLabelText('CHANNEL NAME');
    fireEvent.change(input, { target: { value: 'new-name' } });
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    const closeBtn = screen.getByLabelText('Close settings');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to Delete section when clicking Delete Channel nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    const deleteNav = screen.getByText('Delete Channel');
    fireEvent.click(deleteNav);
    expect(screen.getByText(/permanently lost/i)).toBeInTheDocument();
  });

  it('shows delete confirmation dialog when delete button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    // Navigate to delete section
    fireEvent.click(screen.getByText('Delete Channel'));
    // Click the delete button in the danger zone
    const deleteButtons = screen.getAllByRole('button', { name: /delete channel/i });
    // The last one should be in the danger zone content area
    const dangerDeleteBtn = deleteButtons[deleteButtons.length - 1] as HTMLElement;
    fireEvent.click(dangerDeleteBtn);
    // The confirmation dialog should appear - check for the dialog element
    expect(screen.getByLabelText('Confirm delete channel')).toBeInTheDocument();
    // Should have a Cancel button in the dialog
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('resets form when Reset button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    const input = screen.getByLabelText('CHANNEL NAME');
    fireEvent.change(input, { target: { value: 'modified-name' } });
    expect(input).toHaveValue('modified-name');

    const resetBtn = screen.getByText('Reset');
    fireEvent.click(resetBtn);
    expect(input).toHaveValue('general');
  });

  it('renders NSFW toggle for text channels', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByRole('switch', { name: 'NSFW Channel' })).toBeInTheDocument();
  });

  it('renders slowmode select for text channels', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ChannelSettings channelId="100" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByLabelText('SLOWMODE')).toBeInTheDocument();
  });

  it('returns null when channel does not exist', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <ChannelSettings channelId="nonexistent" onClose={onClose} />
      </Provider>,
    );
    expect(container.innerHTML).toBe('');
  });

  describe('voice channel settings', () => {
    function createVoiceStore(overrides: Record<string, unknown> = {}) {
      return configureStore({
        reducer: {
          channels: channelsSlice.reducer,
          roles: rolesSlice.reducer,
        },
        preloadedState: {
          channels: {
            channels: {
              '200': {
                id: '200',
                guild_id: '1',
                type: 2,
                name: 'General Voice',
                topic: null,
                position: 0,
                parent_id: null,
                bitrate: 64000,
                user_limit: 0,
                rtc_region: null,
                video_quality_mode: 1,
                ...overrides,
              },
            },
            selectedChannelId: '200',
          },
          roles: {
            rolesByGuild: {
              '1': testRoles,
            },
          },
        },
      });
    }

    it('renders voice channel with speaker icon in nav header', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      // Should not show # prefix for voice channels
      expect(screen.queryByText('#General Voice')).not.toBeInTheDocument();
      // Should show the channel name (within the icon span)
      expect(screen.getByText(/General Voice/)).toBeInTheDocument();
    });

    it('renders bitrate slider for voice channels', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByLabelText('Bitrate')).toBeInTheDocument();
      expect(screen.getByText('64kbps')).toBeInTheDocument();
    });

    it('renders user limit input for voice channels', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByLabelText('USER LIMIT')).toBeInTheDocument();
      expect(screen.getByText('No Limit')).toBeInTheDocument();
    });

    it('renders region override dropdown for voice channels', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByLabelText('REGION OVERRIDE')).toBeInTheDocument();
    });

    it('renders video quality dropdown for voice channels', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByLabelText('VIDEO QUALITY')).toBeInTheDocument();
    });

    it('does NOT render topic, NSFW, or slowmode for voice channels', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      expect(screen.queryByLabelText('CHANNEL TOPIC')).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'NSFW Channel' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('SLOWMODE')).not.toBeInTheDocument();
    });

    it('shows save bar when voice settings are changed', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      const bitrateSlider = screen.getByLabelText('Bitrate');
      fireEvent.change(bitrateSlider, { target: { value: '96000' } });
      expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    });

    it('shows user count text when user limit is set', () => {
      const store = createVoiceStore({ user_limit: 5 });
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByText('5 users')).toBeInTheDocument();
    });

    it('clamps user limit between 0 and 99', () => {
      const store = createVoiceStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      const input = screen.getByLabelText('USER LIMIT') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '150' } });
      expect(input.value).toBe('99');
    });
  });

  describe('permissions editor', () => {
    it('switches to Permissions tab and shows role list', async () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="100" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      expect(screen.getByText('ROLES')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByText('@everyone')).toBeInTheDocument();
      });
    });

    it('shows text channel permissions for text channels', async () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="100" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      await waitFor(() => {
        expect(screen.getByText('Text Channel Permissions')).toBeInTheDocument();
      });
      expect(screen.getByText('View Channel')).toBeInTheDocument();
      expect(screen.getByText('Send Messages')).toBeInTheDocument();
    });

    it('shows voice channel permissions for voice channels', async () => {
      const store = configureStore({
        reducer: {
          channels: channelsSlice.reducer,
          roles: rolesSlice.reducer,
        },
        preloadedState: {
          channels: {
            channels: {
              '200': {
                id: '200',
                guild_id: '1',
                type: 2,
                name: 'Voice',
                topic: null,
                position: 0,
                parent_id: null,
                bitrate: 64000,
                user_limit: 0,
                rtc_region: null,
                video_quality_mode: 1,
              },
            },
            selectedChannelId: '200',
          },
          roles: {
            rolesByGuild: { '1': testRoles },
          },
        },
      });
      render(
        <Provider store={store}>
          <ChannelSettings channelId="200" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      await waitFor(() => {
        expect(screen.getByText('Voice Channel Permissions')).toBeInTheDocument();
      });
      expect(screen.getByText('Connect')).toBeInTheDocument();
      expect(screen.getByText('Speak')).toBeInTheDocument();
    });

    it('shows add role button that opens a dropdown', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="100" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      const addBtn = screen.getByLabelText('Add a role');
      fireEvent.click(addBtn);
      // The dropdown should show roles not yet added (Moderator, Admin since @everyone is auto-added)
      expect(screen.getByText('Moderator')).toBeInTheDocument();
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('adds a role to the overwrites list when clicked in dropdown', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="100" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      const addBtn = screen.getByLabelText('Add a role');
      fireEvent.click(addBtn);
      fireEvent.click(screen.getByText('Moderator'));
      // Now 'Moderator' should appear in the role list sidebar
      // The dropdown should close and Moderator should be in the role list
      const roleItems = screen.getAllByText('Moderator');
      expect(roleItems.length).toBeGreaterThanOrEqual(1);
    });

    it('renders permission toggle buttons with allow/inherit/deny states', async () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="100" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      await waitFor(() => {
        expect(screen.getAllByTitle('Allow').length).toBeGreaterThan(0);
      });
      const inheritBtns = screen.getAllByTitle('Inherit (use server default)');
      const denyBtns = screen.getAllByTitle('Deny');
      expect(inheritBtns.length).toBeGreaterThan(0);
      expect(denyBtns.length).toBeGreaterThan(0);
    });

    it('shows Save Permissions button', async () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <ChannelSettings channelId="100" onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Permissions'));
      await waitFor(() => {
        expect(screen.getByText('Save Permissions')).toBeInTheDocument();
      });
    });
  });
});
