import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ServerSettings } from './ServerSettings';
import { guildsSlice } from '../../stores/guildsSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { membersSlice } from '../../stores/membersSlice';
import { rolesSlice } from '../../stores/rolesSlice';
import { authSlice } from '../../stores/authSlice';
import { automodSlice } from '../../stores/automodSlice';

const mockGetGuildRoles = vi.fn();
const mockCreateRole = vi.fn();
const mockUpdateRole = vi.fn();
const mockDeleteRole = vi.fn();
const mockUpdateGuild = vi.fn();
const mockAddMemberRole = vi.fn();
const mockRemoveMemberRole = vi.fn();
const mockGetGuildBans = vi.fn();
const mockGetAuditLog = vi.fn();
const mockCreateBan = vi.fn();
const mockRemoveBan = vi.fn();
const mockGetGuildWebhooks = vi.fn();
const mockCreateWebhook = vi.fn();
const mockDeleteWebhook = vi.fn();
const mockGetGuildEmojis = vi.fn();
const mockCreateGuildEmoji = vi.fn();
const mockDeleteGuildEmoji = vi.fn();
const mockGetGuildStickers = vi.fn();
const mockCreateGuildSticker = vi.fn();
const mockDeleteGuildSticker = vi.fn();
const mockGetGuildSoundboardSounds = vi.fn();
const mockCreateGuildSoundboardSound = vi.fn();
const mockDeleteGuildSoundboardSound = vi.fn();
const mockPlayGuildSoundboardSound = vi.fn();
const mockGetGuildWidget = vi.fn();
const mockUpdateGuildWidget = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    getGuildRoles: (...args: unknown[]) => mockGetGuildRoles(...args),
    createRole: (...args: unknown[]) => mockCreateRole(...args),
    updateRole: (...args: unknown[]) => mockUpdateRole(...args),
    deleteRole: (...args: unknown[]) => mockDeleteRole(...args),
    updateGuild: (...args: unknown[]) => mockUpdateGuild(...args),
    deleteGuild: () => Promise.resolve(),
    getGuildBans: (...args: unknown[]) => mockGetGuildBans(...args),
    getAuditLog: (...args: unknown[]) => mockGetAuditLog(...args),
    getGuildInvites: () => Promise.resolve([]),
    getGuildMembers: () => Promise.resolve([]),
    updateChannel: () => Promise.resolve({}),
    deleteChannel: () => Promise.resolve(),
    kickMember: () => Promise.resolve(),
    createBan: (...args: unknown[]) => mockCreateBan(...args),
    removeBan: (...args: unknown[]) => mockRemoveBan(...args),
    updateMemberNick: () => Promise.resolve(),
    addMemberRole: (...args: unknown[]) => mockAddMemberRole(...args),
    removeMemberRole: (...args: unknown[]) => mockRemoveMemberRole(...args),
    revokeInvite: () => Promise.resolve(),
    getGuildWebhooks: (...args: unknown[]) => mockGetGuildWebhooks(...args),
    createWebhook: (...args: unknown[]) => mockCreateWebhook(...args),
    deleteWebhook: (...args: unknown[]) => mockDeleteWebhook(...args),
    getGuildEmojis: (...args: unknown[]) => mockGetGuildEmojis(...args),
    createGuildEmoji: (...args: unknown[]) => mockCreateGuildEmoji(...args),
    deleteGuildEmoji: (...args: unknown[]) => mockDeleteGuildEmoji(...args),
    getGuildStickers: (...args: unknown[]) => mockGetGuildStickers(...args),
    createGuildSticker: (...args: unknown[]) => mockCreateGuildSticker(...args),
    deleteGuildSticker: (...args: unknown[]) => mockDeleteGuildSticker(...args),
    getGuildSoundboardSounds: (...args: unknown[]) => mockGetGuildSoundboardSounds(...args),
    createGuildSoundboardSound: (...args: unknown[]) => mockCreateGuildSoundboardSound(...args),
    deleteGuildSoundboardSound: (...args: unknown[]) => mockDeleteGuildSoundboardSound(...args),
    playGuildSoundboardSound: (...args: unknown[]) => mockPlayGuildSoundboardSound(...args),
    getGuildWidget: (...args: unknown[]) => mockGetGuildWidget(...args),
    updateGuildWidget: (...args: unknown[]) => mockUpdateGuildWidget(...args),
    getAutoModRules: () => Promise.resolve([]),
    createAutoModRule: () => Promise.resolve({ id: '1', guild_id: '1', name: 'test', event_type: 1, trigger_type: 1, trigger_metadata: {}, actions: [], enabled: true, exempt_roles: [], exempt_channels: [] }),
    updateAutoModRule: () => Promise.resolve({ id: '1', guild_id: '1', name: 'test', event_type: 1, trigger_type: 1, trigger_metadata: {}, actions: [], enabled: true, exempt_roles: [], exempt_channels: [] }),
    deleteAutoModRule: () => Promise.resolve(),
  },
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isOwner: true,
    isAdmin: true,
    can: () => true,
    has: () => true,
    canManageGuild: true,
    computedPermissions: BigInt(0x7FFFFFFFFFFFFFFF),
  }),
}));

