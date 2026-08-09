import { useMemo } from 'react';
import { useAppSelector } from './useAppDispatch';
import type { PermissionOverwrite } from '@/stores/channelsSlice';

/**
 * Permission bit flags using BigInt to support all 64-bit permission values.
 * Matches packages/common/src/constants/permissions.ts.
 */
export const PermissionBits = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,
  CREATE_EVENTS: 1n << 44n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SEND_POLLS: 1n << 49n,
  USE_EXTERNAL_APPS: 1n << 50n,
} as const;

/** All permission bits OR'd together. */
const ALL_PERMISSIONS: bigint = Object.values(PermissionBits).reduce(
  (acc: bigint, v: bigint) => acc | v,
  0n,
);

/** Stable empty array used as a fallback to avoid creating new references on every render. */
const EMPTY_ARRAY: never[] = [];

export interface GuildPermissions {
  /** The computed permission bigint */
  permissions: bigint;
  /** Whether the current user is the guild owner */
  isOwner: boolean;
  /** Check if the user has a specific permission */
  has: (permission: bigint) => boolean;
  /** Convenience booleans for common checks */
  canManageGuild: boolean;
  canManageChannels: boolean;
  canManageRoles: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  canManageMessages: boolean;
  canManageNicknames: boolean;
  canViewAuditLog: boolean;
  canModerateMembers: boolean;
  canManageThreads: boolean;
  canSendPolls: boolean;
  isAdmin: boolean;
}

/**
 * Parse a permission string (from the API) into a BigInt.
 * Handles both decimal string representations and numeric values.
 */
function parsePermissions(permString: string): bigint {
  try {
    return BigInt(permString);
  } catch {
    return 0n;
  }
}

/**
 * Hook that computes the current user's permissions for a guild.
 *
 * Algorithm matches the behavior exactly:
 * 1. If user is guild owner -> all permissions
 * 2. Start with @everyone role permissions
 * 3. OR all permissions from the member's other roles
 * 4. If ADMINISTRATOR bit is set -> all permissions
 */
