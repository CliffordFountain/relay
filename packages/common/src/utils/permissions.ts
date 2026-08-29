import { Permission, ALL_PERMISSIONS } from '../constants/permissions';

export interface Role {
  id: string;
  permissions: bigint;
  position: number;
}

export interface PermissionOverwrite {
  id: string;        // Role or user ID
  type: number;      // 0 = role, 1 = member
  allow: bigint;
  deny: bigint;
}

/**
 * Compute base guild permissions for a member.
 *
 * Algorithm (matching the behavior exactly):
 * 1. If user is guild owner -> return ALL_PERMISSIONS
 * 2. Start with @everyone role permissions
 * 3. OR all permissions from the member's other roles
 * 4. If ADMINISTRATOR bit is set -> return ALL_PERMISSIONS
 */
export const computeBasePermissions = (
  ownerId: string,
  userId: string,
  everyoneRole: Role,
  memberRoles: Role[],
): bigint => {
  if (ownerId === userId) return ALL_PERMISSIONS;

  let permissions = everyoneRole.permissions;
  for (const role of memberRoles) {
    permissions |= role.permissions;
  }

  if ((permissions & Permission.Administrator) === Permission.Administrator) {
    return ALL_PERMISSIONS;
  }

  return permissions;
};

/**
 * Compute permissions for a specific channel, applying overwrites.
 *
 * Algorithm (matching the behavior exactly):
 * 1. Start with base guild permissions
 * 2. If ADMINISTRATOR -> return ALL_PERMISSIONS (admin bypasses overwrites)
 * 3. Apply @everyone role overwrite for this channel (deny then allow)
 * 4. Apply role-specific overwrites: aggregate all allow/deny across member's roles
 * 5. Apply member-specific overwrite (deny then allow) -- highest priority
 */
export const computeChannelPermissions = (
  basePermissions: bigint,
  userId: string,
  channelOverwrites: PermissionOverwrite[],
  memberRoleIds: string[],
  everyoneRoleId: string,
): bigint => {
  if ((basePermissions & Permission.Administrator) === Permission.Administrator) {
    return ALL_PERMISSIONS;
  }

  let permissions = basePermissions;

  // 1. Apply @everyone overwrite
  const everyoneOverwrite = channelOverwrites.find(
    o => o.type === 0 && o.id === everyoneRoleId,
  );
  if (everyoneOverwrite) {
    permissions &= ~everyoneOverwrite.deny;
    permissions |= everyoneOverwrite.allow;
  }

  // 2. Aggregate role overwrites
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of channelOverwrites) {
    if (
      overwrite.type === 0 &&
      overwrite.id !== everyoneRoleId &&
      memberRoleIds.includes(overwrite.id)
    ) {
      roleAllow |= overwrite.allow;
      roleDeny |= overwrite.deny;
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  // 3. Apply member-specific overwrite
  const memberOverwrite = channelOverwrites.find(
    o => o.type === 1 && o.id === userId,
  );
  if (memberOverwrite) {
    permissions &= ~memberOverwrite.deny;
    permissions |= memberOverwrite.allow;
  }

  return permissions;
};

/**
 * Apply implicit permission denials (matching the behavior):
 * 1. If VIEW_CHANNEL is denied -> all other channel permissions are implicitly denied
 * 2. If SEND_MESSAGES is denied -> MENTION_EVERYONE, SEND_TTS_MESSAGES, ATTACH_FILES, EMBED_LINKS are denied
 * 3. If CONNECT is denied in voice -> SPEAK, MUTE_MEMBERS, DEAFEN_MEMBERS, MOVE_MEMBERS, USE_VAD, PRIORITY_SPEAKER, STREAM are denied
 */
export const applyImplicitDenials = (permissions: bigint): bigint => {
  let p = permissions;

  // No VIEW_CHANNEL -> deny everything except VIEW_CHANNEL and READ_MESSAGE_HISTORY
  if ((p & Permission.ViewChannel) === 0n) {
    // Keep only ViewChannel bit state (which is 0) - effectively deny all channel-specific perms
    p &= ~(
      Permission.SendMessages |
      Permission.SendTTSMessages |
      Permission.ManageMessages |
      Permission.EmbedLinks |
      Permission.AttachFiles |
      Permission.ReadMessageHistory |
      Permission.MentionEveryone |
      Permission.AddReactions |
      Permission.Connect |
      Permission.Speak
    );
  }

  // No SEND_MESSAGES -> deny dependent permissions
  if ((p & Permission.SendMessages) === 0n) {
    p &= ~(
      Permission.MentionEveryone |
      Permission.SendTTSMessages |
      Permission.AttachFiles |
      Permission.EmbedLinks
    );
  }

  // No CONNECT in voice -> deny dependent voice permissions
  if ((p & Permission.Connect) === 0n) {
    p &= ~(
      Permission.Speak |
      Permission.MuteMembers |
      Permission.DeafenMembers |
      Permission.MoveMembers |
      Permission.UseVAD |
      Permission.PrioritySpeaker |
      Permission.Stream
    );
  }

  return p;
};

/**
 * Check if a permission set includes a specific permission.
 */
export const hasPermission = (permissions: bigint, permission: bigint): boolean => {
  if ((permissions & Permission.Administrator) === Permission.Administrator) return true;
  return (permissions & permission) === permission;
};

/**
 * Check if a role can be managed by another role (higher position = more power).
 * When positions are equal, the role with the lower ID takes priority (the tiebreaker).
 */
export const canManageRole = (
  actorHighestPosition: number,
  targetRolePosition: number,
  actorRoleId?: string,
  targetRoleId?: string,
): boolean => {
  if (actorHighestPosition !== targetRolePosition) {
    return actorHighestPosition > targetRolePosition;
  }
  // Tiebreaker: lower ID wins (earlier-created role has higher authority)
  if (actorRoleId && targetRoleId) {
    return BigInt(actorRoleId) < BigInt(targetRoleId);
  }
  return false;
};

/**
 * Apply timeout permission stripping.
 * Timed-out members can only VIEW_CHANNEL and READ_MESSAGE_HISTORY.
 * Guild owners and users with ADMINISTRATOR are exempt.
 */
export const applyTimeoutPermissions = (
  permissions: bigint,
  isTimedOut: boolean,
  isOwner: boolean,
): bigint => {
  if (!isTimedOut || isOwner) return permissions;
  if ((permissions & Permission.Administrator) === Permission.Administrator) return permissions;
  return permissions & (Permission.ViewChannel | Permission.ReadMessageHistory);
};