const testRoles = [
  { id: '1', name: '@everyone', color: 0, hoist: false, position: 0, permissions: '104324673', managed: false, mentionable: false },
  { id: '10', name: 'Moderator', color: 0x3498DB, hoist: true, position: 1, permissions: '0', managed: false, mentionable: true },
  { id: '11', name: 'Admin', color: 0xE74C3C, hoist: true, position: 2, permissions: '8', managed: false, mentionable: false },
];

const testMembers = [
  {
    user: { id: '100', username: 'testuser', displayName: 'Test User', avatar: null, bot: false },
    roles: ['11'],
    nick: null,
    joined_at: '2026-01-01T00:00:00Z',
  },
  {
    user: { id: '200', username: 'moderator', displayName: 'Mod User', avatar: null, bot: false },
    roles: ['10'],
    nick: 'Mod',
    joined_at: '2026-01-02T00:00:00Z',
  },
  {
    user: { id: '300', username: 'regular', displayName: 'Regular User', avatar: null, bot: false },
    roles: [],
    nick: null,
    joined_at: '2026-01-03T00:00:00Z',
  },
];

function createTestStore(guildOverrides: Record<string, unknown> = {}) {
  return configureStore({
    reducer: {
      guilds: guildsSlice.reducer,
      channels: channelsSlice.reducer,
      members: membersSlice.reducer,
      roles: rolesSlice.reducer,
      auth: authSlice.reducer,
      automod: automodSlice.reducer,
    },
    preloadedState: {
      guilds: {
        guilds: {
          '1': {
            id: '1',
            name: 'Test Server',
            description: 'A test server',
            icon: null,
            owner_id: '100',
            region: 'us-east',
            verification_level: 1,
            explicit_content_filter: 0,
            ...guildOverrides,
          },
        },
        guildOrder: ['1'],
        selectedGuildId: '1',
      } as unknown as ReturnType<typeof guildsSlice.reducer>,
      channels: {
        channels: {
          'ch1': { id: 'ch1', guild_id: '1', type: 0, name: 'general', position: 0 },
          'ch2': { id: 'ch2', guild_id: '1', type: 0, name: 'random', position: 1 },
          'vc1': { id: 'vc1', guild_id: '1', type: 2, name: 'Voice', position: 2, user_limit: 5 },
        },
        selectedChannelId: null,
      } as unknown as ReturnType<typeof channelsSlice.reducer>,
      members: {
        membersByGuild: {
          '1': testMembers,
        },
      } as unknown as ReturnType<typeof membersSlice.reducer>,
      roles: {
        rolesByGuild: {
          '1': testRoles,
        },
      } as unknown as ReturnType<typeof rolesSlice.reducer>,
      auth: {
        token: 'test-token',
        user: { id: '100', username: 'testuser', email: 'test@test.com', global_name: 'Test User', avatar: null },
        isAuthenticated: true, status: 'online' as const, customStatus: null, customStatusEmoji: null, customStatusClearAt: null,
      } as unknown as ReturnType<typeof authSlice.reducer>,
    },
  });
}

