import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { FollowChannelModal } from './FollowChannelModal';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { membersSlice } from '../../stores/membersSlice';

const mockFollowAnnouncementChannel = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    followAnnouncementChannel: (...args: unknown[]) => mockFollowAnnouncementChannel(...args),
  },
}));

// MANAGE_WEBHOOKS is bit 29.
const MANAGE_WEBHOOKS = (1n << 29n).toString();
const NO_PERMS = '0';

interface TestGuild {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  member_count: number;
}

interface TestChannel {
  id: string;
  guild_id: string | null;
  type: number;
  name: string | null;
  topic: string | null;
  position: number;
  parent_id: string | null;
}

function createTestStore(opts: {
  guilds?: TestGuild[];
  channels?: TestChannel[];
  rolesByGuild?: Record<string, Array<{ id: string; name: string; color: number; hoist: boolean; position: number; permissions: string; managed: boolean; mentionable: boolean }>>;
  membersByGuild?: Record<string, Array<{ user: { id: string; username: string; displayName: string; avatar: string | null; bot: boolean }; roles: string[]; nick: string | null; joinedAt: string }>>;
} = {}) {
  const guildsRecord: Record<string, TestGuild> = {};
  for (const g of opts.guilds ?? []) guildsRecord[g.id] = g;

  const channelsRecord: Record<string, TestChannel> = {};
  for (const c of opts.channels ?? []) channelsRecord[c.id] = c;

  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
      roles: rolesSlice.reducer,
      members: membersSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: guildsRecord,
        selectedGuildId: null,
        folders: [],
      },
      channels: {
        channels: channelsRecord,
        selectedChannelId: null,
      },
      auth: {
        token: 'test-token',
        user: { id: 'u1', username: 'TestUser', avatar: null, email: 'test@test.com' },
        isAuthenticated: true,
        status: 'online' as const,
        customStatus: null,
      },
      roles: {
        rolesByGuild: opts.rolesByGuild ?? {},
      },
      members: {
        membersByGuild: opts.membersByGuild ?? {},
        isLoading: false,
      },
    },
  });
}

describe('FollowChannelModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dialog with the expected aria-label', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByRole('dialog', { name: 'Follow announcement channel' })).toBeInTheDocument();
  });

  it('lists guilds the user owns as follow targets', () => {
    const store = createTestStore({
      guilds: [{ id: 'g1', name: 'My Server', icon: null, owner_id: 'u1', member_count: 1 }],
    });
    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('My Server')).toBeInTheDocument();
  });

  it('excludes a guild when loaded role data shows the user lacks MANAGE_WEBHOOKS', () => {
    const store = createTestStore({
      guilds: [
        { id: 'g1', name: 'Owned Server', icon: null, owner_id: 'u1', member_count: 1 },
        { id: 'g2', name: 'No Perms Server', icon: null, owner_id: 'someone-else', member_count: 1 },
      ],
      rolesByGuild: {
        g2: [{ id: 'g2', name: '@everyone', color: 0, hoist: false, position: 0, permissions: NO_PERMS, managed: false, mentionable: false }],
      },
      membersByGuild: {
        g2: [{ user: { id: 'u1', username: 'TestUser', displayName: 'TestUser', avatar: null, bot: false }, roles: [], nick: null, joinedAt: '' }],
      },
    });
    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Owned Server')).toBeInTheDocument();
    expect(screen.queryByText('No Perms Server')).not.toBeInTheDocument();
  });

  it('includes a guild with loaded role data granting MANAGE_WEBHOOKS', () => {
    const store = createTestStore({
      guilds: [{ id: 'g2', name: 'Webhook Manager Server', icon: null, owner_id: 'someone-else', member_count: 1 }],
      rolesByGuild: {
        g2: [{ id: 'g2', name: '@everyone', color: 0, hoist: false, position: 0, permissions: MANAGE_WEBHOOKS, managed: false, mentionable: false }],
      },
      membersByGuild: {
        g2: [{ user: { id: 'u1', username: 'TestUser', displayName: 'TestUser', avatar: null, bot: false }, roles: [], nick: null, joinedAt: '' }],
      },
    });
    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Webhook Manager Server')).toBeInTheDocument();
  });

  it('picking a guild then a text channel enables Follow and submits webhook_channel_id', async () => {
    const store = createTestStore({
      guilds: [{ id: 'g1', name: 'My Server', icon: null, owner_id: 'u1', member_count: 1 }],
      channels: [
        { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
        { id: 'c2', guild_id: 'g1', type: 2, name: 'voice', topic: null, position: 1, parent_id: null },
      ],
    });
    mockFollowAnnouncementChannel.mockResolvedValue({ channel_id: 'c1', webhook_id: 'wh1' });

    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('My Server'));

    // Voice channel should not appear as a follow target.
    expect(screen.queryByText('voice')).not.toBeInTheDocument();

    // Initially disabled until a channel is chosen.
    expect(screen.getByRole('button', { name: 'Follow' })).toBeDisabled();

    fireEvent.click(screen.getByText('general'));
    expect(screen.getByRole('button', { name: 'Follow' })).not.toBeDisabled();

    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockFollowAnnouncementChannel).toHaveBeenCalledWith('ann1', { webhook_channel_id: 'c1' });
    });

    await waitFor(() => {
      expect(screen.getByText(/Following — new posts here will appear in #general\./)).toBeInTheDocument();
    });
  });

  it('shows the error message from a rejected request without crashing', async () => {
    const store = createTestStore({
      guilds: [{ id: 'g1', name: 'My Server', icon: null, owner_id: 'u1', member_count: 1 }],
      channels: [
        { id: 'c1', guild_id: 'g1', type: 0, name: 'general', topic: null, position: 0, parent_id: null },
      ],
    });
    mockFollowAnnouncementChannel.mockRejectedValue({ message: 'Missing permission' });

    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('My Server'));
    fireEvent.click(screen.getByText('general'));
    const form = screen.getByRole('dialog').querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText('Missing permission')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <FollowChannelModal channelId="ann1" channelName="announcements" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
