import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { MemberList } from './MemberList';
import { membersSlice } from '../../stores/membersSlice';
import { uiSlice } from '../../stores/uiSlice';
import { authSlice } from '../../stores/authSlice';
import { guildsSlice } from '../../stores/guildsSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { presenceSlice } from '../../stores/presenceSlice';
import { dmSlice } from '../../stores/dmSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import type { GuildMember } from '../../stores/membersSlice';

const mockGetGuildMembers = vi.fn();
const mockKickMember = vi.fn();
const mockCreateBan = vi.fn();
const mockCreateDm = vi.fn();
const mockUpdateMemberNick = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getGuildMembers: (...args: unknown[]) => mockGetGuildMembers(...args),
    kickMember: (...args: unknown[]) => mockKickMember(...args),
    createBan: (...args: unknown[]) => mockCreateBan(...args),
    createDm: (...args: unknown[]) => mockCreateDm(...args),
    updateMemberNick: (...args: unknown[]) => mockUpdateMemberNick(...args),
  },
}));

function createMockMember(id: string, username: string, overrides?: Partial<GuildMember>): GuildMember {
  return {
    user: {
      id,
      username,
      displayName: username,
      avatar: null,
      bot: false,
    },
    roles: [],
    nick: null,
    joinedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const defaultAuthState = {
  user: { id: 'current-user', username: 'testuser', email: 'test@test.com' },
  token: 'test-token',
  isLoading: false,
  error: null,
};

const defaultGuildsState = {
  guilds: {
    'guild-1': { id: 'guild-1', name: 'Test Guild', icon: null, owner_id: 'current-user', member_count: 5 },
  },
  selectedGuildId: 'guild-1',
};

const defaultUiState = {
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
};

type PresenceOverrides = Record<string, { userId: string; status: string; clientStatus: Record<string, unknown>; activities: unknown[] }>;

function createTestStore(members: GuildMember[] = [], overrides?: { isLoading?: boolean; presences?: PresenceOverrides }) {
  return configureStore({
    reducer: {
      members: membersSlice.reducer,
      ui: uiSlice.reducer,
      auth: authSlice.reducer,
      guilds: guildsSlice.reducer,
      roles: rolesSlice.reducer,
      presence: presenceSlice.reducer,
      dm: dmSlice.reducer,
      channels: channelsSlice.reducer,
    },
    preloadedState: {
      members: {
        membersByGuild: {
          'guild-1': members,
        },
        isLoading: overrides?.isLoading ?? false,
      },
      ui: defaultUiState,
      auth: defaultAuthState,
      guilds: defaultGuildsState,
      roles: {
        rolesByGuild: {},
      },
      presence: {
        presences: overrides?.presences ?? {},
        selfStatus: 'online' as const,
      },
      dm: {
        dmChannels: [],
        selectedDmChannelId: null,
      },
      channels: {
        channels: {},
        selectedChannelId: null,
      },
    },
  });
}

function renderMemberList(store: ReturnType<typeof createTestStore>, guildId: string | null = 'guild-1') {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <MemberList guildId={guildId} />
      </MemoryRouter>
    </Provider>
  );
}

describe('MemberList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // MemberList always re-fetches members on mount; leave that fetch pending so it
    // never clobbers the members seeded into the store via preloadedState below.
    mockGetGuildMembers.mockReturnValue(new Promise(() => {}));
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = renderMemberList(store);
    expect(container).toBeTruthy();
  });

  it('renders null when guildId is null', () => {
    const store = createTestStore();
    const { container } = renderMemberList(store, null);
    expect(container.innerHTML).toBe('');
  });

  it('renders member list with correct aria label', () => {
    const members = [createMockMember('0', 'Alice')];
    const store = createTestStore(members);
    renderMemberList(store);
    expect(screen.getByRole('complementary', { name: 'Member list' })).toBeInTheDocument();
  });

  it('displays member names', () => {
    const members = [
      createMockMember('0', 'Alice'),
      createMockMember('4', 'Bob'),
    ];
    const store = createTestStore(members);
    renderMemberList(store);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('displays nickname when available', () => {
    const members = [createMockMember('0', 'Alice', { nick: 'AliceNick' })];
    const store = createTestStore(members);
    renderMemberList(store);
    expect(screen.getByText('AliceNick')).toBeInTheDocument();
  });

  it('displays avatar initials when no avatar url', () => {
    const members = [createMockMember('0', 'Alice')];
    const store = createTestStore(members);
    renderMemberList(store);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('groups members into online and offline based on presence', () => {
    const members = [
      createMockMember('user-1', 'Alice'),
      createMockMember('user-2', 'Bob'),
      createMockMember('user-3', 'Charlie'),
      createMockMember('user-4', 'Dave'),
    ];
    const store = createTestStore(members, {
      presences: {
        'user-1': { userId: 'user-1', status: 'online', clientStatus: {}, activities: [] },
        'user-2': { userId: 'user-2', status: 'idle', clientStatus: {}, activities: [] },
        'user-3': { userId: 'user-3', status: 'dnd', clientStatus: {}, activities: [] },
        // user-4 has no presence => offline
      },
    });
    renderMemberList(store);
    expect(screen.getByText(/Online/)).toBeInTheDocument();
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('shows skeleton loading when loading and no members', () => {
    const store = createTestStore([], { isLoading: true });
    renderMemberList(store);
    expect(screen.getByRole('complementary', { name: 'Member list' })).toBeInTheDocument();
  });

  it('shows crown icon for the server owner', () => {
    const members = [
      createMockMember('current-user', 'Owner'),
      createMockMember('4', 'Regular'),
    ];
    const store = createTestStore(members);
    renderMemberList(store);
    // The owner member should have a crown icon with 'Server Owner' label
    expect(screen.getByLabelText('Server Owner')).toBeInTheDocument();
  });

  it('opens popover on member click', () => {
    const members = [createMockMember('0', 'Alice')];
    const store = createTestStore(members);
    renderMemberList(store);
    const memberItem = screen.getByRole('button', { name: /Alice/ });
    fireEvent.click(memberItem);
    expect(store.getState().ui.activePopoverUserId).toBe('0');
  });

  it('kicks a member from the context menu', async () => {
    mockKickMember.mockResolvedValue(undefined);
    const members = [createMockMember('member-1', 'Alice'), createMockMember('member-2', 'Bob')];
    const store = createTestStore(members);
    renderMemberList(store);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByText('Kick'));

    expect(mockKickMember).toHaveBeenCalledWith('guild-1', 'member-1');
    await waitFor(() => {
      const remaining = store.getState().members.membersByGuild['guild-1'];
      expect(remaining?.map(m => m.user.id)).toEqual(['member-2']);
    });
  });

  it('bans a member from the context menu', async () => {
    mockCreateBan.mockResolvedValue(undefined);
    const members = [createMockMember('member-1', 'Alice'), createMockMember('member-2', 'Bob')];
    const store = createTestStore(members);
    renderMemberList(store);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByText('Ban'));

    expect(mockCreateBan).toHaveBeenCalledWith('guild-1', 'member-1');
    await waitFor(() => {
      const remaining = store.getState().members.membersByGuild['guild-1'];
      expect(remaining?.map(m => m.user.id)).toEqual(['member-2']);
    });
  });

  it('opens a DM when Message is clicked from the context menu', async () => {
    mockCreateDm.mockResolvedValue({
      id: 'dm-1',
      type: 1,
      recipients: [{ id: 'member-1', username: 'Alice', avatar: null }],
      last_message_id: null,
    });
    const members = [createMockMember('member-1', 'Alice')];
    const store = createTestStore(members);
    renderMemberList(store);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByText('Message'));

    expect(mockCreateDm).toHaveBeenCalledWith('member-1');
    await waitFor(() => {
      expect(store.getState().dm.selectedDmChannelId).toBe('dm-1');
    });
    expect(store.getState().channels.channels['dm-1']).toBeTruthy();
  });

  it('inserts an @mention into the open message composer', () => {
    const members = [createMockMember('member-1', 'Alice')];
    const store = createTestStore(members);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <textarea aria-label="Message #general" />
          <MemberList guildId="guild-1" />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByText('Mention'));

    const textarea = screen.getByLabelText('Message #general') as HTMLTextAreaElement;
    expect(textarea.value).toBe('@Alice ');
  });

  it('changes a member nickname from the context menu', async () => {
    mockUpdateMemberNick.mockResolvedValue(undefined);
    const members = [createMockMember('member-1', 'Alice')];
    const store = createTestStore(members);
    renderMemberList(store);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByText('Change Nickname'));

    const input = screen.getByLabelText('Nickname');
    fireEvent.change(input, { target: { value: 'AliceCool' } });
    fireEvent.click(screen.getByText('Save'));

    expect(mockUpdateMemberNick).toHaveBeenCalledWith('guild-1', 'member-1', 'AliceCool');
    await waitFor(() => {
      expect(screen.getByText('AliceCool')).toBeInTheDocument();
    });
  });
});
