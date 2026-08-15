import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { shallowEqual } from 'react-redux';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { updateGuild, removeGuild } from '../../stores/guildsSlice';
import type { Guild } from '../../stores/guildsSlice';
import { setRoles, addRole, updateRole as updateRoleAction, removeRole } from '../../stores/rolesSlice';
import { removeChannel, updateChannel as updateChannelAction } from '../../stores/channelsSlice';
import { removeMember, updateMember } from '../../stores/membersSlice';
import { usePermissions } from '../../hooks/usePermissions';
import { api } from '../../api/rest';
import { cdnBase, emojiUrl } from '../../utils/cdn';
import type { Role } from '../../stores/rolesSlice';

import { fetchAutoModRules, createAutoModRule, updateAutoModRule } from '../../stores/automodSlice';
import type { AutoModRule } from '../../stores/automodSlice';
import styles from './serverSettings.module.scss';

/** Stable empty array used as selector fallback to avoid new references on every render. */
const EMPTY_ARRAY: never[] = [];

/** Returns true when @everyone role is selected (position 0) */
const isEveryoneRole = (role: Role | undefined): boolean =>
  role !== undefined && role.position === 0;

type Section =
  | 'overview'
  | 'roles'
  | 'emoji'
  | 'stickers'
  | 'soundboard'
  | 'widget'
  | 'server-template'
  | 'vanity-url'
  | 'channels'
  | 'members'
  | 'bans'
  | 'automod'
  | 'safety-setup'
  | 'audit-log'
  | 'invites'
  | 'integrations'
  | 'onboarding'
  | 'welcome-screen'
  | 'delete';

interface WebhookEntry {
  id: string;
  name: string;
  avatar: string | null;
  channel_id: string;
  guild_id: string;
  token?: string;
  type: number;
  user?: { id: string; username: string; avatar: string | null };
}

const AUDIT_ACTION_NAMES: Record<number, string> = {
  1: 'Guild Update',
  10: 'Channel Create',
  11: 'Channel Update',
  12: 'Channel Delete',
  13: 'Channel Overwrite Create',
  14: 'Channel Overwrite Update',
  15: 'Channel Overwrite Delete',
  20: 'Member Kick',
  22: 'Member Ban Add',
  23: 'Member Ban Remove',
  24: 'Member Update',
  25: 'Member Role Update',
  30: 'Role Create',
  31: 'Role Update',
  32: 'Role Delete',
  40: 'Invite Create',
  41: 'Invite Update',
  42: 'Invite Delete',
  50: 'Webhook Create',
  51: 'Webhook Update',
  52: 'Webhook Delete',
  60: 'Emoji Create',
  61: 'Emoji Update',
  62: 'Emoji Delete',
  72: 'Message Delete',
  73: 'Message Bulk Delete',
  74: 'Message Pin',
  75: 'Message Unpin',
};

interface PermissionCategory {
  label: string;
  flags: Array<{ name: string; bit: bigint; description: string }>;
}

const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'General Server Permissions',
    flags: [
      { name: 'Administrator', bit: BigInt(0x8), description: 'Members with this permission have every permission and can also bypass channel-specific permission overwrites. This is a dangerous permission to grant.' },
      { name: 'View Audit Log', bit: BigInt(0x80), description: 'View the audit log for this server' },
      { name: 'Manage Server', bit: BigInt(0x20), description: 'Edit server name, region, icon, and other settings' },
      { name: 'Manage Roles', bit: BigInt(0x10000000), description: 'Create and edit roles below this one' },
      { name: 'Manage Channels', bit: BigInt(0x10), description: 'Create, edit, and delete channels' },
      { name: 'Kick Members', bit: BigInt(0x2), description: 'Remove members from the server' },
      { name: 'Ban Members', bit: BigInt(0x4), description: 'Permanently ban members from the server' },
      { name: 'Create Instant Invite', bit: BigInt(0x1), description: 'Create invites to this server' },
      { name: 'Change Nickname', bit: BigInt(0x4000000), description: 'Change their own nickname' },
      { name: 'Manage Nicknames', bit: BigInt(0x8000000), description: 'Change nicknames of other members' },
      { name: 'Manage Webhooks', bit: BigInt(0x20000000), description: 'Create, edit, and delete webhooks' },
      { name: 'Manage Expressions', bit: BigInt(0x40000000), description: 'Manage custom emoji, stickers, and soundboard' },
      { name: 'View Channel', bit: BigInt(0x400), description: 'View channels and read messages' },
      { name: 'Moderate Members', bit: BigInt(1) << BigInt(40), description: 'Timeout members to temporarily prevent them from sending messages, reacting, joining voice and stage channels, or creating threads' },
    ],
  },
  {
    label: 'Text Channel Permissions',
    flags: [
      { name: 'Send Messages', bit: BigInt(0x800), description: 'Send messages in text channels' },
      { name: 'Send Messages in Threads', bit: BigInt(1) << BigInt(38), description: 'Send messages in threads' },
      { name: 'Create Public Threads', bit: BigInt(1) << BigInt(35), description: 'Create public threads' },
      { name: 'Create Private Threads', bit: BigInt(1) << BigInt(36), description: 'Create private threads' },
      { name: 'Embed Links', bit: BigInt(0x4000), description: 'Embed links in messages' },
      { name: 'Attach Files', bit: BigInt(0x8000), description: 'Upload files and images' },
      { name: 'Add Reactions', bit: BigInt(0x40), description: 'Add emoji reactions to messages' },
      { name: 'Use External Emoji', bit: BigInt(0x40000), description: 'Use emoji from other servers' },
      { name: 'Use External Stickers', bit: BigInt(1) << BigInt(37), description: 'Use stickers from other servers' },
      { name: 'Mention @everyone, @here, and All Roles', bit: BigInt(0x20000), description: 'Use @everyone, @here, and mention all roles' },
      { name: 'Manage Messages', bit: BigInt(0x2000), description: 'Delete or pin messages from other members' },
      { name: 'Manage Threads', bit: BigInt(1) << BigInt(34), description: 'Rename, delete, archive/unarchive, and turn on slow mode for threads' },
      { name: 'Read Message History', bit: BigInt(0x10000), description: 'View the message history of text channels' },
      { name: 'Send TTS Messages', bit: BigInt(0x1000), description: 'Send text-to-speech messages' },
      { name: 'Use Application Commands', bit: BigInt(1) << BigInt(31), description: 'Use slash commands from bots' },
    ],
  },
  {
    label: 'Voice Channel Permissions',
    flags: [
      { name: 'Connect', bit: BigInt(0x100000), description: 'Join voice channels' },
      { name: 'Speak', bit: BigInt(0x200000), description: 'Speak in voice channels' },
      { name: 'Video', bit: BigInt(0x200), description: 'Share video in voice channels' },
      { name: 'Mute Members', bit: BigInt(0x400000), description: 'Server mute members in voice channels' },
      { name: 'Deafen Members', bit: BigInt(0x800000), description: 'Server deafen members in voice channels' },
      { name: 'Move Members', bit: BigInt(0x1000000), description: 'Move members between voice channels' },
      { name: 'Use Voice Activity', bit: BigInt(0x2000000), description: 'Use voice activity detection instead of push-to-talk' },
      { name: 'Priority Speaker', bit: BigInt(0x100), description: 'Be more easily heard when speaking' },
      { name: 'Use Soundboard', bit: BigInt(1) << BigInt(42), description: 'Use soundboard sounds in voice channels' },
    ],
  },
];

const ROLE_COLOR_PRESETS = [
  '#1ABC9C', '#2ECC71', '#3498DB', '#9B59B6', '#E91E63', '#F1C40F', '#E67E22',
  '#E74C3C', '#95A5A6', '#607D8B', '#11806A', '#1F8B4C', '#206694', '#71368A',
  '#AD1457', '#C27C0E', '#A84300', '#992D22', '#979C9F', '#546E7A', '#9EAFBA',
];

const REGION_OPTIONS = [
  { value: 'us-east', label: 'US East' },
  { value: 'us-west', label: 'US West' },
  { value: 'us-central', label: 'US Central' },
  { value: 'us-south', label: 'US South' },
  { value: 'eu-west', label: 'EU West' },
  { value: 'eu-central', label: 'EU Central' },
  { value: 'brazil', label: 'Brazil' },
  { value: 'singapore', label: 'Singapore' },
  { value: 'sydney', label: 'Sydney' },
  { value: 'japan', label: 'Japan' },
  { value: 'india', label: 'India' },
  { value: 'automatic', label: 'Automatic' },
];

interface AuditLogEntry {
  id: string;
  user_id: string;
  target_id: string | null;
  action_type: number;
  changes?: Array<{ key: string; old_value?: unknown; new_value?: unknown }>;
  reason?: string;
  created_at: string;
}

interface AuditLogUser {
  id: string;
  username: string;
  avatar: string | null;
}

interface InviteEntry {
  code: string;
  channel: { id: string; name: string };
  inviter?: { id: string; username: string; avatar: string | null };
  uses: number;
  max_uses: number;
  max_age: number;
  temporary: boolean;
  created_at: string;
}

interface BanEntry {
  user: { id: string; username: string; avatar: string | null };
  reason: string | null;
}

export interface ServerSettingsProps {
  guildId: string;
  onClose: () => void;
}