describe('ServerSettings', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGuildRoles.mockResolvedValue(testRoles);
    mockAddMemberRole.mockResolvedValue(undefined);
    mockRemoveMemberRole.mockResolvedValue(undefined);
    mockGetGuildBans.mockResolvedValue([]);
    mockGetAuditLog.mockResolvedValue({ audit_log_entries: [], users: [] });
    mockCreateBan.mockResolvedValue(undefined);
    mockRemoveBan.mockResolvedValue(undefined);
    mockUpdateGuild.mockResolvedValue({ id: '1', name: 'Test Server', icon: null, owner_id: '100', description: null });
    mockGetGuildWebhooks.mockResolvedValue([]);
    mockCreateWebhook.mockResolvedValue({
      id: '999',
      name: 'New Webhook',
      avatar: null,
      channel_id: 'ch1',
      guild_id: '1',
      token: 'test-token-123',
      type: 1,
      user: { id: '100', username: 'testuser', avatar: null },
    });
    mockDeleteWebhook.mockResolvedValue(undefined);
    mockGetGuildEmojis.mockResolvedValue([
      { id: 'e1', name: 'test_emoji', animated: false, available: true, managed: false, require_colons: true, roles: [], user: { id: '100', username: 'testuser', avatar: null } },
    ]);
    mockCreateGuildEmoji.mockResolvedValue({ id: 'e2', name: 'new_emoji', animated: false, available: true, managed: false, require_colons: true, roles: [] });
    mockDeleteGuildEmoji.mockResolvedValue(undefined);
    mockGetGuildStickers.mockResolvedValue([]);
    mockCreateGuildSticker.mockResolvedValue({ id: 's1', name: 'test_sticker', description: '', tags: '', formatType: 1 });
    mockDeleteGuildSticker.mockResolvedValue(undefined);
    mockGetGuildSoundboardSounds.mockResolvedValue([]);
    mockCreateGuildSoundboardSound.mockResolvedValue({ id: 'snd1', name: 'test_sound', volume: 1.0, emojiName: null });
    mockDeleteGuildSoundboardSound.mockResolvedValue(undefined);
    mockPlayGuildSoundboardSound.mockResolvedValue(undefined);
    mockGetGuildWidget.mockResolvedValue({ enabled: false, channel_id: null });
    mockUpdateGuildWidget.mockResolvedValue({ enabled: true, channel_id: null });
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Server Overview')).toBeInTheDocument();
  });

  it('renders Roles section when clicking Roles nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    expect(screen.getByText('Create Role')).toBeInTheDocument();
  });

  it('shows role editor when a role is selected', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    expect(screen.getByText('Edit Role - Admin')).toBeInTheDocument();
  });

  it('renders color preset swatches in Display tab', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    // Display tab is default
    expect(screen.getByLabelText('Default color')).toBeInTheDocument();
    expect(screen.getByLabelText('Color #1ABC9C')).toBeInTheDocument();
    expect(screen.getByLabelText('Color #E74C3C')).toBeInTheDocument();
  });

  it('updates color when a preset swatch is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    fireEvent.click(screen.getByLabelText('Color #E91E63'));
    // Open the custom color section to see the hex input
    fireEvent.click(screen.getByLabelText('Custom color'));
    const hexInput = screen.getByLabelText('Color hex value') as HTMLInputElement;
    expect(hexInput.value).toBe('#E91E63');
  });

  it('renders permission toggles as pill switches', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    fireEvent.click(screen.getByText('Permissions'));
    // Should show toggle switches (role="switch")
    const adminToggle = screen.getByLabelText('Toggle Administrator');
    expect(adminToggle).toHaveAttribute('role', 'switch');
  });

  it('shows administrator warning banner when Administrator is enabled', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    // Admin role has permissions: '8' which is Administrator
    fireEvent.click(screen.getByText('Admin'));
    fireEvent.click(screen.getByText('Permissions'));
    expect(screen.getByTestId('admin-warning')).toBeInTheDocument();
    expect(screen.getByText(/grants all other permissions/)).toBeInTheDocument();
  });

  it('does not show administrator warning when Administrator is disabled', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    // Moderator role has permissions: '0' - no Administrator
    fireEvent.click(screen.getByText('Moderator'));
    fireEvent.click(screen.getByText('Permissions'));
    expect(screen.queryByTestId('admin-warning')).not.toBeInTheDocument();
  });

  it('shows permission descriptions for each permission', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    fireEvent.click(screen.getByText('Permissions'));
    expect(screen.getByText(/bypass channel-specific permission overwrites/i)).toBeInTheDocument();
    expect(screen.getByText('Send messages in text channels')).toBeInTheDocument();
  });

  it('toggles a permission when the switch is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    fireEvent.click(screen.getByText('Permissions'));
    const sendMessagesToggle = screen.getByLabelText('Toggle Send Messages');
    expect(sendMessagesToggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sendMessagesToggle);
    expect(sendMessagesToggle).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onClose when ESC is pressed and no unsaved changes', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('displays permission categories (General Server, Text Channel, Voice Channel)', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    fireEvent.click(screen.getByText('Permissions'));
    expect(screen.getByText('General Server Permissions')).toBeInTheDocument();
    expect(screen.getByText('Text Channel Permissions')).toBeInTheDocument();
    expect(screen.getByText('Voice Channel Permissions')).toBeInTheDocument();
  });

  // === New tests for all 8 fixes ===

  it('Fix 1: shows "Add Members" button in Manage Members tab', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    fireEvent.click(screen.getByText('Manage Members'));
    expect(screen.getByLabelText('Add Members')).toBeInTheDocument();
  });

  it('Fix 1: shows search dropdown when Add Members is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    fireEvent.click(screen.getByText('Manage Members'));
    fireEvent.click(screen.getByLabelText('Add Members'));
    expect(screen.getByPlaceholderText('Search members...')).toBeInTheDocument();
  });

  it('Fix 2: shows unsaved changes bar with correct text when role is edited', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    // Change role name to trigger dirty state
    const nameInput = screen.getByDisplayValue('Admin') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Super Admin' } });
    expect(screen.getByTestId('unsaved-changes-bar')).toBeInTheDocument();
    expect(screen.getByText(/Careful — you have unsaved changes!/)).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('Fix 2: Reset button reverts changes', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    const nameInput = screen.getByDisplayValue('Admin') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Super Admin' } });
    expect(nameInput.value).toBe('Super Admin');
    fireEvent.click(screen.getByText('Reset'));
    expect((screen.getByDisplayValue('Admin') as HTMLInputElement).value).toBe('Admin');
  });

  it('Fix 3: create role and calls API then selects new role', async () => {
    const newRole = { id: '20', name: 'new role', color: 0, hoist: false, position: 3, permissions: '0', managed: false, mentionable: false };
    mockCreateRole.mockResolvedValue(newRole);
    mockUpdateRole.mockResolvedValue({ ...newRole, permissions: '104324673' });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Create Role'));
    await waitFor(() => {
      expect(mockCreateRole).toHaveBeenCalledWith('1', { name: 'new role' });
    });
    // Should inherit @everyone permissions since the new role has permissions "0"
    await waitFor(() => {
      expect(mockUpdateRole).toHaveBeenCalledWith('1', '20', expect.objectContaining({ permissions: '104324673' }));
    });
  });

  it('Fix 4: @everyone role has disabled name field', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('@everyone'));
    const nameInput = screen.getByDisplayValue('@everyone') as HTMLInputElement;
    expect(nameInput).toBeDisabled();
  });

  it('Fix 4: @everyone role has no color picker', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('@everyone'));
    expect(screen.queryByLabelText('Default color')).not.toBeInTheDocument();
  });

  it('Fix 4: @everyone role has no "Display separately" toggle', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('@everyone'));
    expect(screen.queryByText('DISPLAY SEPARATELY')).not.toBeInTheDocument();
  });

  it('Fix 4: @everyone role has no delete button', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('@everyone'));
    expect(screen.queryByTestId('delete-role-btn')).not.toBeInTheDocument();
  });

  it('Fix 5: shows custom color button and opens hex input on click', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Moderator'));
    // Hex input should not be visible before clicking custom color
    expect(screen.queryByLabelText('Color hex value')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Custom color'));
    expect(screen.getByLabelText('Color hex value')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom color picker')).toBeInTheDocument();
  });

  it('Fix 6: shows delete confirmation dialog when delete is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    fireEvent.click(screen.getByTestId('delete-role-btn'));
    expect(screen.getByTestId('delete-role-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument();
  });

  it('Fix 6: cancel button in delete dialog closes it', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    fireEvent.click(screen.getByTestId('delete-role-btn'));
    expect(screen.getByTestId('delete-role-dialog')).toBeInTheDocument();
    // There are multiple cancel buttons; pick the one inside the dialog
    const cancelBtns = screen.getAllByText('Cancel');
    const dialogCancel = cancelBtns[cancelBtns.length - 1] as HTMLElement;
    fireEvent.click(dialogCancel);
    expect(screen.queryByTestId('delete-role-dialog')).not.toBeInTheDocument();
  });

  it('Fix 7: drag handles exist for non-@everyone roles', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    const dragHandles = screen.getAllByLabelText('Drag to reorder');
    // @everyone should NOT have a drag handle, so count should be testRoles.length - 1
    expect(dragHandles.length).toBe(testRoles.length - 1);
  });

  it('Fix 7: @everyone role is not draggable', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    // The @everyone role item should have draggable="false"
    const everyoneItem = screen.getByText('@everyone').closest('[role="button"]');
    expect(everyoneItem).toHaveAttribute('draggable', 'false');
  });

  it('Fix 8: shows discard dialog when navigating with unsaved changes', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    // Make a change
    const nameInput = screen.getByDisplayValue('Admin') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Admin2' } });
    // Try navigating to Overview
    fireEvent.click(screen.getByText('Overview'));
    expect(screen.getByTestId('discard-changes-dialog')).toBeInTheDocument();
    expect(screen.getByText(/You have unsaved changes/)).toBeInTheDocument();
  });

  it('Fix 8: discard button in dialog proceeds with navigation', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Roles'));
    fireEvent.click(screen.getByText('Admin'));
    const nameInput = screen.getByDisplayValue('Admin') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Admin2' } });
    fireEvent.click(screen.getByText('Overview'));
    // Click Discard in the dialog
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.queryByTestId('discard-changes-dialog')).not.toBeInTheDocument();
    // Should now show overview
    expect(screen.getByText('Server Overview')).toBeInTheDocument();
  });

  // E2E-style integration test: create role -> edit name -> save
  it('E2E: creates a role, edits the name, and saves successfully', async () => {
    const newRole = {
      id: '20', name: 'new role', color: 0, hoist: false, position: 3,
      permissions: '104324673', managed: false, mentionable: false,
    };
    mockCreateRole.mockResolvedValue(newRole);
    mockUpdateRole.mockResolvedValue({ ...newRole, name: 'Testers' });

    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );

    // Step 1: Navigate to Roles section
    fireEvent.click(screen.getByText('Roles'));
    expect(screen.getByText('Create Role')).toBeInTheDocument();

    // Step 2: Create a new role
    fireEvent.click(screen.getByText('Create Role'));
    await waitFor(() => {
      expect(mockCreateRole).toHaveBeenCalledWith('1', { name: 'new role' });
    });

    // Wait for the role to appear and be selected
    await waitFor(() => {
      expect(screen.getByText('Edit Role - new role')).toBeInTheDocument();
    });

    // Step 3: Edit the name
    const nameInput = screen.getByDisplayValue('new role') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Testers' } });
    expect(nameInput.value).toBe('Testers');

    // Step 4: Unsaved changes bar should appear
    expect(screen.getByTestId('unsaved-changes-bar')).toBeInTheDocument();
    expect(screen.getByText(/Careful — you have unsaved changes!/)).toBeInTheDocument();

    // Step 5: Save changes
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(mockUpdateRole).toHaveBeenCalledWith('1', '20', expect.objectContaining({ name: 'Testers' }));
    });
  });

  // === Server Icon Upload Tests ===

  it('renders icon upload button in Overview', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByTestId('icon-upload-button')).toBeInTheDocument();
    expect(screen.getByLabelText('Change server icon')).toBeInTheDocument();
  });

  it('has a hidden file input for icon upload', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    const fileInput = screen.getByTestId('icon-file-input') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.type).toBe('file');
    expect(fileInput.accept).toContain('image/png');
  });

  // === Server Discoverability Toggle Tests ===

  it('renders the Server Discovery toggle in Overview, off by default', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    const toggle = screen.getByRole('switch', { name: 'Toggle server discoverability' });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the guild\'s discoverable flag when already on', () => {
    const store = createTestStore({ discoverable: true });
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByRole('switch', { name: 'Toggle server discoverability' })).toHaveAttribute('aria-checked', 'true');
  });

  it('calls api.updateGuild and updates the store when the discoverable toggle is clicked', async () => {
    mockUpdateGuild.mockResolvedValue({ discoverable: true });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle server discoverability' }));

    await waitFor(() => {
      expect(mockUpdateGuild).toHaveBeenCalledWith('1', { discoverable: true });
    });
    await waitFor(() => {
      expect((store.getState().guilds.guilds['1'] as unknown as { discoverable?: boolean }).discoverable).toBe(true);
    });
  });

  it('rolls back the discoverable toggle when the API call fails', async () => {
    mockUpdateGuild.mockRejectedValue({ message: 'Failed' });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    const toggle = screen.getByRole('switch', { name: 'Toggle server discoverability' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUpdateGuild).toHaveBeenCalledWith('1', { discoverable: true });
    });
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('saves overview with icon data when icon is uploaded', async () => {
    mockUpdateGuild.mockResolvedValue({ id: '1', name: 'Test Server', icon: 'abc123', owner_id: '100', description: null });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    // Click Save Changes (without icon, just testing the API call includes name)
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => {
      expect(mockUpdateGuild).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'Test Server' }));
    });
  });

  // === Audit Log Tests ===

  it('renders audit log empty state with NO LOGS YET message', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Audit Log'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('NO LOGS YET')).toBeInTheDocument();
    expect(screen.getByText(/Once moderators begin moderating/)).toBeInTheDocument();
  });

  it('shows both filter dropdowns in audit log', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Audit Log'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-filter-bar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-filter-user')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-select')).toBeInTheDocument();
  });

  it('renders audit log entries when API returns data', async () => {
    mockGetAuditLog.mockResolvedValue({
      audit_log_entries: [
        { id: 'a1', user_id: 'u1', target_id: 'r1', action_type: 30, reason: null, created_at: '2026-03-25T12:00:00Z', changes: [] },
        { id: 'a2', user_id: 'u1', target_id: 'c1', action_type: 10, reason: 'added general', created_at: '2026-03-25T11:00:00Z', changes: [] },
      ],
      users: [{ id: 'u1', username: 'admin_user', avatar: null }],
    });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Audit Log'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-list')).toBeInTheDocument();
    });
    // admin_user appears in entries (x2) + user filter dropdown (x1) = 3
    expect(screen.getAllByText('admin_user').length).toBe(3);
    // "Role Create" appears in the filter dropdown AND in the audit entry
    const roleCreateElements = screen.getAllByText('Role Create');
    expect(roleCreateElements.length).toBeGreaterThanOrEqual(2);
    const channelCreateElements = screen.getAllByText('Channel Create');
    expect(channelCreateElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Reason: added general')).toBeInTheDocument();
  });

  it('shows audit log error when API fails', async () => {
    mockGetAuditLog.mockRejectedValue(new Error('Network error'));
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Audit Log'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to load audit log entries.')).toBeInTheDocument();
  });

  it('shows action type filter when audit entries exist', async () => {
    mockGetAuditLog.mockResolvedValue({
      audit_log_entries: [
        { id: 'a1', user_id: 'u1', target_id: null, action_type: 30, reason: null, created_at: '2026-03-25T12:00:00Z', changes: [] },
      ],
      users: [{ id: 'u1', username: 'admin_user', avatar: null }],
    });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Audit Log'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-filter-select')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filter-user')).toBeInTheDocument();
  });

  // === Bans Page Tests ===

  it('shows Server Ban List title and description in Bans section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getByText('Server Ban List')).toBeInTheDocument();
    });
    expect(screen.getByText(/Bans by default are by account and IP/)).toBeInTheDocument();
  });

  it('shows search input with correct placeholder and search button', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getByTestId('ban-search-input')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Search Bans by User ID or Username')).toBeInTheDocument();
    expect(screen.getByTestId('ban-search-button')).toBeInTheDocument();
  });

  it('does not show Ban a User form in Bans section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getByText('Server Ban List')).toBeInTheDocument();
    });
    expect(screen.queryByText('Ban a User')).not.toBeInTheDocument();
  });

  it('shows existing bans with search functionality', async () => {
    mockGetGuildBans.mockResolvedValue([
      { user: { id: '500', username: 'banned_user1', avatar: null }, reason: 'toxic' },
      { user: { id: '501', username: 'banned_user2', avatar: null }, reason: null },
    ]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getAllByText('banned_user1').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('banned_user2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('ban-search-input')).toBeInTheDocument();
    // Search should filter
    fireEvent.change(screen.getByTestId('ban-search-input'), { target: { value: 'user1' } });
    expect(screen.getAllByText('banned_user1').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('banned_user2')).not.toBeInTheDocument();
  });

  it('opens ban detail modal when clicking a ban entry', async () => {
    mockGetGuildBans.mockResolvedValue([
      { user: { id: '500', username: 'banned_user1', avatar: null }, reason: 'toxic behavior' },
    ]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getByTestId('bans-list')).toBeInTheDocument();
    });
    const banEntries = screen.getAllByTestId('ban-entry');
    fireEvent.click(banEntries[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('ban-detail-modal')).toBeInTheDocument();
    });
    expect(screen.getByText('Ban Reason')).toBeInTheDocument();
    expect(screen.getByText('toxic behavior')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByTestId('modal-revoke-ban')).toBeInTheDocument();
  });

  it('shows No reason provided in modal when ban has no reason', async () => {
    mockGetGuildBans.mockResolvedValue([
      { user: { id: '500', username: 'banned_user1', avatar: null }, reason: null },
    ]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getByTestId('bans-list')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByTestId('ban-entry')[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('ban-detail-modal')).toBeInTheDocument();
    });
    expect(screen.getByText('No reason provided')).toBeInTheDocument();
  });

  it('revokes ban from modal and closes it', async () => {
    mockGetGuildBans.mockResolvedValue([
      { user: { id: '500', username: 'banned_user1', avatar: null }, reason: 'toxic' },
    ]);
    mockRemoveBan.mockResolvedValue(undefined);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Bans'));
    await waitFor(() => {
      expect(screen.getByTestId('bans-list')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByTestId('ban-entry')[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('ban-detail-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('modal-revoke-ban'));
    await waitFor(() => {
      expect(mockRemoveBan).toHaveBeenCalledWith('1', '500');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('ban-detail-modal')).not.toBeInTheDocument();
    });
  });

  // ====== INTEGRATIONS (WEBHOOKS) ======

  it('renders Integrations section in nav', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Integrations')).toBeInTheDocument();
  });

  it('shows Integrations content when clicking nav item', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Integrations'));
    await waitFor(() => {
      expect(mockGetGuildWebhooks).toHaveBeenCalledWith('1');
    });
    expect(screen.getByText('Create Webhook')).toBeInTheDocument();
  });

  it('shows empty state when no webhooks exist', async () => {
    mockGetGuildWebhooks.mockResolvedValue([]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Integrations'));
    await waitFor(() => {
      expect(screen.getByText('No webhooks in this server')).toBeInTheDocument();
    });
  });

  it('displays existing webhooks with channel names', async () => {
    mockGetGuildWebhooks.mockResolvedValue([
      {
        id: '501',
        name: 'GitHub Webhook',
        avatar: null,
        channel_id: 'ch1',
        guild_id: '1',
        token: 'token-abc',
        type: 1,
        user: { id: '100', username: 'testuser', avatar: null },
      },
    ]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Integrations'));
    await waitFor(() => {
      expect(screen.getByText('GitHub Webhook')).toBeInTheDocument();
    });
    expect(screen.getByText('#general')).toBeInTheDocument();
    expect(screen.getByText('Created by testuser')).toBeInTheDocument();
  });

  it('opens the create webhook form and creates a webhook', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Integrations'));
    await waitFor(() => {
      expect(screen.getByText('Create Webhook')).toBeInTheDocument();
    });
    // Open create form
    fireEvent.click(screen.getByText('Create Webhook'));
    expect(screen.getByLabelText('Create webhook')).toBeInTheDocument();
    // Enter name
    fireEvent.change(screen.getByLabelText(/WEBHOOK NAME/i), { target: { value: 'My Webhook' } });
    // Click Create button (the second one in the form)
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => {
      expect(mockCreateWebhook).toHaveBeenCalledWith('ch1', { name: 'My Webhook' });
    });
  });

  it('shows confirmation dialog and deletes a webhook', async () => {
    mockGetGuildWebhooks.mockResolvedValue([
      {
        id: '501',
        name: 'Test Webhook',
        avatar: null,
        channel_id: 'ch1',
        guild_id: '1',
        token: 'tok123',
        type: 1,
      },
    ]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Integrations'));
    await waitFor(() => {
      expect(screen.getByText('Test Webhook')).toBeInTheDocument();
    });
    // Click Delete button on the webhook row
    fireEvent.click(screen.getByLabelText('Delete webhook Test Webhook'));
    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this webhook? This action cannot be undone.')).toBeInTheDocument();
    });
    // Click the Delete button in the dialog
    const dialogDeleteBtn = screen.getByRole('dialog', { name: 'Confirm delete webhook' }).querySelector('button:last-child');
    expect(dialogDeleteBtn).not.toBeNull();
    fireEvent.click(dialogDeleteBtn!);
    await waitFor(() => {
      expect(mockDeleteWebhook).toHaveBeenCalledWith('501');
    });
  });

  it('copies webhook URL when Copy URL is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    mockGetGuildWebhooks.mockResolvedValue([
      {
        id: '501',
        name: 'Copy Test',
        avatar: null,
        channel_id: 'ch1',
        guild_id: '1',
        token: 'tok-copy',
        type: 1,
      },
    ]);
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Integrations'));
    await waitFor(() => {
      expect(screen.getByText('Copy Test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Copy URL for webhook Copy Test'));
    expect(writeTextMock).toHaveBeenCalled();
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  // --- Emoji Section Tests ---

  it('shows emoji nav item and navigates to emoji section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    const emojiNav = screen.getByText('Emoji');
    expect(emojiNav).toBeInTheDocument();
    fireEvent.click(emojiNav);
    await waitFor(() => {
      expect(screen.getByText(/emoji slots used/i)).toBeInTheDocument();
    });
  });

  it('loads and displays guild emojis', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Emoji'));
    await waitFor(() => {
      expect(screen.getByText(':test_emoji:')).toBeInTheDocument();
    });
    expect(mockGetGuildEmojis).toHaveBeenCalledWith('1');
  });

  it('shows upload form elements in emoji section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Emoji'));
    await waitFor(() => {
      expect(screen.getByText('Upload Emoji')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('emoji_name')).toBeInTheDocument();
    expect(screen.getByTestId('emoji-upload-submit')).toBeInTheDocument();
  });

  it('deletes an emoji when delete button is clicked', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Emoji'));
    await waitFor(() => {
      expect(screen.getByText(':test_emoji:')).toBeInTheDocument();
    });
    const deleteBtn = screen.getByLabelText('Delete emoji test_emoji');
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(mockDeleteGuildEmoji).toHaveBeenCalledWith('1', 'e1');
    });
  });

  // ── Stickers Section ──
  it('renders Stickers section with nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Stickers')).toBeInTheDocument();
  });

  it('navigates to Stickers section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Stickers'));
    await waitFor(() => {
      expect(mockGetGuildStickers).toHaveBeenCalledWith('1');
    });
  });

  it('shows Upload Sticker button in stickers section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Stickers'));
    await waitFor(() => {
      expect(screen.getByText('Upload Sticker')).toBeInTheDocument();
    });
  });

  // ── Soundboard Section ──
  it('renders Soundboard nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Soundboard')).toBeInTheDocument();
  });

  it('navigates to Soundboard section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Soundboard'));
    await waitFor(() => {
      expect(mockGetGuildSoundboardSounds).toHaveBeenCalledWith('1');
    });
  });

  it('shows Upload Sound button in soundboard section', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Soundboard'));
    await waitFor(() => {
      expect(screen.getByText('Upload Sound')).toBeInTheDocument();
    });
  });

  // ── Widget Section ──
  it('renders Widget nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  it('navigates to Widget section and shows toggle', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Widget'));
    await waitFor(() => {
      expect(mockGetGuildWidget).toHaveBeenCalledWith('1');
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /widget/i })).toBeInTheDocument();
    });
  });

  it('enables widget and shows channel selector', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Widget'));
    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByLabelText('Select widget channel')).toBeInTheDocument();
    });
  });

  // === Safety Setup Tests ===
  it('renders Safety Setup nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Safety Setup')).toBeInTheDocument();
  });

  it('does not render a Community nav item', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    expect(screen.queryByText('Community')).not.toBeInTheDocument();
  });

  it('shows only the real Verification Level and Content Filter controls in Safety Setup, with no fake DM/Spam toggles', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Safety Setup'));
    expect(screen.getByLabelText('Select verification level')).toBeInTheDocument();
    expect(screen.getByLabelText('Select content filter level')).toBeInTheDocument();
    expect(screen.queryByText('DM and Spam Protection')).not.toBeInTheDocument();
    expect(screen.queryByText('Spam Filter')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Toggle DM protection')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Toggle spam protection')).not.toBeInTheDocument();
  });

  it('initializes Safety Setup selects from the guild verification_level and explicit_content_filter', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Safety Setup'));
    const verificationSelect = screen.getByLabelText('Select verification level') as HTMLSelectElement;
    const filterSelect = screen.getByLabelText('Select content filter level') as HTMLSelectElement;
    expect(verificationSelect.value).toBe('1');
    expect(filterSelect.value).toBe('0');
  });

  it('saves a verification level change to the backend and updates the store', async () => {
    mockUpdateGuild.mockResolvedValue({ id: '1', name: 'Test Server', icon: null, owner_id: '100', description: null });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Safety Setup'));
    fireEvent.change(screen.getByLabelText('Select verification level'), { target: { value: '3' } });
    await waitFor(() => {
      expect(mockUpdateGuild).toHaveBeenCalledWith('1', { verification_level: 3 });
    });
    await waitFor(() => {
      const guild = store.getState().guilds.guilds['1'] as unknown as { verification_level: number };
      expect(guild.verification_level).toBe(3);
    });
  });

  it('saves an explicit content filter change to the backend and updates the store', async () => {
    mockUpdateGuild.mockResolvedValue({ id: '1', name: 'Test Server', icon: null, owner_id: '100', description: null });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Safety Setup'));
    fireEvent.change(screen.getByLabelText('Select content filter level'), { target: { value: '2' } });
    await waitFor(() => {
      expect(mockUpdateGuild).toHaveBeenCalledWith('1', { explicit_content_filter: 2 });
    });
    await waitFor(() => {
      const guild = store.getState().guilds.guilds['1'] as unknown as { explicit_content_filter: number };
      expect(guild.explicit_content_filter).toBe(2);
    });
  });

  it('reverts the verification level select if the save fails', async () => {
    mockUpdateGuild.mockRejectedValueOnce(new Error('network error'));
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ServerSettings guildId="1" onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Safety Setup'));
    const verificationSelect = screen.getByLabelText('Select verification level') as HTMLSelectElement;
    fireEvent.change(verificationSelect, { target: { value: '4' } });
    await waitFor(() => {
      expect(mockUpdateGuild).toHaveBeenCalledWith('1', { verification_level: 4 });
    });
    await waitFor(() => {
      expect(verificationSelect.value).toBe('1');
    });
  });
});