export const usePermissions = (guildId: string | null): GuildPermissions => {
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const guild = useAppSelector(s => guildId ? s.guilds.guilds[guildId] : null);
  const roles = useAppSelector(s => guildId ? (s.roles.rolesByGuild[guildId] ?? EMPTY_ARRAY) : EMPTY_ARRAY);
  const members = useAppSelector(s => guildId ? (s.members.membersByGuild[guildId] ?? EMPTY_ARRAY) : EMPTY_ARRAY);

  return useMemo(() => {
    const isOwner = guild?.owner_id === currentUserId && currentUserId !== undefined;

    const noPerms: GuildPermissions = {
      permissions: 0n,
      isOwner: false,
      has: () => false,
      canManageGuild: false,
      canManageChannels: false,
      canManageRoles: false,
      canKickMembers: false,
      canBanMembers: false,
      canManageMessages: false,
      canManageNicknames: false,
      canViewAuditLog: false,
      canModerateMembers: false,
      canManageThreads: false,
      canSendPolls: false,
      isAdmin: false,
    };

    if (!guildId || !currentUserId || !guild) {
      return noPerms;
    }

    const allPerms: GuildPermissions = {
      permissions: ALL_PERMISSIONS,
      isOwner,
      has: () => true,
      canManageGuild: true,
      canManageChannels: true,
      canManageRoles: true,
      canKickMembers: true,
      canBanMembers: true,
      canManageMessages: true,
      canManageNicknames: true,
      canViewAuditLog: true,
      canModerateMembers: true,
      canManageThreads: true,
      canSendPolls: true,
      isAdmin: true,
    };

    // Owner has all permissions
    if (isOwner) {
      return allPerms;
    }

    // Find the current user's member object to get their role IDs
    const currentMember = members.find(m => m.user.id === currentUserId);
    const memberRoleIds = currentMember?.roles ?? [];

    // Start with @everyone role permissions (role id == guild id)
    const everyoneRole = roles.find(r => r.id === guildId);
    let permissions = everyoneRole ? parsePermissions(everyoneRole.permissions) : 0n;

    // OR permissions from all member's roles
    for (const roleId of memberRoleIds) {
      if (roleId === guildId) continue; // skip @everyone, already applied
      const role = roles.find(r => r.id === roleId);
      if (role) {
        permissions |= parsePermissions(role.permissions);
      }
    }

    // If ADMINISTRATOR, return all permissions
    if ((permissions & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) {
      return { ...allPerms, isOwner: false };
    }

    const has = (permission: bigint): boolean => {
      if ((permissions & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) return true;
      return (permissions & permission) === permission;
    };

    return {
      permissions,
      isOwner: false,
      has,
      canManageGuild: has(PermissionBits.MANAGE_GUILD),
      canManageChannels: has(PermissionBits.MANAGE_CHANNELS),
      canManageRoles: has(PermissionBits.MANAGE_ROLES),
      canKickMembers: has(PermissionBits.KICK_MEMBERS),
      canBanMembers: has(PermissionBits.BAN_MEMBERS),
      canManageMessages: has(PermissionBits.MANAGE_MESSAGES),
      canManageNicknames: has(PermissionBits.MANAGE_NICKNAMES),
      canViewAuditLog: has(PermissionBits.VIEW_AUDIT_LOG),
      canModerateMembers: has(PermissionBits.MODERATE_MEMBERS),
      canManageThreads: has(PermissionBits.MANAGE_THREADS),
      canSendPolls: has(PermissionBits.SEND_POLLS),
      isAdmin: false,
    };
  }, [guildId, currentUserId, guild, roles, members]);
};

/** Thread channel types (announcement thread, public thread, private thread). */
const THREAD_TYPES = new Set([10, 11, 12]);

/**
 * Apply channel permission overwrites to base permissions.
 *
 * Algorithm matches the behavior exactly:
 * 1. Apply @everyone role overwrite
 * 2. Collect and apply all member role overwrites (OR them together)
 * 3. Apply member-specific overwrite
 */
function applyOverwrites(
  basePermissions: bigint,
  overwrites: PermissionOverwrite[],
  guildId: string,
  memberRoleIds: string[],
  userId: string,
): bigint {
  // Administrator bypasses all overwrites
  if ((basePermissions & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) {
    return basePermissions;
  }

  let permissions = basePermissions;

  // 1. Apply @everyone overwrite (type 0, id == guildId)
  for (const ow of overwrites) {
    if (ow.type === 0 && ow.id === guildId) {
      permissions &= ~parsePermissions(ow.deny);
      permissions |= parsePermissions(ow.allow);
    }
  }

  // 2. Apply role overwrites
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const ow of overwrites) {
    if (ow.type === 0 && memberRoleIds.includes(ow.id)) {
      roleAllow |= parsePermissions(ow.allow);
      roleDeny |= parsePermissions(ow.deny);
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  // 3. Apply member-specific overwrite
  for (const ow of overwrites) {
    if (ow.type === 1 && ow.id === userId) {
      permissions &= ~parsePermissions(ow.deny);
      permissions |= parsePermissions(ow.allow);
    }
  }

  return permissions;
}

export interface ChannelPermissions {
  /** The computed channel permission bigint */
  permissions: bigint;
  /** Check if the user has a specific permission in this channel */
  has: (permission: bigint) => boolean;
  /** Whether the user can send messages (SEND_MESSAGES for channels, SEND_MESSAGES_IN_THREADS for threads) */
  canSendMessages: boolean;
  /** Whether the user can view this channel */
  canViewChannel: boolean;
  /** Whether the user can manage messages */
  canManageMessages: boolean;
  /** Whether the user can manage threads */
  canManageThreads: boolean;
}

/**
 * Hook that computes the current user's permissions for a specific channel.
 *
 * For threads (types 10, 11, 12), permissions are inherited from the
 * parent channel's permission overwrites, matching the behavior.
 *
 * Algorithm:
 * 1. Compute base guild permissions (via usePermissions logic)
 * 2. Find the relevant channel for overwrites:
 *    - If the channel is a thread, use the parent channel
 *    - Otherwise, use the channel itself
 * 3. Apply permission overwrites from that channel
 */
export const useChannelPermissions = (
  guildId: string | null,
  channelId: string | null,
): ChannelPermissions => {
  const guildPerms = usePermissions(guildId);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const channel = useAppSelector(s => channelId ? s.channels.channels[channelId] : null);
  const members = useAppSelector(s => guildId ? (s.members.membersByGuild[guildId] ?? EMPTY_ARRAY) : EMPTY_ARRAY);

  // For threads, look up the parent channel to get its overwrites
  const parentId = channel && THREAD_TYPES.has(channel.type) ? channel.parent_id : null;
  const parentChannel = useAppSelector(s => parentId ? s.channels.channels[parentId] : null);

  return useMemo(() => {
    const noPerms: ChannelPermissions = {
      permissions: 0n,
      has: () => false,
      canSendMessages: false,
      canViewChannel: false,
      canManageMessages: false,
      canManageThreads: false,
    };

    if (!guildId || !channelId || !currentUserId || !channel) {
      return noPerms;
    }

    // Owner and admin bypass all overwrites
    if (guildPerms.isOwner || guildPerms.isAdmin) {
      return {
        permissions: guildPerms.permissions,
        has: () => true,
        canSendMessages: true,
        canViewChannel: true,
        canManageMessages: true,
        canManageThreads: true,
      };
    }

    // Determine which channel's overwrites to use
    const isThread = THREAD_TYPES.has(channel.type);
    const overwriteSource = isThread ? parentChannel : channel;
    const overwrites = overwriteSource?.permission_overwrites ?? [];

    // Get member's role IDs
    const currentMember = members.find(m => m.user.id === currentUserId);
    const memberRoleIds = currentMember?.roles ?? [];

    const permissions = applyOverwrites(
      guildPerms.permissions,
      overwrites,
      guildId,
      memberRoleIds,
      currentUserId,
    );

    const has = (permission: bigint): boolean => {
      if ((permissions & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) return true;
      return (permissions & permission) === permission;
    };

    // For threads, check SEND_MESSAGES_IN_THREADS; for channels, SEND_MESSAGES
    const sendPerm = isThread
      ? PermissionBits.SEND_MESSAGES_IN_THREADS
      : PermissionBits.SEND_MESSAGES;

    return {
      permissions,
      has,
      canSendMessages: has(sendPerm),
      canViewChannel: has(PermissionBits.VIEW_CHANNEL),
      canManageMessages: has(PermissionBits.MANAGE_MESSAGES),
      canManageThreads: has(PermissionBits.MANAGE_THREADS),
    };
  }, [guildId, channelId, currentUserId, channel, parentChannel, members, guildPerms]);
};