export const ServerSettings = ({ guildId, onClose }: ServerSettingsProps) => {
  const dispatch = useAppDispatch();
  const guild = useAppSelector(s => s.guilds.guilds[guildId]);
  // The GuildResponse API model returns verification_level/explicit_content_filter/discoverable,
  // but the trimmed Guild redux type doesn't declare them yet — cast locally to read them.
  const guildSafety = guild as (Guild & { verification_level?: number; explicit_content_filter?: number; discoverable?: boolean }) | undefined;
  const channels = useAppSelector(
    s => Object.values(s.channels.channels).filter(c => c.guild_id === guildId),
    shallowEqual,
  );
  const members = useAppSelector(s => s.members.membersByGuild[guildId] ?? EMPTY_ARRAY);
  const roles = useAppSelector(s => s.roles.rolesByGuild[guildId] ?? EMPTY_ARRAY);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const perms = usePermissions(guildId);
  const isOwner = perms.isOwner;

  const [activeSection, setActiveSection] = useState<Section>('overview');

  // Overview state
  const [serverName, setServerName] = useState(guild?.name ?? '');
  const [serverDescription, setServerDescription] = useState(guild?.description ?? '');
  const [serverRegion, setServerRegion] = useState(guild?.region ?? 'automatic');
  const [overviewSaving, setOverviewSaving] = useState(false);
  const [overviewSaved, setOverviewSaved] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBase64, setIconBase64] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [discoverable, setDiscoverable] = useState(guildSafety?.discoverable ?? false);
  const [discoverableSaving, setDiscoverableSaving] = useState(false);

  // Transfer ownership state
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Roles state
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleColor, setEditRoleColor] = useState('#9EAFBA');
  const [editRoleHoist, setEditRoleHoist] = useState(false);
  const [editRoleMentionable, setEditRoleMentionable] = useState(false);
  const [editRolePermissions, setEditRolePermissions] = useState('0');
  const [roleEditorTab, setRoleEditorTab] = useState<'display' | 'permissions' | 'members'>('display');

  // Error state for user feedback (Bug 6)
  const [actionError, setActionError] = useState<string | null>(null);

  // Track whether role edits are "dirty" (unsaved)
  const [roleHasUnsavedChanges, setRoleHasUnsavedChanges] = useState(false);

  // Role delete confirmation dialog
  const [showDeleteRoleConfirm, setShowDeleteRoleConfirm] = useState(false);

  // Custom color picker expanded state
  const [showCustomColor, setShowCustomColor] = useState(false);

  // Add members search in Manage Members tab
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [showAddMemberDropdown, setShowAddMemberDropdown] = useState(false);

  // Drag-and-drop role reordering state
  const [dragRoleId, setDragRoleId] = useState<string | null>(null);
  const [dragOverRoleId, setDragOverRoleId] = useState<string | null>(null);
  const dragCounter = useRef(0);

  // Navigation away warning
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const pendingNavAction = useRef<(() => void) | null>(null);

  // Channels state
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelTopic, setEditChannelTopic] = useState('');
  const [editChannelNsfw, setEditChannelNsfw] = useState(false);
  const [editChannelSlowmode, setEditChannelSlowmode] = useState(0);
  const [deleteConfirmChannelId, setDeleteConfirmChannelId] = useState<string | null>(null);

  // Members state
  const [memberMenuId, setMemberMenuId] = useState<string | null>(null);
  const [memberMenuPos, setMemberMenuPos] = useState({ x: 0, y: 0 });
  const [nickEditUserId, setNickEditUserId] = useState<string | null>(null);
  const [nickEditValue, setNickEditValue] = useState('');
  const [roleAssignUserId, setRoleAssignUserId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [showBanDialog, setShowBanDialog] = useState<string | null>(null);

  // Bans state
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banSearchQuery, setBanSearchQuery] = useState('');
  const [selectedBan, setSelectedBan] = useState<BanEntry | null>(null);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditUsers, setAuditUsers] = useState<AuditLogUser[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilterType, setAuditFilterType] = useState<number | null>(null);
  const [auditFilterUser, setAuditFilterUser] = useState<string | null>(null);

  // Emoji state
  interface EmojiEntry {
    id: string;
    name: string;
    animated: boolean;
    available: boolean;
    managed: boolean;
    require_colons: boolean;
    roles: string[];
    user?: { id: string; username: string; avatar: string | null };
  }
  const [guildEmojis, setGuildEmojis] = useState<EmojiEntry[]>([]);
  const [emojisLoading, setEmojisLoading] = useState(false);
  const [emojiUploadName, setEmojiUploadName] = useState('');
  const [emojiUploadPreview, setEmojiUploadPreview] = useState<string | null>(null);
  const [emojiUploadBase64, setEmojiUploadBase64] = useState<string | null>(null);
  const [emojiUploading, setEmojiUploading] = useState(false);
  const [emojiError, setEmojiError] = useState<string | null>(null);
  const emojiFileInputRef = useRef<HTMLInputElement>(null);
  const EMOJI_LIMIT = 50; // Default; higher tiers get more

  // Invites state
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);

  // AutoMod state
  const automodRules = useAppSelector(s => s.automod.rulesByGuild[guildId] ?? EMPTY_ARRAY);
  const automodLoading = useAppSelector(s => s.automod.isLoading);
  const [newKeyword, setNewKeyword] = useState('');

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Integrations/Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState<string | null>(null);
  const [isCreatingWebhook, setIsCreatingWebhook] = useState(false);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);
  const [showDeleteWebhookConfirm, setShowDeleteWebhookConfirm] = useState<string | null>(null);
  const [newWebhookName, setNewWebhookName] = useState('');
  const [newWebhookChannelId, setNewWebhookChannelId] = useState('');
  const [showCreateWebhookForm, setShowCreateWebhookForm] = useState(false);

  // Escape to close (with unsaved changes warning)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (roleHasUnsavedChanges) {
        pendingNavAction.current = onClose;
        setShowDiscardDialog(true);
      } else {
        onClose();
      }
    }
  }, [onClose, roleHasUnsavedChanges]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Load roles on mount
  useEffect(() => {
    api.getGuildRoles(guildId).then(r => {
      dispatch(setRoles({ guildId, roles: r }));
    }).catch(() => { /* silent */ });
  }, [guildId, dispatch]);

  // Load section-specific data
  useEffect(() => {
    if (activeSection === 'bans') {
      setBansLoading(true);
      api.getGuildBans(guildId).then(b => {
        setBans(b);
        setBansLoading(false);
      }).catch(() => setBansLoading(false));
    }
    if (activeSection === 'audit-log') {
      setAuditLoading(true);
      setAuditError(null);
      api.getAuditLog(guildId, { limit: 50 }).then(data => {
        setAuditEntries(data.audit_log_entries ?? []);
        setAuditUsers(data.users ?? []);
        setAuditLoading(false);
      }).catch(() => {
        setAuditError('Failed to load audit log entries.');
        setAuditLoading(false);
      });
    }
    if (activeSection === 'invites') {
      setInvitesLoading(true);
      api.getGuildInvites(guildId).then(inv => {
        setInvites(inv);
        setInvitesLoading(false);
      }).catch(() => setInvitesLoading(false));
    }
    if (activeSection === 'members') {
      api.getGuildMembers(guildId).catch(() => { /* already loaded */ });
    }
    if (activeSection === 'automod') {
      dispatch(fetchAutoModRules(guildId));
    }
    if (activeSection === 'emoji') {
      setEmojisLoading(true);
      setEmojiError(null);
      api.getGuildEmojis(guildId).then(emojis => {
        setGuildEmojis(emojis);
        setEmojisLoading(false);
      }).catch(() => {
        setEmojiError('Failed to load emoji.');
        setEmojisLoading(false);
      });
    }
    if (activeSection === 'integrations') {
      setWebhooksLoading(true);
      setWebhooksError(null);
      api.getGuildWebhooks(guildId).then(wh => {
        setWebhooks(wh);
        setWebhooksLoading(false);
      }).catch(() => {
        setWebhooksError('Failed to load webhooks');
        setWebhooksLoading(false);
      });
    }
  }, [activeSection, guildId, dispatch]);

  // -- Overview handlers --
  const handleIconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validate file type
    if (!file.type.startsWith('image/')) return;
    // Validate file size (max 8MB like Relay)
    if (file.size > 8 * 1024 * 1024) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setIconPreview(result);
      setIconBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveIcon = () => {
    setIconPreview(null);
    setIconBase64(null);
    if (iconInputRef.current) {
      iconInputRef.current.value = '';
    }
  };

  const handleSaveOverview = async () => {
    setOverviewSaving(true);
    try {
      const payload: { name?: string; description?: string; region?: string; icon?: string | null } = {
        name: serverName,
        description: serverDescription,
        region: serverRegion,
      };
      if (iconBase64 !== null) {
        payload.icon = iconBase64;
      }
      const result = await api.updateGuild(guildId, payload);
      dispatch(updateGuild({
        id: guildId,
        changes: {
          name: serverName,
          description: serverDescription,
          region: serverRegion,
          icon: result.icon ?? guild?.icon ?? null,
        },
      }));
      setIconBase64(null);
      setIconPreview(null);
      setOverviewSaved(true);
      setTimeout(() => setOverviewSaved(false), 2000);
    } catch { /* silent */ }
    setOverviewSaving(false);
  };

  // Independent of the Save Changes button -- persists immediately on toggle,
  // mirroring how Safety Setup's verification_level/explicit_content_filter save.
  const handleToggleDiscoverable = async () => {
    if (discoverableSaving) return;
    const previous = discoverable;
    const next = !discoverable;
    setDiscoverable(next);
    setDiscoverableSaving(true);
    try {
      await api.updateGuild(guildId, { discoverable: next });
      dispatch(updateGuild({
        id: guildId,
        changes: { discoverable: next } as Partial<Guild>,
      }));
    } catch {
      setDiscoverable(previous);
    }
    setDiscoverableSaving(false);
  };

  const handleTransferOwnership = async () => {
    if (!transferTargetId) return;
    setTransferring(true);
    try {
      const result = await api.transferOwnership(guildId, transferTargetId);
      dispatch(updateGuild({
        id: guildId,
        changes: { owner_id: result.owner_id },
      }));
      setShowTransferDialog(false);
      setTransferTargetId(null);
    } catch {
      setActionError('Failed to transfer ownership');
    }
    setTransferring(false);
  };

  // -- Unsaved changes detection for roles --
  const originalRoleValues = useRef<{
    name: string; color: string; hoist: boolean; mentionable: boolean; permissions: string;
  } | null>(null);

  // Recompute dirty state whenever edit fields change
  useEffect(() => {
    if (!originalRoleValues.current || !selectedRoleId) {
      setRoleHasUnsavedChanges(false);
      return;
    }
    const o = originalRoleValues.current;
    const dirty =
      editRoleName !== o.name ||
      editRoleColor.toUpperCase() !== o.color.toUpperCase() ||
      editRoleHoist !== o.hoist ||
      editRoleMentionable !== o.mentionable ||
      editRolePermissions !== o.permissions;
    setRoleHasUnsavedChanges(dirty);
  }, [editRoleName, editRoleColor, editRoleHoist, editRoleMentionable, editRolePermissions, selectedRoleId]);

  // -- Role handlers --
  const selectRole = (role: Role) => {
    const colorHex = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#9EAFBA';
    setSelectedRoleId(role.id);
    setEditRoleName(role.name);
    setEditRoleColor(colorHex);
    setEditRoleHoist(role.hoist);
    setEditRoleMentionable(role.mentionable);
    setEditRolePermissions(role.permissions);
    setRoleEditorTab('display');
    setActionError(null);
    setShowCustomColor(false);
    setAddMemberSearch('');
    setShowAddMemberDropdown(false);
    setShowDeleteRoleConfirm(false);
    originalRoleValues.current = {
      name: role.name,
      color: colorHex,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions,
    };
    setRoleHasUnsavedChanges(false);
  };

  /** Attempt to select a role, but warn if there are unsaved changes */
  const trySelectRole = (role: Role) => {
    if (roleHasUnsavedChanges) {
      pendingNavAction.current = () => selectRole(role);
      setShowDiscardDialog(true);
    } else {
      selectRole(role);
    }
  };

  /** Navigate to a section with unsaved-changes guard */
  const navigateSection = (section: Section) => {
    if (roleHasUnsavedChanges && activeSection === 'roles') {
      pendingNavAction.current = () => {
        setActiveSection(section);
        setSelectedRoleId(null);
        originalRoleValues.current = null;
      };
      setShowDiscardDialog(true);
    } else {
      setActiveSection(section);
    }
  };

  const handleCreateRole = async () => {
    try {
      // Find @everyone role to inherit its permissions
      const everyoneRole = roles.find(r => r.position === 0);
      const defaultPerms = everyoneRole?.permissions ?? '0';
      const role = await api.createRole(guildId, { name: 'new role' });
      // If the API returned permissions as "0", copy from @everyone
      if (role.permissions === '0' && defaultPerms !== '0') {
        const updated = await api.updateRole(guildId, role.id, {
          name: role.name,
          permissions: defaultPerms,
        });
        const mergedRole = { ...role, ...updated };
        dispatch(addRole({ guildId, role: mergedRole }));
        selectRole(mergedRole);
      } else {
        dispatch(addRole({ guildId, role }));
        selectRole(role);
      }
      setActionError(null);
    } catch {
      setActionError('Failed to create role. Please try again.');
    }
  };

  const handleSaveRole = async () => {
    if (!selectedRoleId) return;
    const colorInt = parseInt(editRoleColor.replace('#', ''), 16);
    try {
      const updated = await api.updateRole(guildId, selectedRoleId, {
        name: editRoleName,
        color: colorInt,
        hoist: editRoleHoist,
        mentionable: editRoleMentionable,
        permissions: editRolePermissions,
      });
      dispatch(updateRoleAction({ guildId, roleId: selectedRoleId, changes: updated }));
      // Reset original values to current so dirty state clears
      originalRoleValues.current = {
        name: editRoleName,
        color: editRoleColor,
        hoist: editRoleHoist,
        mentionable: editRoleMentionable,
        permissions: editRolePermissions,
      };
      setRoleHasUnsavedChanges(false);
      setActionError(null);
    } catch {
      setActionError('Failed to save role changes. Please try again.');
    }
  };

  /** Reset role editor fields to original values */
  const handleResetRole = () => {
    if (!originalRoleValues.current) return;
    const o = originalRoleValues.current;
    setEditRoleName(o.name);
    setEditRoleColor(o.color);
    setEditRoleHoist(o.hoist);
    setEditRoleMentionable(o.mentionable);
    setEditRolePermissions(o.permissions);
  };

  const handleDeleteRole = async () => {
    if (!selectedRoleId) return;
    try {
      await api.deleteRole(guildId, selectedRoleId);
      dispatch(removeRole({ guildId, roleId: selectedRoleId }));
      setSelectedRoleId(null);
      setActionError(null);
      setShowDeleteRoleConfirm(false);
      originalRoleValues.current = null;
      setRoleHasUnsavedChanges(false);
    } catch {
      setActionError('Failed to delete role. Please try again.');
    }
  };

  const handleDropRole = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const sorted = [...roles].sort((a, b) => b.position - a.position);
    const dragIdx = sorted.findIndex(r => r.id === draggedId);
    const dropIdx = sorted.findIndex(r => r.id === targetId);
    if (dragIdx < 0 || dropIdx < 0) return;
    const roleA = sorted[dragIdx];
    const roleB = sorted[dropIdx];
    if (!roleA || !roleB) return;
    // Don't let anyone drag @everyone
    if (isEveryoneRole(roleA) || isEveryoneRole(roleB)) return;
    const newPositionA = roleB.position;
    const newPositionB = roleA.position;
    try {
      await Promise.all([
        api.updateRole(guildId, roleA.id, { name: roleA.name, position: newPositionA }),
        api.updateRole(guildId, roleB.id, { name: roleB.name, position: newPositionB }),
      ]);
      dispatch(updateRoleAction({ guildId, roleId: roleA.id, changes: { position: newPositionA } }));
      dispatch(updateRoleAction({ guildId, roleId: roleB.id, changes: { position: newPositionB } }));
    } catch { /* silent */ }
  };

  const togglePermission = (bit: bigint) => {
    const current = BigInt(editRolePermissions || '0');
    const hasIt = (current & bit) === bit;
    const next = hasIt ? current & ~bit : current | bit;
    setEditRolePermissions(next.toString());
  };

  // -- Channel handlers --
  const startEditChannel = (ch: { id: string; name: string | null; topic: string | null; type: number; nsfw?: boolean; rate_limit_per_user?: number }) => {
    setEditingChannelId(ch.id);
    setEditChannelName(ch.name ?? '');
    setEditChannelTopic(ch.topic ?? '');
    setEditChannelNsfw(ch.nsfw ?? false);
    setEditChannelSlowmode(ch.rate_limit_per_user ?? 0);
  };

  const handleSaveChannel = async () => {
    if (!editingChannelId) return;
    try {
      const updated = await api.updateChannel(editingChannelId, {
        name: editChannelName,
        topic: editChannelTopic,
        nsfw: editChannelNsfw,
        rate_limit_per_user: editChannelSlowmode,
      });
      dispatch(updateChannelAction({
        id: editingChannelId,
        changes: {
          name: updated.name,
          topic: updated.topic,
          nsfw: updated.nsfw,
          rate_limit_per_user: updated.rate_limit_per_user,
        },
      }));
      setEditingChannelId(null);
    } catch { /* silent */ }
  };

  const handleDeleteChannel = async (channelId: string) => {
    try {
      await api.deleteChannel(channelId);
      dispatch(removeChannel(channelId));
      setDeleteConfirmChannelId(null);
      setEditingChannelId(null);
    } catch { /* silent */ }
  };

  // -- Member handlers --
  const handleMemberContextMenu = (e: React.MouseEvent, userId: string) => {
    e.preventDefault();
    setMemberMenuId(userId);
    setMemberMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleKick = async (userId: string) => {
    try {
      await api.kickMember(guildId, userId);
      dispatch(removeMember({ guildId, userId }));
    } catch { /* silent */ }
    setMemberMenuId(null);
  };

  const handleBan = async (userId: string) => {
    try {
      await api.createBan(guildId, userId, { reason: banReason || undefined });
      dispatch(removeMember({ guildId, userId }));
      setBanReason('');
      setShowBanDialog(null);
    } catch { /* silent */ }
  };

  const handleChangeNick = async (userId: string) => {
    try {
      await api.updateMemberNick(guildId, userId, nickEditValue || null);
      dispatch(updateMember({ guildId, userId, changes: { nick: nickEditValue || null } }));
      setNickEditUserId(null);
      setNickEditValue('');
    } catch { /* silent */ }
  };

  const handleToggleRole = async (userId: string, roleId: string, hasRole: boolean) => {
    try {
      if (hasRole) {
        await api.removeMemberRole(guildId, userId, roleId);
      } else {
        await api.addMemberRole(guildId, userId, roleId);
      }
      const member = members.find(m => m.user.id === userId);
      if (member) {
        const newRoles = hasRole
          ? member.roles.filter(r => r !== roleId)
          : [...member.roles, roleId];
        dispatch(updateMember({ guildId, userId, changes: { roles: newRoles } }));
      }
    } catch { /* silent */ }
    setRoleAssignUserId(null);
  };

  // -- Ban handlers --
  const handleRevokeBanFromModal = async (userId: string) => {
    try {
      await api.removeBan(guildId, userId);
      setBans(prev => prev.filter(b => b.user.id !== userId));
      setSelectedBan(null);
    } catch { /* silent */ }
  };

  // -- Invite handlers --
  const handleRevokeInvite = async (code: string) => {
    try {
      await api.revokeInvite(code);
      setInvites(prev => prev.filter(i => i.code !== code));
    } catch { /* silent */ }
  };

  // -- Delete guild handler --
  const handleDeleteGuild = async () => {
    if (deleteConfirm !== guild?.name) return;
    try {
      await api.deleteGuild(guildId);
      dispatch(removeGuild(guildId));
      onClose();
    } catch { /* silent */ }
  };

  if (!guild) return null;

  const getAuditUsername = (userId: string): string => {
    const u = auditUsers.find(u => u.id === userId);
    return u?.username ?? userId;
  };

  const sortedRoles = [...roles].sort((a, b) => b.position - a.position);
  const selectedRole = roles.find(r => r.id === selectedRoleId);
  const isEveryone = isEveryoneRole(selectedRole);

  // Members who do NOT have the selected role (for Add Members dropdown, Fix 1)
  const membersWithoutRole = useMemo(() => {
    if (!selectedRoleId) return [];
    const query = addMemberSearch.toLowerCase();
    return members
      .filter(m => !m.roles.includes(selectedRoleId))
      .filter(m =>
        !query ||
        m.user.username.toLowerCase().includes(query) ||
        (m.nick && m.nick.toLowerCase().includes(query))
      );
  }, [members, selectedRoleId, addMemberSearch]);

  /** Handler to add a member to the currently selected role */
  const handleAddMemberToRole = async (userId: string) => {
    if (!selectedRoleId) return;
    try {
      await api.addMemberRole(guildId, userId, selectedRoleId);
      const member = members.find(m => m.user.id === userId);
      if (member) {
        dispatch(updateMember({
          guildId,
          userId,
          changes: { roles: [...member.roles, selectedRoleId] },
        }));
      }
      setAddMemberSearch('');
      setShowAddMemberDropdown(false);
    } catch {
      setActionError('Failed to add member to role.');
    }
  };

  /** Handler to remove a member from the currently selected role */
  const handleRemoveMemberFromRole = async (userId: string) => {
    if (!selectedRoleId) return;
    try {
      await api.removeMemberRole(guildId, userId, selectedRoleId);
      const member = members.find(m => m.user.id === userId);
      if (member) {
        dispatch(updateMember({
          guildId,
          userId,
          changes: { roles: member.roles.filter(r => r !== selectedRoleId) },
        }));
      }
    } catch {
      setActionError('Failed to remove member from role.');
    }
  };

  const formatTimestamp = (ts: string): string => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const formatMaxAge = (seconds: number): string => {
    if (seconds === 0) return 'Never';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    return `${Math.floor(seconds / 86400)} days`;
  };

  // -- Webhook handlers --
  const textChannels = useMemo(
    () => channels.filter(c => c.type === 0),
    [channels],
  );

  const handleCreateWebhook = async () => {
    const targetChannelId = newWebhookChannelId || textChannels[0]?.id;
    if (!targetChannelId) return;
    const webhookName = newWebhookName.trim() || 'New Webhook';
    setIsCreatingWebhook(true);
    setWebhooksError(null);
    try {
      const newWebhook = await api.createWebhook(targetChannelId, { name: webhookName });
      setWebhooks(prev => [...prev, newWebhook]);
      setShowCreateWebhookForm(false);
      setNewWebhookName('');
      setNewWebhookChannelId('');
    } catch {
      setWebhooksError('Failed to create webhook');
    } finally {
      setIsCreatingWebhook(false);
    }
  };

  const handleCopyWebhookUrl = (wh: WebhookEntry) => {
    const webhookUrl = `${window.location.origin}/api/v10/webhooks/${wh.id}/${wh.token ?? ''}`;
    void navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhookId(wh.id);
    setTimeout(() => setCopiedWebhookId(null), 2000);
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    try {
      await api.deleteWebhook(webhookId);
      setWebhooks(prev => prev.filter(w => w.id !== webhookId));
      setShowDeleteWebhookConfirm(null);
    } catch {
      setWebhooksError('Failed to delete webhook');
    }
  };

  const getChannelName = (channelId: string): string => {
    const ch = channels.find(c => c.id === channelId);
    return ch?.name ?? 'Unknown';
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        {/* Nav sidebar */}
        <nav className={styles.nav}>
          <div className={styles.navScroll}>
            <div className={styles.navHeader}>{guild.name.toUpperCase()}</div>

            <button
              className={`${styles.navItem} ${activeSection === 'overview' ? styles.active : ''}`}
              onClick={() => navigateSection('overview')}
            >
              Overview
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'roles' ? styles.active : ''}`}
              onClick={() => navigateSection('roles')}
            >
              Roles
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'emoji' ? styles.active : ''}`}
              onClick={() => navigateSection('emoji')}
            >
              Emoji
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'stickers' ? styles.active : ''}`}
              onClick={() => navigateSection('stickers')}
            >
              Stickers
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'soundboard' ? styles.active : ''}`}
              onClick={() => navigateSection('soundboard')}
            >
              Soundboard
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'widget' ? styles.active : ''}`}
              onClick={() => navigateSection('widget')}
            >
              Widget
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'server-template' ? styles.active : ''}`}
              onClick={() => navigateSection('server-template')}
            >
              Server Template
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'vanity-url' ? styles.active : ''}`}
              onClick={() => navigateSection('vanity-url')}
            >
              Vanity URL
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'channels' ? styles.active : ''}`}
              onClick={() => navigateSection('channels')}
            >
              Channels
            </button>

            <div className={styles.separator} />
            <div className={styles.navHeader}>MODERATION</div>

            <button
              className={`${styles.navItem} ${activeSection === 'members' ? styles.active : ''}`}
              onClick={() => navigateSection('members')}
            >
              Members
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'bans' ? styles.active : ''}`}
              onClick={() => navigateSection('bans')}
            >
              Bans
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'automod' ? styles.active : ''}`}
              onClick={() => navigateSection('automod')}
            >
              AutoMod
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'safety-setup' ? styles.active : ''}`}
              onClick={() => navigateSection('safety-setup')}
            >
              Safety Setup
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'audit-log' ? styles.active : ''}`}
              onClick={() => navigateSection('audit-log')}
            >
              Audit Log
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'invites' ? styles.active : ''}`}
              onClick={() => navigateSection('invites')}
            >
              Invites
            </button>

            <div className={styles.separator} />
            <div className={styles.navHeader}>APPS</div>

            <button
              className={`${styles.navItem} ${activeSection === 'integrations' ? styles.active : ''}`}
              onClick={() => navigateSection('integrations')}
            >
              Integrations
            </button>

            <div className={styles.separator} />
            <div className={styles.navHeader}>COMMUNITY</div>

            <button
              className={`${styles.navItem} ${activeSection === 'onboarding' ? styles.active : ''}`}
              onClick={() => navigateSection('onboarding')}
            >
              Onboarding
            </button>
            <button
              className={`${styles.navItem} ${activeSection === 'welcome-screen' ? styles.active : ''}`}
              onClick={() => navigateSection('welcome-screen')}
            >
              Welcome Screen
            </button>

            {isOwner && (
              <>
                <div className={styles.separator} />
                <button
                  className={`${styles.navItem} ${styles.danger} ${activeSection === 'delete' ? styles.active : ''}`}
                  onClick={() => navigateSection('delete')}
                >
                  Delete Server
                </button>
              </>
            )}
          </div>
        </nav>

        {/* Content area */}
        <div className={styles.contentWrapper}>
          <div className={styles.content}>

          {/* ====== OVERVIEW ====== */}
          {activeSection === 'overview' && (
            <div className={styles.section}>
              <h2>Server Overview</h2>

              <div className={styles.overviewGrid}>
                <div className={styles.iconUploadArea}>
                  <input
                    ref={iconInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className={styles.hiddenInput}
                    onChange={handleIconFileChange}
                    aria-label="Upload server icon"
                    data-testid="icon-file-input"
                  />
                  <button
                    className={styles.guildIconLarge}
                    onClick={() => iconInputRef.current?.click()}
                    type="button"
                    aria-label="Change server icon"
                    data-testid="icon-upload-button"
                  >
                    {iconPreview ? (
                      <img
                        src={iconPreview}
                        alt="Server icon preview"
                        className={styles.iconPreviewImg}
                      />
                    ) : guild.icon ? (
                      <img
                        src={guild.icon.startsWith('data:') ? guild.icon : `${cdnBase()}/icons/${guildId}/${guild.icon}.png`}
                        alt={guild.name}
                        className={styles.iconPreviewImg}
                      />
                    ) : (
                      guild.name.charAt(0).toUpperCase()
                    )}
                    <div className={styles.iconUploadOverlay}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
                      </svg>
                      <span>Upload</span>
                    </div>
                  </button>
                  {(iconPreview || guild.icon) && (
                    <button
                      className={styles.removeIconBtn}
                      onClick={handleRemoveIcon}
                      type="button"
                      aria-label="Remove server icon"
                    >
                      Remove
                    </button>
                  )}
                  <span className={styles.iconHint}>Minimum size: 128x128. Supports PNG, JPG, GIF, WebP.</span>
                </div>

                <div className={styles.overviewFields}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>SERVER NAME</label>
                    <input
                      className={styles.formInput}
                      type="text"
                      value={serverName}
                      onChange={e => setServerName(e.target.value)}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>DESCRIPTION</label>
                    <textarea
                      className={styles.formTextarea}
                      value={serverDescription}
                      onChange={e => setServerDescription(e.target.value)}
                      placeholder="Tell people what this server is about"
                      rows={4}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>SERVER REGION</label>
                    <select
                      className={styles.formSelect}
                      value={serverRegion}
                      onChange={e => setServerRegion(e.target.value)}
                    >
                      {REGION_OPTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  {perms.canManageGuild && (
                    <div className={styles.formGroup}>
                      <div className={styles.toggleRow}>
                        <div>
                          <label className={styles.formLabel}>SERVER DISCOVERY</label>
                          <p className={styles.formHint}>
                            List this server in Discover so anyone can find and join it.
                          </p>
                        </div>
                        <button
                          type="button"
                          className={`${styles.toggle} ${discoverable ? styles.toggleOn : ''}`}
                          onClick={() => void handleToggleDiscoverable()}
                          disabled={discoverableSaving}
                          aria-label="Toggle server discoverability"
                          role="switch"
                          aria-checked={discoverable}
                        >
                          <div className={styles.toggleKnob} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.saveBar}>
                <button
                  className={styles.saveBtn}
                  onClick={handleSaveOverview}
                  disabled={overviewSaving}
                >
                  {overviewSaving ? 'Saving...' : overviewSaved ? 'Saved!' : 'Save Changes'}
                </button>
              </div>

              {isOwner && (
                <div className={styles.dangerZone}>
                  <h3>Transfer Ownership</h3>
                  <p className={styles.dangerDescription}>
                    Transfer this server to another member. You will lose owner privileges.
                  </p>
                  <button
                    className={styles.dangerBtn}
                    onClick={() => setShowTransferDialog(true)}
                    type="button"
                    data-testid="transfer-ownership-btn"
                  >
                    Transfer Ownership
                  </button>
                </div>
              )}

              {showTransferDialog && (
                <div
                  className={styles.confirmOverlay}
                  role="dialog"
                  aria-label="Transfer ownership"
                  aria-modal="true"
                >
                  <div className={styles.confirmDialog}>
                    <h3>Transfer Ownership</h3>
                    <p>Select a member to transfer ownership to:</p>
                    <select
                      className={styles.formSelect}
                      value={transferTargetId ?? ''}
                      onChange={e => setTransferTargetId(e.target.value || null)}
                      data-testid="transfer-member-select"
                    >
                      <option value="">Select a member...</option>
                      {members
                        .filter(m => m.user.id !== currentUserId)
                        .map(m => (
                          <option key={m.user.id} value={m.user.id}>
                            {m.nick ?? m.user.displayName ?? m.user.username}
                          </option>
                        ))}
                    </select>
                    <div className={styles.confirmActions}>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => {
                          setShowTransferDialog(false);
                          setTransferTargetId(null);
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className={styles.dangerBtn}
                        onClick={handleTransferOwnership}
                        disabled={!transferTargetId || transferring}
                        type="button"
                        data-testid="confirm-transfer-btn"
                      >
                        {transferring ? 'Transferring...' : 'Transfer'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== ROLES ====== */}
          {activeSection === 'roles' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>Roles</h2>
                <button className={styles.createBtn} onClick={handleCreateRole}>
                  Create Role
                </button>
              </div>

              <div className={styles.rolesLayout}>
                <div className={styles.rolesList}>
                  {sortedRoles.map((role) => {
                    const everyone = isEveryoneRole(role);
                    return (
                      <div
                        key={role.id}
                        className={`${styles.roleItem} ${selectedRoleId === role.id ? styles.roleSelected : ''} ${dragOverRoleId === role.id ? styles.roleDragOver : ''}`}
                        onClick={() => trySelectRole(role)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter') trySelectRole(role); }}
                        draggable={!everyone}
                        onDragStart={e => {
                          if (everyone) { e.preventDefault(); return; }
                          setDragRoleId(role.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => { setDragRoleId(null); setDragOverRoleId(null); dragCounter.current = 0; }}
                        onDragEnter={() => {
                          dragCounter.current += 1;
                          if (!everyone) setDragOverRoleId(role.id);
                        }}
                        onDragLeave={() => {
                          dragCounter.current -= 1;
                          if (dragCounter.current === 0) setDragOverRoleId(null);
                        }}
                        onDragOver={e => { if (!everyone) e.preventDefault(); }}
                        onDrop={e => {
                          e.preventDefault();
                          dragCounter.current = 0;
                          setDragOverRoleId(null);
                          if (dragRoleId && !everyone) {
                            handleDropRole(dragRoleId, role.id);
                          }
                          setDragRoleId(null);
                        }}
                      >
                        {/* Drag handle (grip dots) -- not for @everyone */}
                        {!everyone && (
                          <span className={styles.dragHandle} aria-label="Drag to reorder">
                            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                              <circle cx="2.5" cy="2.5" r="1.5" />
                              <circle cx="7.5" cy="2.5" r="1.5" />
                              <circle cx="2.5" cy="7.5" r="1.5" />
                              <circle cx="7.5" cy="7.5" r="1.5" />
                              <circle cx="2.5" cy="12.5" r="1.5" />
                              <circle cx="7.5" cy="12.5" r="1.5" />
                            </svg>
                          </span>
                        )}
                        <span
                          className={styles.roleColor}
                          style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#9EAFBA' }}
                        />
                        <span className={styles.roleName}>{role.name}</span>
                      </div>
                    );
                  })}
                </div>

                {selectedRole && (
                  <div className={styles.roleEditor}>
                    <h3>Edit Role - {selectedRole.name}</h3>

                    {actionError && (
                      <div className={styles.errorBanner} role="alert">
                        <span>{actionError}</span>
                        <button
                          className={styles.errorDismiss}
                          onClick={() => setActionError(null)}
                          type="button"
                          aria-label="Dismiss error"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Role editor sub-tabs (Bug 7) */}
                    <div className={styles.roleEditorTabs} role="tablist" aria-label="Role settings tabs">
                      <button
                        type="button"
                        className={`${styles.roleEditorTab} ${roleEditorTab === 'display' ? styles.roleEditorTabActive : ''}`}
                        onClick={() => setRoleEditorTab('display')}
                        role="tab"
                        aria-selected={roleEditorTab === 'display'}
                      >
                        Display
                      </button>
                      <button
                        type="button"
                        className={`${styles.roleEditorTab} ${roleEditorTab === 'permissions' ? styles.roleEditorTabActive : ''}`}
                        onClick={() => setRoleEditorTab('permissions')}
                        role="tab"
                        aria-selected={roleEditorTab === 'permissions'}
                      >
                        Permissions
                      </button>
                      <button
                        type="button"
                        className={`${styles.roleEditorTab} ${roleEditorTab === 'members' ? styles.roleEditorTabActive : ''}`}
                        onClick={() => setRoleEditorTab('members')}
                        role="tab"
                        aria-selected={roleEditorTab === 'members'}
                      >
                        Manage Members
                      </button>
                    </div>

                    {/* Display tab */}
                    {roleEditorTab === 'display' && (
                      <div role="tabpanel" aria-label="Display settings">
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>ROLE NAME</label>
                          <input
                            className={styles.formInput}
                            type="text"
                            value={editRoleName}
                            onChange={e => setEditRoleName(e.target.value)}
                            disabled={isEveryone}
                            readOnly={isEveryone}
                          />
                          {isEveryone && (
                            <p className={styles.formHint}>The @everyone role name cannot be changed.</p>
                          )}
                        </div>

                        {/* Color picker -- hidden for @everyone (Fix 4) */}
                        {!isEveryone && (
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>ROLE COLOR</label>
                          <div className={styles.colorSwatches}>
                            <button
                              type="button"
                              className={styles.colorSwatchDefault}
                              onClick={() => setEditRoleColor('#9EAFBA')}
                              title="Default"
                              aria-label="Default color"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                              </svg>
                            </button>
                            {ROLE_COLOR_PRESETS.map(color => (
                              <button
                                key={color}
                                type="button"
                                className={`${styles.colorSwatch} ${editRoleColor.toUpperCase() === color ? styles.colorSwatchActive : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={() => setEditRoleColor(color)}
                                title={color}
                                aria-label={`Color ${color}`}
                              />
                            ))}
                            {/* Custom Color button (Fix 5) */}
                            <button
                              type="button"
                              className={`${styles.colorSwatch} ${styles.customColorBtn}`}
                              onClick={() => setShowCustomColor(prev => !prev)}
                              title="Custom Color"
                              aria-label="Custom color"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.377 4.622a4.5 4.5 0 0 0-6.364 0L4.622 11.01a4.5 4.5 0 0 0 6.364 6.364L12 16.354l-1.06-1.06-1.015 1.018a3 3 0 0 1-4.243-4.244l6.392-6.388a3 3 0 1 1 4.243 4.243l-5.657 5.657a1.5 1.5 0 0 1-2.121-2.121l4.95-4.95-1.06-1.06-4.95 4.95a3 3 0 0 0 4.243 4.243l5.657-5.657a4.5 4.5 0 0 0 0-6.364z"/>
                              </svg>
                            </button>
                          </div>
                          {showCustomColor && (
                            <div className={styles.colorRow}>
                              <input
                                type="color"
                                className={styles.colorPicker}
                                value={editRoleColor}
                                onChange={e => setEditRoleColor(e.target.value)}
                                aria-label="Custom color picker"
                              />
                              <input
                                className={styles.colorHexInput}
                                type="text"
                                value={editRoleColor}
                                onChange={e => setEditRoleColor(e.target.value)}
                                maxLength={7}
                                placeholder="#000000"
                                aria-label="Color hex value"
                              />
                            </div>
                          )}
                        </div>
                        )}
                        {/* end color section (closed !isEveryone) */}

                        {/* Display separately -- hidden for @everyone (Fix 4) */}
                        {!isEveryone && (
                        <div className={styles.formGroup}>
                          <div className={styles.toggleRow}>
                            <div>
                              <label className={styles.formLabel}>DISPLAY SEPARATELY</label>
                              <p className={styles.formHint}>Show members with this role separately in the member list</p>
                            </div>
                            <button
                              className={`${styles.toggle} ${editRoleHoist ? styles.toggleOn : ''}`}
                              onClick={() => setEditRoleHoist(!editRoleHoist)}
                              aria-label="Toggle display separately"
                            >
                              <div className={styles.toggleKnob} />
                            </button>
                          </div>
                        </div>
                        )}

                        <div className={styles.formGroup}>
                          <div className={styles.toggleRow}>
                            <div>
                              <label className={styles.formLabel}>MENTIONABLE</label>
                              <p className={styles.formHint}>Allow anyone to @mention this role</p>
                            </div>
                            <button
                              className={`${styles.toggle} ${editRoleMentionable ? styles.toggleOn : ''}`}
                              onClick={() => setEditRoleMentionable(!editRoleMentionable)}
                              aria-label="Toggle mentionable"
                            >
                              <div className={styles.toggleKnob} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Permissions tab */}
                    {roleEditorTab === 'permissions' && (
                      <div role="tabpanel" aria-label="Permissions settings">
                        {(() => {
                          const currentPerms = BigInt(editRolePermissions || '0');
                          const adminBit = BigInt(0x8);
                          const isAdminEnabled = (currentPerms & adminBit) === adminBit;
                          return isAdminEnabled ? (
                            <div className={styles.adminWarning} role="alert" data-testid="admin-warning">
                              <svg className={styles.adminWarningIcon} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 2L1 21h22L12 2zm0 3.83L19.53 19H4.47L12 5.83zM11 16h2v2h-2v-2zm0-6h2v4h-2v-4z" />
                              </svg>
                              <span>
                                This permission grants all other permissions and overrides all channel permission overwrites. Only grant this to trusted members.
                              </span>
                            </div>
                          ) : null;
                        })()}
                        {PERMISSION_CATEGORIES.map(category => (
                          <div key={category.label}>
                            <h5 className={styles.permCategoryLabel}>{category.label}</h5>
                            <div className={styles.permissionsList}>
                              {category.flags.map(perm => {
                                const current = BigInt(editRolePermissions || '0');
                                const hasPermission = (current & perm.bit) === perm.bit;
                                const isAdminDanger = perm.name === 'Administrator' && hasPermission;
                                return (
                                  <div key={perm.name} className={`${styles.permissionItem} ${isAdminDanger ? styles.permissionDanger : ''}`}>
                                    <div className={styles.permissionInfo}>
                                      <span className={styles.permissionName}>{perm.name}</span>
                                      <span className={styles.permissionDesc}>{perm.description}</span>
                                    </div>
                                    <button
                                      className={`${styles.toggle} ${hasPermission ? styles.toggleOn : ''}`}
                                      onClick={() => togglePermission(perm.bit)}
                                      aria-label={`Toggle ${perm.name}`}
                                      role="switch"
                                      aria-checked={hasPermission}
                                    >
                                      <div className={styles.toggleKnob} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Manage Members tab */}
                    {roleEditorTab === 'members' && (
                      <div role="tabpanel" aria-label="Manage members">
                        {/* Add Members button + dropdown (Fix 1) */}
                        <div className={styles.addMemberSection}>
                          <button
                            type="button"
                            className={styles.createBtn}
                            onClick={() => setShowAddMemberDropdown(prev => !prev)}
                            aria-label="Add Members"
                          >
                            Add Members
                          </button>
                          {showAddMemberDropdown && (
                            <div className={styles.addMemberDropdown}>
                              <input
                                className={styles.formInput}
                                type="text"
                                value={addMemberSearch}
                                onChange={e => setAddMemberSearch(e.target.value)}
                                placeholder="Search members..."
                                autoFocus
                                aria-label="Search members to add"
                              />
                              <div className={styles.addMemberResults}>
                                {membersWithoutRole.length === 0 ? (
                                  <div className={styles.emptyState}>No matching members</div>
                                ) : (
                                  membersWithoutRole.slice(0, 20).map(m => (
                                    <button
                                      key={m.user.id}
                                      type="button"
                                      className={styles.addMemberResultItem}
                                      onClick={() => handleAddMemberToRole(m.user.id)}
                                    >
                                      <div className={styles.memberAvatar}>
                                        {m.user.username.charAt(0).toUpperCase()}
                                      </div>
                                      <span>{m.nick ?? m.user.username}</span>
                                      <span className={styles.roleMemberUsername}>{m.user.username}</span>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <p className={styles.formHint}>
                          Members with the <strong>{selectedRole.name}</strong> role:
                        </p>
                        <div className={styles.roleMembersList}>
                          {members
                            .filter(m => m.roles.includes(selectedRole.id))
                            .map(m => (
                              <div key={m.user.id} className={styles.roleMemberItem}>
                                <div className={styles.memberAvatar}>
                                  {m.user.username.charAt(0).toUpperCase()}
                                </div>
                                <span className={styles.roleMemberName}>
                                  {m.nick ?? m.user.username}
                                </span>
                                <span className={styles.roleMemberUsername}>
                                  {m.user.username}
                                </span>
                                {/* Remove member from role button */}
                                <button
                                  type="button"
                                  className={`${styles.iconBtn} ${styles.dangerIcon}`}
                                  onClick={() => handleRemoveMemberFromRole(m.user.id)}
                                  title="Remove from role"
                                  aria-label={`Remove ${m.user.username} from role`}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          {members.filter(m => m.roles.includes(selectedRole.id)).length === 0 && (
                            <div className={styles.emptyState}>No members have this role</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Unsaved changes bar (Fix 2) */}
                    {roleHasUnsavedChanges && (
                      <div className={styles.unsavedBar} role="alert" data-testid="unsaved-changes-bar">
                        <span className={styles.unsavedText}>Careful — you have unsaved changes!</span>
                        <div className={styles.unsavedActions}>
                          <button type="button" className={styles.cancelBtn} onClick={handleResetRole}>
                            Reset
                          </button>
                          <button type="button" className={styles.saveBtn} onClick={handleSaveRole}>
                            Save Changes
                          </button>
                        </div>
                      </div>
                    )}

                    <div className={styles.roleActions}>
                      {!roleHasUnsavedChanges && (
                        <button className={styles.saveBtn} onClick={handleSaveRole}>
                          Save Changes
                        </button>
                      )}
                      {/* Delete button: not for @everyone and not for managed roles (Fix 4) */}
                      {!selectedRole.managed && !isEveryone && (
                        <button
                          className={styles.dangerBtn}
                          onClick={() => setShowDeleteRoleConfirm(true)}
                          data-testid="delete-role-btn"
                        >
                          Delete Role
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====== EMOJI ====== */}
          {activeSection === 'emoji' && (
            <div className={styles.section}>
              <h2>Emoji</h2>
              <p className={styles.sectionDescription}>
                Add up to {EMOJI_LIMIT} custom emoji that anyone in this server can use.
              </p>
              <div className={styles.emojiCountBar}>
                <span>{guildEmojis.length} / {EMOJI_LIMIT} emoji slots used</span>
                <div className={styles.emojiCountTrack}>
                  <div
                    className={styles.emojiCountFill}
                    style={{ width: `${Math.min(100, (guildEmojis.length / EMOJI_LIMIT) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Upload form */}
              <div className={styles.emojiUploadForm}>
                <h3>Upload Emoji</h3>
                <div className={styles.emojiUploadRow}>
                  <input
                    ref={emojiFileInputRef}
                    type="file"
                    accept="image/png,image/gif,image/jpeg,image/webp"
                    className={styles.hiddenInput}
                    data-testid="emoji-file-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 256 * 1024) {
                        setEmojiError('Image must be under 256 KB.');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = reader.result as string;
                        setEmojiUploadPreview(result);
                        setEmojiUploadBase64(result);
                        // Auto-fill name from filename
                        if (!emojiUploadName) {
                          const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
                          setEmojiUploadName(baseName);
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <button
                    className={styles.emojiUploadBtn}
                    onClick={() => emojiFileInputRef.current?.click()}
                    type="button"
                  >
                    {emojiUploadPreview ? (
                      <img src={emojiUploadPreview} alt="Emoji preview" className={styles.emojiPreviewImg} />
                    ) : (
                      <span className={styles.emojiUploadPlaceholder}>+</span>
                    )}
                  </button>
                  <input
                    type="text"
                    className={styles.emojiNameInput}
                    placeholder="emoji_name"
                    value={emojiUploadName}
                    maxLength={32}
                    onChange={(e) => setEmojiUploadName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
                    aria-label="Emoji name"
                  />
                  <button
                    className={styles.btnPrimary}
                    disabled={!emojiUploadBase64 || !emojiUploadName || emojiUploading || guildEmojis.length >= EMOJI_LIMIT}
                    onClick={async () => {
                      if (!emojiUploadBase64 || !emojiUploadName) return;
                      setEmojiUploading(true);
                      setEmojiError(null);
                      try {
                        const created = await api.createGuildEmoji(guildId, {
                          name: emojiUploadName,
                          image: emojiUploadBase64,
                        });
                        setGuildEmojis(prev => [...prev, created]);
                        setEmojiUploadName('');
                        setEmojiUploadPreview(null);
                        setEmojiUploadBase64(null);
                        if (emojiFileInputRef.current) emojiFileInputRef.current.value = '';
                      } catch {
                        setEmojiError('Failed to upload emoji.');
                      } finally {
                        setEmojiUploading(false);
                      }
                    }}
                    type="button"
                    data-testid="emoji-upload-submit"
                  >
                    {emojiUploading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
                {emojiError && <div className={styles.errorText}>{emojiError}</div>}
              </div>

              {/* Emoji list */}
              {emojisLoading ? (
                <div className={styles.loadingText}>Loading emoji...</div>
              ) : (
                <div className={styles.emojiList}>
                  {guildEmojis.length === 0 && (
                    <p className={styles.emptyText}>No custom emoji yet. Upload one above!</p>
                  )}
                  {guildEmojis.map(emoji => (
                    <div key={emoji.id} className={styles.emojiRow} data-testid="emoji-row">
                      <div className={styles.emojiImage}>
                        <img
                          src={emojiUrl(emoji.id, emoji.animated)}
                          alt={emoji.name}
                          width={32}
                          height={32}
                          loading="lazy"
                        />
                      </div>
                      <span className={styles.emojiName}>:{emoji.name}:</span>
                      {emoji.user && (
                        <span className={styles.emojiUploader}>by {emoji.user.username}</span>
                      )}
                      <button
                        className={styles.emojiDeleteBtn}
                        onClick={async () => {
                          try {
                            await api.deleteGuildEmoji(guildId, emoji.id);
                            setGuildEmojis(prev => prev.filter(e => e.id !== emoji.id));
                          } catch {
                            setEmojiError('Failed to delete emoji.');
                          }
                        }}
                        aria-label={`Delete emoji ${emoji.name}`}
                        type="button"
                        data-testid="emoji-delete-btn"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15ZM5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ====== STICKERS ====== */}
          {activeSection === 'stickers' && (
            <StickersSection guildId={guildId} guildName={guild.name} premiumTier={guild.premium_tier ?? 0} />
          )}

          {/* ====== SOUNDBOARD ====== */}
          {activeSection === 'soundboard' && (
            <SoundboardSection guildId={guildId} guildName={guild.name} premiumTier={guild.premium_tier ?? 0} />
          )}

          {/* ====== WIDGET ====== */}
          {activeSection === 'widget' && (
            <WidgetSection guildId={guildId} guildName={guild.name} channels={channels} />
          )}

          {/* ====== SERVER TEMPLATE ====== */}
          {activeSection === 'server-template' && (
            <ServerTemplateSection guildId={guildId} />
          )}

          {/* ====== VANITY URL ====== */}
          {activeSection === 'vanity-url' && (
            <VanityURLSection guildId={guildId} premiumTier={guild.premium_tier ?? 0} />
          )}

          {/* ====== CHANNELS ====== */}
          {activeSection === 'channels' && (
            <div className={styles.section}>
              <h2>Channels</h2>
              <div className={styles.channelsList}>
                {channels.sort((a, b) => a.position - b.position).map(ch => (
                  <div key={ch.id} className={styles.channelRow}>
                    <span className={styles.channelType}>{ch.type === 2 ? '\u{1F50A}' : '#'}</span>
                    <span className={styles.channelName}>{ch.name}</span>
                    <div className={styles.channelRowActions}>
                      <button
                        className={styles.iconBtn}
                        onClick={() => startEditChannel(ch)}
                        title="Edit channel"
                        aria-label={`Edit ${ch.name ?? 'channel'}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/>
                        </svg>
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.dangerIcon}`}
                        onClick={() => setDeleteConfirmChannelId(ch.id)}
                        title="Delete channel"
                        aria-label={`Delete ${ch.name ?? 'channel'}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M15 2H11V1a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v1H1v2h1v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4h1V2zm-9 0V1h4v1H6z"/>
                        </svg>
                      </button>
                    </div>

                    {deleteConfirmChannelId === ch.id && (
                      <div className={styles.deleteConfirm}>
                        <p>Delete <strong>#{ch.name}</strong>? This cannot be undone.</p>
                        <div className={styles.confirmActions}>
                          <button className={styles.cancelBtn} onClick={() => setDeleteConfirmChannelId(null)}>Cancel</button>
                          <button className={styles.dangerBtn} onClick={() => handleDeleteChannel(ch.id)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {editingChannelId && (
                <div className={styles.editPanel}>
                  <h3>Edit Channel</h3>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>CHANNEL NAME</label>
                    <input
                      className={styles.formInput}
                      type="text"
                      value={editChannelName}
                      onChange={e => setEditChannelName(e.target.value)}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>CHANNEL TOPIC</label>
                    <textarea
                      className={styles.formTextarea}
                      value={editChannelTopic}
                      onChange={e => setEditChannelTopic(e.target.value)}
                      rows={3}
                      placeholder="Set a topic for this channel"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <div className={styles.toggleRow}>
                      <div>
                        <label className={styles.formLabel}>NSFW CHANNEL</label>
                        <p className={styles.formHint}>Users must confirm they are 18+ to view</p>
                      </div>
                      <button
                        className={`${styles.toggle} ${editChannelNsfw ? styles.toggleOn : ''}`}
                        onClick={() => setEditChannelNsfw(!editChannelNsfw)}
                        aria-label="Toggle NSFW"
                      >
                        <div className={styles.toggleKnob} />
                      </button>
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>SLOWMODE ({editChannelSlowmode}s)</label>
                    <input
                      type="range"
                      min={0}
                      max={21600}
                      step={5}
                      value={editChannelSlowmode}
                      onChange={e => setEditChannelSlowmode(Number(e.target.value))}
                      className={styles.rangeInput}
                    />
                  </div>
                  <div className={styles.editActions}>
                    <button className={styles.cancelBtn} onClick={() => setEditingChannelId(null)}>Cancel</button>
                    <button className={styles.saveBtn} onClick={handleSaveChannel}>Save</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== MEMBERS ====== */}
          {activeSection === 'members' && (
            <div className={styles.section}>
              <h2>Members ({members.length})</h2>
              <div className={styles.membersList}>
                {members.map(member => {
                  const memberRoles = roles.filter(r => member.roles.includes(r.id));
                  return (
                    <div
                      key={member.user.id}
                      className={styles.memberRow}
                      onContextMenu={e => handleMemberContextMenu(e, member.user.id)}
                    >
                      <div className={styles.memberAvatar}>
                        {member.user.username.charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.memberInfo}>
                        <span className={styles.memberName}>
                          {member.nick ?? member.user.username}
                        </span>
                        <span className={styles.memberUsername}>{member.user.username}</span>
                      </div>
                      <div className={styles.memberRoles}>
                        {memberRoles.map(r => (
                          <span
                            key={r.id}
                            className={styles.rolePill}
                            style={{ borderColor: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#9EAFBA' }}
                          >
                            <span
                              className={styles.roleDot}
                              style={{ backgroundColor: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#9EAFBA' }}
                            />
                            {r.name}
                          </span>
                        ))}
                      </div>
                      <div className={styles.memberActions}>
                        <button
                          className={styles.iconBtn}
                          onClick={() => {
                            setNickEditUserId(member.user.id);
                            setNickEditValue(member.nick ?? '');
                          }}
                          title="Edit nickname"
                          aria-label="Edit nickname"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/>
                          </svg>
                        </button>
                        <button
                          className={styles.iconBtn}
                          onClick={() => setRoleAssignUserId(roleAssignUserId === member.user.id ? null : member.user.id)}
                          title="Manage roles"
                          aria-label="Manage roles"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13zM11 7H9V5a1 1 0 0 0-2 0v2H5a1 1 0 0 0 0 2h2v2a1 1 0 0 0 2 0V9h2a1 1 0 0 0 0-2z"/>
                          </svg>
                        </button>
                        {member.user.id !== guild.owner_id && member.user.id !== currentUserId && (
                          <>
                            <button
                              className={`${styles.iconBtn} ${styles.dangerIcon}`}
                              onClick={() => handleKick(member.user.id)}
                              title="Kick member"
                              aria-label="Kick member"
                            >
                              Kick
                            </button>
                            <button
                              className={`${styles.iconBtn} ${styles.dangerIcon}`}
                              onClick={() => setShowBanDialog(member.user.id)}
                              title="Ban member"
                              aria-label="Ban member"
                            >
                              Ban
                            </button>
                          </>
                        )}
                      </div>

                      {/* Nickname edit inline */}
                      {nickEditUserId === member.user.id && (
                        <div className={styles.inlineEdit}>
                          <input
                            className={styles.formInput}
                            type="text"
                            value={nickEditValue}
                            onChange={e => setNickEditValue(e.target.value)}
                            placeholder="Nickname"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleChangeNick(member.user.id);
                              if (e.key === 'Escape') setNickEditUserId(null);
                            }}
                          />
                          <button className={styles.saveBtn} onClick={() => handleChangeNick(member.user.id)}>Save</button>
                          <button className={styles.cancelBtn} onClick={() => setNickEditUserId(null)}>Cancel</button>
                        </div>
                      )}

                      {/* Role assignment dropdown */}
                      {roleAssignUserId === member.user.id && (
                        <div className={styles.roleDropdown}>
                          {sortedRoles.map(r => {
                            const hasIt = member.roles.includes(r.id);
                            return (
                              <button
                                key={r.id}
                                className={`${styles.roleDropdownItem} ${hasIt ? styles.roleDropdownActive : ''}`}
                                onClick={() => handleToggleRole(member.user.id, r.id, hasIt)}
                              >
                                <span
                                  className={styles.roleDot}
                                  style={{ backgroundColor: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : '#9EAFBA' }}
                                />
                                {r.name}
                                {hasIt && <span className={styles.checkmark}>&#10003;</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Ban dialog */}
              {showBanDialog && (
                <div className={styles.dialogOverlay}>
                  <div className={styles.dialog}>
                    <h3>Ban Member</h3>
                    <p>Are you sure you want to ban this member?</p>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>REASON (OPTIONAL)</label>
                      <input
                        className={styles.formInput}
                        type="text"
                        value={banReason}
                        onChange={e => setBanReason(e.target.value)}
                        placeholder="Reason for ban"
                      />
                    </div>
                    <div className={styles.dialogActions}>
                      <button className={styles.cancelBtn} onClick={() => setShowBanDialog(null)}>Cancel</button>
                      <button className={styles.dangerBtn} onClick={() => handleBan(showBanDialog)}>Ban</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== BANS ====== */}
          {activeSection === 'bans' && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2>Server Ban List</h2>
              </div>
              <p className={styles.banDescription}>
                Bans by default are by account and IP. A user can circumvent an IP ban by using a proxy. Ban circumvention can be made very hard by enabling phone verification in Moderation.
              </p>

              {/* Ban search */}
              <div className={styles.banSearchSection} data-testid="ban-search-section">
                <input
                  className={styles.banSearchInput}
                  type="text"
                  placeholder="Search Bans by User ID or Username"
                  value={banSearchQuery}
                  onChange={e => setBanSearchQuery(e.target.value)}
                  aria-label="Search Bans by User ID or Username"
                  data-testid="ban-search-input"
                />
                <button
                  className={styles.banSearchBtn}
                  type="button"
                  data-testid="ban-search-button"
                >
                  Search
                </button>
              </div>

              {bansLoading ? (
                <div className={styles.loading}>Loading bans...</div>
              ) : bans.length === 0 ? (
                <p className={styles.emptyState}>No banned users</p>
              ) : (
                <div className={styles.bansList} data-testid="bans-list">
                  {bans
                    .filter(ban => {
                      if (!banSearchQuery.trim()) return true;
                      const q = banSearchQuery.toLowerCase();
                      return (
                        ban.user.username.toLowerCase().includes(q) ||
                        ban.user.id.includes(q)
                      );
                    })
                    .map(ban => (
                    <div
                      key={ban.user.id}
                      className={styles.banRow}
                      onClick={() => setSelectedBan(ban)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setSelectedBan(ban); }}
                      data-testid="ban-entry"
                    >
                      <div className={styles.banUser}>
                        <div className={styles.banAvatar}>
                          {ban.user.username.charAt(0).toUpperCase()}
                        </div>
                        <div className={styles.banUserInfo}>
                          <span className={styles.banDisplayName}>{ban.user.username}</span>
                          <span className={styles.banUsername}>{ban.user.username}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ban Detail Modal */}
              {selectedBan && (
                <div className={styles.modalOverlay} onClick={() => setSelectedBan(null)} data-testid="ban-detail-modal">
                  <div className={styles.banModal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Ban details">
                    <button
                      className={styles.banModalClose}
                      onClick={() => setSelectedBan(null)}
                      aria-label="Close"
                      type="button"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                      </svg>
                    </button>
                    <h3 className={styles.banModalTitle}>{selectedBan.user.username}</h3>
                    <div className={styles.banModalReason}>
                      <span className={styles.banModalReasonLabel}>Ban Reason</span>
                      <p className={styles.banModalReasonText}>
                        {selectedBan.reason ?? 'No reason provided'}
                      </p>
                    </div>
                    <div className={styles.banModalFooter}>
                      <button
                        className={styles.revokeBanBtn}
                        onClick={() => handleRevokeBanFromModal(selectedBan.user.id)}
                        data-testid="modal-revoke-ban"
                      >
                        Revoke Ban
                      </button>
                      <button
                        className={styles.banModalDoneBtn}
                        onClick={() => setSelectedBan(null)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== AUTOMOD ====== */}
          {activeSection === 'automod' && (
            <div className={styles.section}>
              <h2>AutoMod</h2>
              <p className={styles.sectionDescription}>
                Automatically moderate your server with rules that detect and take action on unwanted content.
              </p>

              {automodLoading ? (
                <div className={styles.loadingText}>Loading rules...</div>
              ) : (
                <AutoModSection
                  guildId={guildId}
                  rules={automodRules}
                  dispatch={dispatch}
                  newKeyword={newKeyword}
                  setNewKeyword={setNewKeyword}
                />
              )}
            </div>
          )}

          {/* ====== SAFETY SETUP ====== */}
          {activeSection === 'safety-setup' && (
            <SafetySetupSection
              guildId={guildId}
              dispatch={dispatch}
              verificationLevel={guildSafety?.verification_level ?? 0}
              explicitContentFilter={guildSafety?.explicit_content_filter ?? 0}
            />
          )}

          {/* ====== AUDIT LOG ====== */}
          {activeSection === 'audit-log' && (
            <div className={styles.section}>
              <h2>Audit Log</h2>

              {auditError && (
                <div className={styles.errorBanner} role="alert" data-testid="audit-error">
                  <span>{auditError}</span>
                  <button
                    className={styles.errorDismiss}
                    onClick={() => setAuditError(null)}
                    type="button"
                    aria-label="Dismiss error"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Filter bar - always visible */}
              <div className={styles.auditFilterBar} data-testid="audit-filter-bar">
                <select
                  className={styles.auditFilterSelect}
                  value={auditFilterUser ?? ''}
                  onChange={e => setAuditFilterUser(e.target.value || null)}
                  data-testid="audit-filter-user"
                  aria-label="Filter by User"
                >
                  <option value="">All Users</option>
                  {auditUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.username}</option>
                  ))}
                </select>
                <select
                  className={styles.auditFilterSelect}
                  value={auditFilterType ?? ''}
                  onChange={e => setAuditFilterType(e.target.value ? Number(e.target.value) : null)}
                  data-testid="audit-filter-select"
                  aria-label="Filter by Action"
                >
                  <option value="">All Actions</option>
                  {Object.entries(AUDIT_ACTION_NAMES).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {auditLoading ? (
                <div className={styles.loading}>Loading audit log...</div>
              ) : auditEntries.length === 0 ? (
                <div className={styles.auditEmptyState} data-testid="audit-empty">
                  <svg className={styles.auditEmptyIcon} width="80" height="80" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                  </svg>
                  <p className={styles.auditEmptyTitle}>NO LOGS YET</p>
                  <p className={styles.auditEmptySubtitle}>Once moderators begin moderating, you can moderate the moderation here.</p>
                </div>
              ) : (
                <div className={styles.auditList} data-testid="audit-list">
                  {auditEntries
                    .filter(entry => auditFilterType === null || entry.action_type === auditFilterType)
                    .filter(entry => auditFilterUser === null || entry.user_id === auditFilterUser)
                    .map(entry => (
                    <div key={entry.id} className={styles.auditRow} data-testid="audit-entry">
                      <div className={styles.auditEntryAvatar}>
                        {getAuditUsername(entry.user_id).charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.auditEntryContent}>
                        <div className={styles.auditMain}>
                          <span className={styles.auditUser}>{getAuditUsername(entry.user_id)}</span>
                          <span className={styles.auditAction}>
                            {AUDIT_ACTION_NAMES[entry.action_type] ?? `Action ${entry.action_type}`}
                          </span>
                          {entry.target_id && (
                            <span className={styles.auditTarget}>
                              {entry.target_id}
                            </span>
                          )}
                        </div>
                        <span className={styles.auditTime}>
                          {formatTimestamp(entry.created_at)}
                        </span>
                        {entry.reason && (
                          <span className={styles.auditReason}>Reason: {entry.reason}</span>
                        )}
                        {entry.changes && entry.changes.length > 0 && (
                          <div className={styles.auditChanges}>
                            {entry.changes.map((change, idx) => (
                              <span key={idx} className={styles.auditChange}>
                                {change.key}: {String(change.old_value ?? '(none)')} {'\u2192'} {String(change.new_value ?? '(none)')}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ====== INVITES ====== */}
          {activeSection === 'invites' && (
            <div className={styles.section}>
              <h2>Invites</h2>
              {invitesLoading ? (
                <div className={styles.loading}>Loading invites...</div>
              ) : invites.length === 0 ? (
                <p className={styles.emptyState}>No active invites</p>
              ) : (
                <div className={styles.invitesList}>
                  {invites.map(inv => (
                    <div key={inv.code} className={styles.inviteRow}>
                      <div className={styles.inviteInfo}>
                        <span className={styles.inviteCode}>{inv.code}</span>
                        <span className={styles.inviteChannel}>#{inv.channel.name}</span>
                        {inv.inviter && (
                          <span className={styles.inviteCreator}>by {inv.inviter.username}</span>
                        )}
                      </div>
                      <div className={styles.inviteMeta}>
                        <span className={styles.inviteUses}>
                          {inv.uses}{inv.max_uses > 0 ? `/${inv.max_uses}` : ''} uses
                        </span>
                        <span className={styles.inviteExpiry}>
                          Expires: {formatMaxAge(inv.max_age)}
                        </span>
                      </div>
                      <button
                        className={styles.dangerBtn}
                        onClick={() => handleRevokeInvite(inv.code)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ====== INTEGRATIONS (WEBHOOKS) ====== */}
          {activeSection === 'integrations' && (
            <div className={styles.section}>
              <h2>Integrations</h2>
              <p className={styles.emptyState} style={{ marginBottom: 16 }}>
                Manage webhooks for your server. Webhooks allow external services to send messages to your channels.
              </p>
              {webhooksError && (
                <div className={styles.errorMessage} role="alert">{webhooksError}</div>
              )}

              {/* Create Webhook form */}
              {showCreateWebhookForm ? (
                <div className={styles.webhookCreateForm} role="region" aria-label="Create webhook">
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="webhook-create-name">WEBHOOK NAME</label>
                    <input
                      id="webhook-create-name"
                      type="text"
                      className={styles.formInput}
                      value={newWebhookName}
                      onChange={(e) => setNewWebhookName(e.target.value)}
                      placeholder="New Webhook"
                      maxLength={80}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="webhook-create-channel">CHANNEL</label>
                    <select
                      id="webhook-create-channel"
                      className={styles.select}
                      value={newWebhookChannelId || textChannels[0]?.id || ''}
                      onChange={(e) => setNewWebhookChannelId(e.target.value)}
                    >
                      {textChannels.map(ch => (
                        <option key={ch.id} value={ch.id}>#{ch.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.webhookCreateActions}>
                    <button
                      type="button"
                      className={styles.saveBtn}
                      onClick={() => { setShowCreateWebhookForm(false); setNewWebhookName(''); setNewWebhookChannelId(''); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.saveBtn}
                      disabled={isCreatingWebhook || textChannels.length === 0}
                      onClick={() => void handleCreateWebhook()}
                    >
                      {isCreatingWebhook ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={() => setShowCreateWebhookForm(true)}
                  style={{ marginBottom: 16 }}
                >
                  Create Webhook
                </button>
              )}

              {/* Webhooks list */}
              {webhooksLoading ? (
                <div className={styles.loading}>Loading webhooks...</div>
              ) : webhooks.length === 0 && !showCreateWebhookForm ? (
                <div className={styles.emptyState}>No webhooks in this server</div>
              ) : (
                <div className={styles.webhooksList}>
                  {webhooks.map(wh => (
                    <div key={wh.id} className={styles.webhookRow}>
                      <div className={styles.webhookAvatar} aria-hidden="true">
                        {wh.name.charAt(0).toUpperCase()}
                      </div>
                      <div className={styles.webhookInfo}>
                        <span className={styles.webhookName}>{wh.name}</span>
                        <span className={styles.webhookChannel}>#{getChannelName(wh.channel_id)}</span>
                        {wh.user && (
                          <span className={styles.webhookCreator}>Created by {wh.user.username}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.webhookCopyBtn}
                        onClick={() => handleCopyWebhookUrl(wh)}
                        aria-label={`Copy URL for webhook ${wh.name}`}
                      >
                        {copiedWebhookId === wh.id ? 'Copied!' : 'Copy URL'}
                      </button>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => setShowDeleteWebhookConfirm(wh.id)}
                        aria-label={`Delete webhook ${wh.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Delete webhook confirmation dialog */}
              {showDeleteWebhookConfirm && (
                <div className={styles.confirmOverlay} onClick={() => setShowDeleteWebhookConfirm(null)}>
                  <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm delete webhook">
                    <h3>Delete Webhook</h3>
                    <p>Are you sure you want to delete this webhook? This action cannot be undone.</p>
                    <div className={styles.confirmActions}>
                      <button
                        type="button"
                        className={styles.saveBtn}
                        onClick={() => setShowDeleteWebhookConfirm(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => void handleDeleteWebhook(showDeleteWebhookConfirm)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ====== ONBOARDING ====== */}
          {activeSection === 'onboarding' && (
            <OnboardingSection guildId={guildId} channels={channels} />
          )}

          {/* ====== WELCOME SCREEN ====== */}
          {activeSection === 'welcome-screen' && (
            <WelcomeScreenSection guildId={guildId} channels={channels} />
          )}

          {/* ====== DELETE SERVER ====== */}
          {activeSection === 'delete' && isOwner && (
            <div className={styles.section}>
              <h2>Delete Server</h2>
              <div className={styles.dangerZone}>
                <p className={styles.dangerText}>
                  Deleting a server is permanent and cannot be undone. All channels, messages, and data will be lost.
                </p>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    ENTER SERVER NAME TO CONFIRM
                  </label>
                  <input
                    className={styles.formInput}
                    type="text"
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder={guild.name}
                  />
                </div>
                <button
                  className={styles.dangerBtn}
                  disabled={deleteConfirm !== guild.name}
                  onClick={handleDeleteGuild}
                >
                  Delete Server
                </button>
              </div>
            </div>
          )}
          </div>
          <button className={styles.closeBtn} onClick={() => {
            if (roleHasUnsavedChanges) {
              pendingNavAction.current = onClose;
              setShowDiscardDialog(true);
            } else {
              onClose();
            }
          }} aria-label="Close settings">
            <div className={styles.closeIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
              </svg>
            </div>
            <div className={styles.closeLabel}>ESC</div>
          </button>
        </div>
      </div>

      {/* Floating member context menu */}
      {memberMenuId && (
        <div
          className={styles.contextMenuBackdrop}
          onClick={() => setMemberMenuId(null)}
        >
          <div
            className={styles.contextMenu}
            style={{ top: memberMenuPos.y, left: memberMenuPos.x }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                setNickEditUserId(memberMenuId);
                const m = members.find(m => m.user.id === memberMenuId);
                setNickEditValue(m?.nick ?? '');
                setMemberMenuId(null);
              }}
            >
              Change Nickname
            </button>
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                setRoleAssignUserId(memberMenuId);
                setMemberMenuId(null);
              }}
            >
              Assign Roles
            </button>
            {memberMenuId !== guild.owner_id && memberMenuId !== currentUserId && (
              <>
                <div className={styles.contextMenuSep} />
                <button
                  className={`${styles.contextMenuItem} ${styles.danger}`}
                  onClick={() => { handleKick(memberMenuId); }}
                >
                  Kick
                </button>
                <button
                  className={`${styles.contextMenuItem} ${styles.danger}`}
                  onClick={() => {
                    setShowBanDialog(memberMenuId);
                    setMemberMenuId(null);
                  }}
                >
                  Ban
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Role delete confirmation dialog (Fix 6) */}
      {showDeleteRoleConfirm && selectedRole && (
        <div className={styles.dialogOverlay} data-testid="delete-role-dialog">
          <div className={styles.dialog}>
            <h3>Delete Role</h3>
            <p>
              Are you sure you want to delete <strong>{selectedRole.name}</strong>? This action cannot be undone.
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.cancelBtn} onClick={() => setShowDeleteRoleConfirm(false)}>
                Cancel
              </button>
              <button className={styles.dangerBtn} onClick={handleDeleteRole}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discard unsaved changes dialog (Fix 8) */}
      {showDiscardDialog && (
        <div className={styles.dialogOverlay} data-testid="discard-changes-dialog">
          <div className={styles.dialog}>
            <h3>Unsaved Changes</h3>
            <p>You have unsaved changes. Are you sure you want to discard them?</p>
            <div className={styles.dialogActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  setShowDiscardDialog(false);
                  pendingNavAction.current = null;
                }}
              >
                Cancel
              </button>
              <button
                className={styles.dangerBtn}
                onClick={() => {
                  setShowDiscardDialog(false);
                  setRoleHasUnsavedChanges(false);
                  originalRoleValues.current = null;
                  if (pendingNavAction.current) {
                    pendingNavAction.current();
                    pendingNavAction.current = null;
                  }
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── AutoMod Section Component ───

interface AutoModSectionProps {
  guildId: string;
  rules: AutoModRule[];
  dispatch: ReturnType<typeof useAppDispatch>;
  newKeyword: string;
  setNewKeyword: (val: string) => void;
}

function AutoModSection({ guildId, rules, dispatch, newKeyword, setNewKeyword }: AutoModSectionProps) {
  const keywordRule = rules.find(r => r.trigger_type === 1);

  const handleToggleRule = async (rule: AutoModRule | undefined, triggerType: number, name: string) => {
    if (rule) {
      dispatch(updateAutoModRule({
        guildId,
        ruleId: rule.id,
        data: { enabled: !rule.enabled },
      }));
    } else {
      dispatch(createAutoModRule({
        guildId,
        rule: {
          name,
          event_type: 1,
          trigger_type: triggerType,
          trigger_metadata: {},
          actions: [{ type: 1 }],
          enabled: true,
          exempt_roles: [],
          exempt_channels: [],
        },
      }));
    }
  };

  const handleAddKeyword = () => {
    const word = newKeyword.trim();
    if (!word) return;

    const existingKeywords = keywordRule?.trigger_metadata?.keyword_filter ?? [];
    if (existingKeywords.includes(word)) return;
    const updated = [...existingKeywords, word];

    if (keywordRule) {
      dispatch(updateAutoModRule({
        guildId,
        ruleId: keywordRule.id,
        data: { trigger_metadata: { keyword_filter: updated } },
      }));
    } else {
      dispatch(createAutoModRule({
        guildId,
        rule: {
          name: 'Keyword Filter',
          event_type: 1,
          trigger_type: 1,
          trigger_metadata: { keyword_filter: updated },
          actions: [{ type: 1 }],
          enabled: true,
          exempt_roles: [],
          exempt_channels: [],
        },
      }));
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (word: string) => {
    if (!keywordRule) return;
    const existingKeywords = keywordRule.trigger_metadata?.keyword_filter ?? [];
    const updated = existingKeywords.filter(k => k !== word);
    dispatch(updateAutoModRule({
      guildId,
      ruleId: keywordRule.id,
      data: { trigger_metadata: { keyword_filter: updated } },
    }));
  };

  const handleSetAction = (rule: AutoModRule, actionType: 1 | 2 | 3) => {
    dispatch(updateAutoModRule({
      guildId,
      ruleId: rule.id,
      data: { actions: [{ type: actionType }] },
    }));
  };

  const currentKeywords = keywordRule?.trigger_metadata?.keyword_filter ?? [];

  return (
    <div className={styles.automodContainer}>
      {/* Keyword Filter Rule */}
      <div className={styles.automodRule} data-testid="automod-keyword-rule">
        <div className={styles.automodRuleHeader}>
          <div>
            <h3>Keyword Filter</h3>
            <p className={styles.automodRuleDescription}>
              Block messages containing specific words or phrases.
            </p>
          </div>
          <button
            className={`${styles.toggle} ${keywordRule?.enabled ? styles.toggleOn : ''}`}
            onClick={() => handleToggleRule(keywordRule, 1, 'Keyword Filter')}
            aria-label="Toggle keyword filter"
            role="switch"
            aria-checked={keywordRule?.enabled ?? false}
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>

        {keywordRule?.enabled && (
          <div className={styles.automodRuleBody}>
            <div className={styles.automodKeywordInput}>
              <input
                type="text"
                className={styles.input}
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
                placeholder="Add a blocked word..."
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword(); } }}
                aria-label="Blocked word"
              />
              <button
                className={styles.createBtn}
                onClick={handleAddKeyword}
                disabled={!newKeyword.trim()}
              >
                Add
              </button>
            </div>
            <div className={styles.automodKeywordList}>
              {currentKeywords.map(word => (
                <span key={word} className={styles.automodKeywordTag}>
                  {word}
                  <button
                    className={styles.automodKeywordRemove}
                    onClick={() => handleRemoveKeyword(word)}
                    aria-label={`Remove keyword ${word}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
              {currentKeywords.length === 0 && (
                <span className={styles.automodEmptyText}>No blocked words yet.</span>
              )}
            </div>
            <div className={styles.automodActionSelect}>
              <label className={styles.label}>ACTION</label>
              <select
                className={styles.select}
                value={keywordRule.actions[0]?.type ?? 1}
                onChange={e => handleSetAction(keywordRule, Number(e.target.value) as 1 | 2 | 3)}
                aria-label="Action for keyword filter"
              >
                <option value={1}>Block Message</option>
                <option value={2}>Send Alert</option>
                <option value={3}>Timeout User</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── STICKERS SECTION ───
interface StickersSectionProps {
  guildId: string;
  guildName: string;
  premiumTier: number;
}

interface StickerEntry {
  id: string;
  name: string;
  description: string;
  tags: string;
  formatType: number;
}

function StickersSection({ guildId, premiumTier }: StickersSectionProps) {
  const [stickers, setStickers] = useState<StickerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTags, setNewTags] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const stickerLimit = premiumTier >= 3 ? 60 : premiumTier >= 2 ? 30 : premiumTier >= 1 ? 15 : 5;

  useEffect(() => {
    setLoading(true);
    const fetchStickers = async () => {
      try {
        const data = await api.getGuildStickers(guildId);
        setStickers(data as unknown as StickerEntry[]);
      } catch {
        setStickers([]);
      } finally {
        setLoading(false);
      }
    };
    void fetchStickers();
  }, [guildId]);

  const handleUpload = async () => {
    if (!newName.trim() || !selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('name', newName.trim());
      formData.append('description', newDescription.trim());
      formData.append('tags', newTags.trim());
      formData.append('file', selectedFile);
      const newSticker = await api.createGuildSticker(guildId, formData);
      if (newSticker) {
        setStickers(prev => [...prev, newSticker as unknown as StickerEntry]);
      }
      setNewName('');
      setNewDescription('');
      setNewTags('');
      setSelectedFile(null);
      setShowUpload(false);
    } catch {
      // Upload failed
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (stickerId: string) => {
    try {
      await api.deleteGuildSticker(guildId, stickerId);
      setStickers(prev => prev.filter(s => s.id !== stickerId));
    } catch {
      // Delete failed
    }
  };

  return (
    <div className={styles.section}>
      <h2>Stickers</h2>
      <p className={styles.sectionDescription}>
        Upload custom stickers for members to use in this server.
      </p>
      <div className={styles.fieldHint}>
        {stickers.length} / {stickerLimit} sticker slots used
      </div>

      {!showUpload && stickers.length < stickerLimit && (
        <button
          className={styles.primaryBtn}
          onClick={() => setShowUpload(true)}
          type="button"
        >
          Upload Sticker
        </button>
      )}

      {showUpload && (
        <div className={styles.uploadForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>NAME</label>
            <input
              className={styles.formInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Sticker name"
              maxLength={30}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>DESCRIPTION</label>
            <input
              className={styles.formInput}
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="What does this sticker represent?"
              maxLength={100}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>RELATED EMOJI</label>
            <input
              className={styles.formInput}
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
              placeholder="e.g. wave, hello"
              maxLength={200}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>FILE</label>
            <input
              type="file"
              accept="image/png,image/apng,application/json"
              onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
              className={styles.formInput}
            />
            <div className={styles.fieldHint}>
              File must be PNG, APNG, or Lottie JSON. Under 512 KB, 320x320 pixels.
            </div>
          </div>
          <div className={styles.buttonRow}>
            <button
              className={styles.secondaryBtn}
              onClick={() => setShowUpload(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className={styles.primaryBtn}
              onClick={() => void handleUpload()}
              disabled={!newName.trim() || !selectedFile || uploading}
              type="button"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.loadingText}>Loading stickers...</div>
      ) : stickers.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No stickers yet. Upload one to get started!</p>
        </div>
      ) : (
        <div className={styles.stickerList} role="list">
          {stickers.map(sticker => (
            <div key={sticker.id} className={styles.stickerItem} role="listitem">
              <div className={styles.stickerPreview}>
                <span className={styles.stickerEmoji}>{sticker.tags || '?'}</span>
              </div>
              <div className={styles.stickerInfo}>
                <span className={styles.stickerName}>{sticker.name}</span>
                {sticker.description && (
                  <span className={styles.stickerDesc}>{sticker.description}</span>
                )}
              </div>
              <button
                className={styles.dangerBtn}
                onClick={() => void handleDelete(sticker.id)}
                type="button"
                aria-label={`Delete sticker ${sticker.name}`}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SOUNDBOARD SECTION ───
interface SoundboardSectionProps {
  guildId: string;
  guildName: string;
  premiumTier?: number;
}

interface SoundEntry {
  id: string;
  name: string;
  volume: number;
  emojiName: string | null;
}

function SoundboardSection({ guildId, premiumTier = 0 }: SoundboardSectionProps) {
  const [sounds, setSounds] = useState<SoundEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const soundLimit = premiumTier >= 3 ? 48 : premiumTier >= 2 ? 36 : premiumTier >= 1 ? 24 : 8;

  useEffect(() => {
    setLoading(true);
    const fetchSounds = async () => {
      try {
        const data = await api.getGuildSoundboardSounds(guildId);
        setSounds(data as unknown as SoundEntry[]);
      } catch {
        setSounds([]);
      } finally {
        setLoading(false);
      }
    };
    void fetchSounds();
  }, [guildId]);

  const handleUpload = async () => {
    if (!newName.trim() || !selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('name', newName.trim());
      formData.append('file', selectedFile);
      const newSound = await api.createGuildSoundboardSound(guildId, formData);
      if (newSound) {
        setSounds(prev => [...prev, newSound as unknown as SoundEntry]);
      }
      setNewName('');
      setSelectedFile(null);
      setShowUpload(false);
    } catch {
      // Failed
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (soundId: string) => {
    try {
      await api.deleteGuildSoundboardSound(guildId, soundId);
      setSounds(prev => prev.filter(s => s.id !== soundId));
    } catch {
      // Failed
    }
  };

  const handlePlay = (soundId: string) => {
    api.playGuildSoundboardSound(guildId, soundId).catch(() => {
      // Playback failed
    });
  };

  return (
    <div className={styles.section}>
      <h2>Soundboard</h2>
      <p className={styles.sectionDescription}>
        Upload custom sounds for members to play in voice channels.
      </p>
      <div className={styles.fieldHint}>
        {sounds.length} / {soundLimit} sound slots used
      </div>

      {!showUpload && sounds.length < soundLimit && (
        <button
          className={styles.primaryBtn}
          onClick={() => setShowUpload(true)}
          type="button"
        >
          Upload Sound
        </button>
      )}

      {showUpload && (
        <div className={styles.uploadForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>NAME</label>
            <input
              className={styles.formInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Sound name"
              maxLength={32}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>RELATED EMOJI</label>
            <input
              className={styles.formInput}
              value={newEmoji}
              onChange={e => setNewEmoji(e.target.value)}
              placeholder="e.g. laughing"
              maxLength={32}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>AUDIO FILE</label>
            <input
              type="file"
              accept="audio/mp3,audio/ogg,audio/wav"
              onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
              className={styles.formInput}
            />
            <div className={styles.fieldHint}>
              MP3, OGG, or WAV. Max 512 KB, max 5 seconds.
            </div>
          </div>
          <div className={styles.buttonRow}>
            <button
              className={styles.secondaryBtn}
              onClick={() => setShowUpload(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className={styles.primaryBtn}
              onClick={() => void handleUpload()}
              disabled={!newName.trim() || !selectedFile || uploading}
              type="button"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.loadingText}>Loading sounds...</div>
      ) : sounds.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No sounds yet. Upload a sound to get started!</p>
        </div>
      ) : (
        <div className={styles.soundGrid} role="list">
          {sounds.map(sound => (
            <div key={sound.id} className={styles.soundItem} role="listitem">
              <button
                className={styles.soundPlayBtn}
                onClick={() => handlePlay(sound.id)}
                type="button"
                aria-label={`Play ${sound.name}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <div className={styles.soundDetails}>
                <span className={styles.soundName}>{sound.name}</span>
                {sound.emojiName && (
                  <span className={styles.soundEmoji}>{sound.emojiName}</span>
                )}
                <div className={styles.soundVolumeRow}>
                  <label className={styles.soundVolumeLabel} htmlFor={`vol-${sound.id}`}>
                    Vol
                  </label>
                  <input
                    id={`vol-${sound.id}`}
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(sound.volume * 100)}
                    className={styles.rangeInput}
                    readOnly
                    aria-label={`Volume for ${sound.name}`}
                  />
                </div>
              </div>
              <button
                className={styles.soundDeleteBtn}
                onClick={() => void handleDelete(sound.id)}
                type="button"
                aria-label={`Delete ${sound.name}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WIDGET SECTION ───
interface WidgetSectionProps {
  guildId: string;
  guildName: string;
  channels: Array<{ id: string; name?: string | null; type: number }>;
}

function WidgetSection({ guildId, guildName, channels }: WidgetSectionProps) {
  const [widgetEnabled, setWidgetEnabled] = useState(false);
  const [widgetChannelId, setWidgetChannelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const textChannels = useMemo(
    () => channels.filter(c => c.type === 0 || c.type === 5),
    [channels],
  );

  useEffect(() => {
    setLoading(true);
    const fetchWidget = async () => {
      try {
        const data = await api.getGuildWidget(guildId);
        const widgetData = data as unknown as { enabled: boolean; channel_id: string | null };
        setWidgetEnabled(widgetData.enabled);
        setWidgetChannelId(widgetData.channel_id ?? '');
      } catch {
        // Widget not configured
      } finally {
        setLoading(false);
      }
    };
    void fetchWidget();
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateGuildWidget(guildId, {
        enabled: widgetEnabled,
        channel_id: widgetChannelId || null,
      });
    } catch {
      // Failed
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <h2>Widget</h2>
        <div className={styles.loadingText}>Loading widget settings...</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2>Widget</h2>
      <p className={styles.sectionDescription}>
        Enable a widget for your server that can be embedded on external websites.
      </p>

      <div className={styles.formGroup}>
        <div className={styles.toggleRow}>
          <label className={styles.formLabel} htmlFor="widget-enabled-toggle">
            ENABLE SERVER WIDGET
          </label>
          <button
            id="widget-enabled-toggle"
            className={`${styles.toggle} ${widgetEnabled ? styles.toggleOn : ''}`}
            onClick={() => setWidgetEnabled(prev => !prev)}
            role="switch"
            aria-checked={widgetEnabled}
            type="button"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      {widgetEnabled && (
        <>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="widget-channel-select">
              INVITE CHANNEL
            </label>
            <select
              id="widget-channel-select"
              className={styles.selectInput}
              value={widgetChannelId}
              onChange={e => setWidgetChannelId(e.target.value)}
              aria-label="Select widget channel"
            >
              <option value="">No invite channel</option>
              {textChannels.map(ch => (
                <option key={ch.id} value={ch.id}>#{ch.name}</option>
              ))}
            </select>
            <div className={styles.fieldHint}>
              Select a channel for the widget to generate an invite to.
            </div>
          </div>

          <div className={styles.widgetPreview}>
            <div className={styles.widgetPreviewHeader}>
              Widget Preview
            </div>
            <div className={styles.widgetPreviewCard}>
              <div className={styles.widgetPreviewTitle}>{guildName}</div>
              <div className={styles.widgetPreviewOnline}>0 Members Online</div>
              {widgetChannelId && (
                <div className={styles.widgetPreviewInvite}>
                  <button className={styles.widgetPreviewJoinBtn} type="button" disabled>
                    Join
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className={styles.buttonRow}>
        <button
          className={styles.secondaryBtn}
          onClick={() => {
            const code = `<iframe src="${window.location.origin}/widget?id=${guildId}" width="350" height="500" allowtransparency="true" frameborder="0" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"></iframe>`;
            void navigator.clipboard.writeText(code);
          }}
          type="button"
        >
          Copy Widget Code
        </button>
        <button
          className={styles.primaryBtn}
          onClick={() => void handleSave()}
          disabled={saving}
          type="button"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ─── SERVER TEMPLATE SECTION ───
interface ServerTemplateSectionProps {
  guildId: string;
}

interface TemplateEntry {
  code: string;
  name: string;
  description: string | null;
  usage_count: number;
  source_guild_id: string;
  created_at: string;
  updated_at: string;
}

function ServerTemplateSection({ guildId }: ServerTemplateSectionProps) {
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setLoading(true);
    const fetchTemplates = async () => {
      try {
        const data = await api.getGuildTemplates(guildId);
        setTemplates(data as unknown as TemplateEntry[]);
      } catch {
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    };
    void fetchTemplates();
  }, [guildId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const tmpl = await api.createGuildTemplate(guildId, {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      if (tmpl) {
        setTemplates(prev => [...prev, tmpl as unknown as TemplateEntry]);
      }
      setNewName('');
      setNewDescription('');
    } catch {
      // Create failed
    } finally {
      setCreating(false);
    }
  };

  const handleSync = async (code: string) => {
    setSyncing(true);
    try {
      const updated = await api.syncGuildTemplate(guildId, code);
      if (updated) {
        setTemplates(prev =>
          prev.map(t => (t.code === code ? (updated as unknown as TemplateEntry) : t)),
        );
      }
    } catch {
      // Sync failed
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (code: string) => {
    try {
      await api.deleteGuildTemplate(guildId, code);
      setTemplates(prev => prev.filter(t => t.code !== code));
    } catch {
      // Delete failed
    }
  };

  return (
    <div className={styles.section}>
      <h2>Server Template</h2>
      <p className={styles.sectionDescription}>
        Server templates allow you to share your server&#39;s structure with others.
        Templates copy channels, roles, and permissions but not messages or members.
      </p>

      {loading ? (
        <div className={styles.loadingText}>Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className={styles.templateCreateForm}>
          <h3>Create Template</h3>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>TEMPLATE NAME</label>
            <input
              className={styles.formInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="My Server Template"
              maxLength={100}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>DESCRIPTION</label>
            <textarea
              className={styles.formTextarea}
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="A short description of your template"
              maxLength={120}
              rows={3}
            />
          </div>
          <button
            className={styles.primaryBtn}
            onClick={() => void handleCreate()}
            disabled={!newName.trim() || creating}
            type="button"
          >
            {creating ? 'Creating...' : 'Create Template'}
          </button>
        </div>
      ) : (
        <div className={styles.templateList}>
          {templates.map(tmpl => (
            <div key={tmpl.code} className={styles.templateItem}>
              <div className={styles.templateInfo}>
                <span className={styles.templateName}>{tmpl.name}</span>
                {tmpl.description && (
                  <span className={styles.templateDesc}>{tmpl.description}</span>
                )}
                <span className={styles.templateUrl}>
                  relay.new/{tmpl.code}
                </span>
                <span className={styles.fieldHint}>
                  Used {tmpl.usage_count} time{tmpl.usage_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className={styles.buttonRow}>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => {
                    void navigator.clipboard.writeText(`https://relay.new/${tmpl.code}`);
                  }}
                  type="button"
                >
                  Copy URL
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={() => void handleSync(tmpl.code)}
                  disabled={syncing}
                  type="button"
                >
                  {syncing ? 'Syncing...' : 'Sync Template'}
                </button>
                <button
                  className={styles.dangerBtn}
                  onClick={() => void handleDelete(tmpl.code)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VANITY URL SECTION ───
interface VanityURLSectionProps {
  guildId: string;
  premiumTier: number;
}

function VanityURLSection({ guildId }: VanityURLSectionProps) {
  const [vanityCode, setVanityCode] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uses, setUses] = useState(0);

  useEffect(() => {
    setLoading(true);
    const fetchVanity = async () => {
      try {
        const data = await api.getGuildVanityUrl(guildId);
        const vanityData = data as unknown as { code: string | null; uses: number };
        setVanityCode(vanityData.code ?? '');
        setCurrentCode(vanityData.code ?? '');
        setUses(vanityData.uses);
      } catch {
        // Not set
      } finally {
        setLoading(false);
      }
    };
    void fetchVanity();
  }, [guildId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateGuildVanityUrl(guildId, vanityCode.trim());
      setCurrentCode(vanityCode.trim());
    } catch {
      // Failed
    } finally {
      setSaving(false);
    }
  };

  // Vanity URLs are available to any server.
  const isLocked = false;

  return (
    <div className={styles.section}>
      <h2>Vanity URL</h2>
      <p className={styles.sectionDescription}>
        Set a custom invite link for your server. Custom URLs are easier to share and remember.
      </p>

      {loading ? (
        <div className={styles.loadingText}>Loading vanity URL...</div>
      ) : (
        <>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>CUSTOM URL</label>
            <div className={styles.vanityInputRow}>
              <span className={styles.vanityPrefix}>relay.gg/</span>
              <input
                className={styles.formInput}
                value={vanityCode}
                onChange={e => setVanityCode(e.target.value)}
                placeholder="your-custom-url"
                disabled={isLocked}
                maxLength={25}
              />
            </div>
            {currentCode && (
              <div className={styles.fieldHint}>
                Current URL: relay.gg/{currentCode} ({uses} use{uses !== 1 ? 's' : ''})
              </div>
            )}
          </div>

          <button
            className={styles.primaryBtn}
            onClick={() => void handleSave()}
            disabled={isLocked || saving || !vanityCode.trim() || vanityCode.trim() === currentCode}
            type="button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── SAFETY SETUP SECTION ───
interface SafetySetupSectionProps {
  guildId: string;
  dispatch: ReturnType<typeof useAppDispatch>;
  verificationLevel: number;
  explicitContentFilter: number;
}

function SafetySetupSection({
  guildId,
  dispatch,
  verificationLevel: initialVerificationLevel,
  explicitContentFilter: initialExplicitContentFilter,
}: SafetySetupSectionProps) {
  const [verificationLevel, setVerificationLevel] = useState(initialVerificationLevel);
  const [contentFilter, setContentFilter] = useState(initialExplicitContentFilter);

  const handleVerificationLevelChange = async (value: number) => {
    const previous = verificationLevel;
    setVerificationLevel(value);
    try {
      await api.updateGuild(guildId, { verification_level: value });
      dispatch(updateGuild({
        id: guildId,
        changes: { verification_level: value } as Partial<Guild>,
      }));
    } catch {
      setVerificationLevel(previous);
    }
  };

  const handleContentFilterChange = async (value: number) => {
    const previous = contentFilter;
    setContentFilter(value);
    try {
      await api.updateGuild(guildId, { explicit_content_filter: value });
      dispatch(updateGuild({
        id: guildId,
        changes: { explicit_content_filter: value } as Partial<Guild>,
      }));
    } catch {
      setContentFilter(previous);
    }
  };

  return (
    <div className={styles.section}>
      <h2>Safety Setup</h2>
      <p className={styles.sectionDescription}>
        Configure safety features to protect your server and its members.
      </p>

      <div className={styles.formGroup}>
        <label className={styles.formLabel} htmlFor="verification-level-select">
          VERIFICATION LEVEL
        </label>
        <select
          id="verification-level-select"
          className={styles.selectInput}
          value={verificationLevel}
          onChange={e => void handleVerificationLevelChange(Number(e.target.value))}
          aria-label="Select verification level"
        >
          <option value={0}>None - Unrestricted</option>
          <option value={1}>Low - Must have a verified email</option>
          <option value={2}>Medium - Must be registered on Relay for 5+ minutes</option>
          <option value={3}>High - Must be a member of this server for 10+ minutes</option>
          <option value={4}>Highest - Must have a verified phone number</option>
        </select>
        <div className={styles.fieldHint}>
          Members must meet this requirement before they can send messages or interact.
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel} htmlFor="content-filter-select">
          EXPLICIT MEDIA CONTENT FILTER
        </label>
        <select
          id="content-filter-select"
          className={styles.selectInput}
          value={contentFilter}
          onChange={e => void handleContentFilterChange(Number(e.target.value))}
          aria-label="Select content filter level"
        >
          <option value={0}>Don&#39;t scan any media content</option>
          <option value={1}>Scan media content from members without a role</option>
          <option value={2}>Scan media content from all members</option>
        </select>
        <div className={styles.fieldHint}>
          Automatically detect and hide media containing explicit content.
        </div>
      </div>
    </div>
  );
}

// ─── ONBOARDING SECTION ───
interface OnboardingSectionProps {
  guildId: string;
  channels: Array<{ id: string; name?: string | null; type: number }>;
}

interface OnboardingPrompt {
  title: string;
  options: Array<{ title: string; description: string | null; channel_ids: string[] }>;
}

function OnboardingSection({ guildId, channels }: OnboardingSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [defaultChannelIds, setDefaultChannelIds] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<OnboardingPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const textChannels = useMemo(
    () => channels.filter(c => c.type === 0),
    [channels],
  );

  useEffect(() => {
    setLoading(true);
    const fetchOnboarding = async () => {
      try {
        const data = await api.getGuildOnboarding(guildId);
        const ob = data as unknown as {
          enabled: boolean;
          default_channel_ids: string[];
          prompts: OnboardingPrompt[];
        };
        setEnabled(ob.enabled);
        setDefaultChannelIds(ob.default_channel_ids ?? []);
        setPrompts(ob.prompts ?? []);
      } catch {
        // Not configured
      } finally {
        setLoading(false);
      }
    };
    void fetchOnboarding();
  }, [guildId]);

  const handleToggleChannel = (channelId: string) => {
    setDefaultChannelIds(prev =>
      prev.includes(channelId)
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId],
    );
  };

  const handleAddPrompt = () => {
    setPrompts(prev => [
      ...prev,
      { title: '', options: [{ title: '', description: null, channel_ids: [] }] },
    ]);
  };

  const handleUpdatePromptTitle = (index: number, title: string) => {
    setPrompts(prev => prev.map((p, i) => (i === index ? { ...p, title } : p)));
  };

  const handleAddOption = (promptIndex: number) => {
    setPrompts(prev =>
      prev.map((p, i) =>
        i === promptIndex
          ? { ...p, options: [...p.options, { title: '', description: null, channel_ids: [] }] }
          : p,
      ),
    );
  };

  const handleUpdateOptionTitle = (promptIndex: number, optionIndex: number, title: string) => {
    setPrompts(prev =>
      prev.map((p, pi) =>
        pi === promptIndex
          ? {
              ...p,
              options: p.options.map((o, oi) =>
                oi === optionIndex ? { ...o, title } : o,
              ),
            }
          : p,
      ),
    );
  };

  const handleRemovePrompt = (index: number) => {
    setPrompts(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateGuildOnboarding(guildId, {
        enabled,
        default_channel_ids: defaultChannelIds,
        prompts,
      });
    } catch {
      // Failed
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <h2>Onboarding</h2>
        <div className={styles.loadingText}>Loading onboarding settings...</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2>Onboarding</h2>
      <p className={styles.sectionDescription}>
        New members will see this when they join. Help them get started by selecting default channels
        and creating welcome prompts.
      </p>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Enable Onboarding</div>
          <div className={styles.settingDescription}>
            Show new members a guided onboarding experience when they join.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`}
          onClick={() => setEnabled(!enabled)}
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle onboarding"
          type="button"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      {enabled && (
        <>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>DEFAULT CHANNELS</label>
            <div className={styles.fieldHint}>
              Select channels that new members will see by default.
            </div>
            <div className={styles.channelCheckboxList}>
              {textChannels.map(ch => (
                <label key={ch.id} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={defaultChannelIds.includes(ch.id)}
                    onChange={() => handleToggleChannel(ch.id)}
                    className={styles.checkbox}
                  />
                  <span>#{ch.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.separator} />

          <div className={styles.formGroup}>
            <div className={styles.sectionHeader}>
              <h3>Welcome Prompts</h3>
              <button
                className={styles.primaryBtn}
                onClick={handleAddPrompt}
                type="button"
              >
                Add Prompt
              </button>
            </div>
            <div className={styles.fieldHint}>
              Create questions that help new members personalize their experience.
            </div>
          </div>

          {prompts.map((prompt, pi) => (
            <div key={pi} className={styles.promptCard}>
              <div className={styles.promptHeader}>
                <input
                  className={styles.formInput}
                  value={prompt.title}
                  onChange={e => handleUpdatePromptTitle(pi, e.target.value)}
                  placeholder="What brings you here?"
                  maxLength={100}
                />
                <button
                  className={styles.iconBtn}
                  onClick={() => handleRemovePrompt(pi)}
                  type="button"
                  aria-label="Remove prompt"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                  </svg>
                </button>
              </div>
              <div className={styles.promptOptions}>
                {prompt.options.map((opt, oi) => (
                  <div key={oi} className={styles.promptOption}>
                    <input
                      className={styles.formInput}
                      value={opt.title}
                      onChange={e => handleUpdateOptionTitle(pi, oi, e.target.value)}
                      placeholder="Option text"
                      maxLength={50}
                    />
                  </div>
                ))}
                <button
                  className={styles.secondaryBtn}
                  onClick={() => handleAddOption(pi)}
                  type="button"
                >
                  Add Option
                </button>
              </div>
            </div>
          ))}

          <div className={styles.buttonRow}>
            <button
              className={styles.primaryBtn}
              onClick={() => void handleSave()}
              disabled={saving}
              type="button"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── WELCOME SCREEN SECTION ───
interface WelcomeScreenSectionProps {
  guildId: string;
  channels: Array<{ id: string; name?: string | null; type: number }>;
}

interface WelcomeChannel {
  channel_id: string;
  description: string;
  emoji_name: string | null;
}

function WelcomeScreenSection({ guildId, channels }: WelcomeScreenSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [description, setDescription] = useState('');
  const [welcomeChannels, setWelcomeChannels] = useState<WelcomeChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const textChannels = useMemo(
    () => channels.filter(c => c.type === 0 || c.type === 5),
    [channels],
  );

  useEffect(() => {
    setLoading(true);
    const fetchWelcomeScreen = async () => {
      try {
        const data = await api.getGuildWelcomeScreen(guildId);
        const ws = data as unknown as {
          enabled: boolean;
          description: string | null;
          welcome_channels: WelcomeChannel[];
        };
        setEnabled(ws.enabled ?? false);
        setDescription(ws.description ?? '');
        setWelcomeChannels(ws.welcome_channels ?? []);
      } catch {
        // Not configured
      } finally {
        setLoading(false);
      }
    };
    void fetchWelcomeScreen();
  }, [guildId]);

  const handleAddChannel = () => {
    setWelcomeChannels(prev => [
      ...prev,
      { channel_id: '', description: '', emoji_name: null },
    ]);
  };

  const handleUpdateWelcomeChannel = (index: number, field: keyof WelcomeChannel, value: string) => {
    setWelcomeChannels(prev =>
      prev.map((wc, i) =>
        i === index
          ? { ...wc, [field]: field === 'emoji_name' ? (value || null) : value }
          : wc,
      ),
    );
  };

  const handleRemoveWelcomeChannel = (index: number) => {
    setWelcomeChannels(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateGuildWelcomeScreen(guildId, {
        enabled,
        description: description || null,
        welcome_channels: welcomeChannels,
      });
    } catch {
      // Failed
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.section}>
        <h2>Welcome Screen</h2>
        <div className={styles.loadingText}>Loading welcome screen settings...</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2>Welcome Screen</h2>
      <p className={styles.sectionDescription}>
        Set up a welcome screen to greet new members when they join your server.
        Show them useful channels to get started.
      </p>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Enable Welcome Screen</div>
          <div className={styles.settingDescription}>
            Display a welcome screen when new members join the server.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`}
          onClick={() => setEnabled(!enabled)}
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle welcome screen"
          type="button"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      {enabled && (
        <>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>SERVER DESCRIPTION</label>
            <textarea
              className={styles.formTextarea}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Welcome to our server! Here you can find..."
              maxLength={140}
              rows={3}
            />
            <div className={styles.fieldHint}>
              This description will be shown on the welcome screen.
            </div>
          </div>

          <div className={styles.separator} />

          <div className={styles.sectionHeader}>
            <h3>Welcome Channels</h3>
            <button
              className={styles.primaryBtn}
              onClick={handleAddChannel}
              disabled={welcomeChannels.length >= 5}
              type="button"
            >
              Add Welcome Channel
            </button>
          </div>

          {welcomeChannels.length === 0 && (
            <div className={styles.emptyState}>
              <p>No welcome channels configured. Add a channel to help new members get started.</p>
            </div>
          )}

          {welcomeChannels.map((wc, index) => (
            <div key={index} className={styles.welcomeChannelCard}>
              <div className={styles.welcomeChannelRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>EMOJI</label>
                  <input
                    className={styles.formInput}
                    value={wc.emoji_name ?? ''}
                    onChange={e => handleUpdateWelcomeChannel(index, 'emoji_name', e.target.value)}
                    placeholder="wave"
                    maxLength={32}
                  />
                </div>
                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label className={styles.formLabel}>CHANNEL</label>
                  <select
                    className={styles.selectInput}
                    value={wc.channel_id}
                    onChange={e => handleUpdateWelcomeChannel(index, 'channel_id', e.target.value)}
                    aria-label="Select welcome channel"
                  >
                    <option value="">Select a channel</option>
                    {textChannels.map(ch => (
                      <option key={ch.id} value={ch.id}>#{ch.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  className={styles.iconBtn}
                  onClick={() => handleRemoveWelcomeChannel(index)}
                  type="button"
                  aria-label="Remove welcome channel"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                  </svg>
                </button>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>DESCRIPTION</label>
                <input
                  className={styles.formInput}
                  value={wc.description}
                  onChange={e => handleUpdateWelcomeChannel(index, 'description', e.target.value)}
                  placeholder="Read the rules before chatting"
                  maxLength={50}
                />
              </div>
            </div>
          ))}

          <div className={styles.buttonRow}>
            <button
              className={styles.primaryBtn}
              onClick={() => void handleSave()}
              disabled={saving}
              type="button"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
