import { describe, it, expect } from 'vitest';
import { Permission, ALL_PERMISSIONS } from '../constants/permissions';
import {
  computeBasePermissions,
  computeChannelPermissions,
  hasPermission,
  canManageRole,
  applyImplicitDenials,
  applyTimeoutPermissions,
  Role,
  PermissionOverwrite,
} from './permissions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GUILD_ID = '100'; // also the @everyone role ID (by convention)
const OWNER_ID = '200';
const USER_ID = '300';

const makeRole = (id: string, permissions: bigint, position: number): Role => ({
  id,
  permissions,
  position,
});

const makeOverwrite = (
  id: string,
  type: 0 | 1,
  allow: bigint,
  deny: bigint,
): PermissionOverwrite => ({ id, type, allow, deny });

// ---------------------------------------------------------------------------
// computeBasePermissions
// ---------------------------------------------------------------------------

describe('computeBasePermissions', () => {
  it('grants ALL_PERMISSIONS to the guild owner', () => {
    const everyone = makeRole(GUILD_ID, 0n, 0);
    const result = computeBasePermissions(OWNER_ID, OWNER_ID, everyone, []);
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it('starts with @everyone permissions when member has no extra roles', () => {
    const everyone = makeRole(GUILD_ID, Permission.ViewChannel | Permission.SendMessages, 0);
    const result = computeBasePermissions(OWNER_ID, USER_ID, everyone, []);
    expect(result).toBe(Permission.ViewChannel | Permission.SendMessages);
  });

  it('ORs permissions from all member roles', () => {
    const everyone = makeRole(GUILD_ID, Permission.ViewChannel, 0);
    const modRole = makeRole('role-mod', Permission.KickMembers | Permission.BanMembers, 1);
    const chatRole = makeRole('role-chat', Permission.SendMessages | Permission.EmbedLinks, 2);

    const result = computeBasePermissions(OWNER_ID, USER_ID, everyone, [modRole, chatRole]);

    expect(hasPermission(result, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(result, Permission.KickMembers)).toBe(true);
    expect(hasPermission(result, Permission.BanMembers)).toBe(true);
    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
    expect(hasPermission(result, Permission.EmbedLinks)).toBe(true);
  });

  it('returns ALL_PERMISSIONS when any role has Administrator', () => {
    const everyone = makeRole(GUILD_ID, Permission.ViewChannel, 0);
    const adminRole = makeRole('role-admin', Permission.Administrator, 5);

    const result = computeBasePermissions(OWNER_ID, USER_ID, everyone, [adminRole]);
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it('returns ALL_PERMISSIONS when @everyone has Administrator', () => {
    const everyone = makeRole(GUILD_ID, Permission.Administrator, 0);
    const result = computeBasePermissions(OWNER_ID, USER_ID, everyone, []);
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it('handles empty member roles array', () => {
    const everyone = makeRole(GUILD_ID, Permission.ViewChannel, 0);
    const result = computeBasePermissions(OWNER_ID, USER_ID, everyone, []);
    expect(result).toBe(Permission.ViewChannel);
  });
});

// ---------------------------------------------------------------------------
// computeChannelPermissions
// ---------------------------------------------------------------------------

describe('computeChannelPermissions', () => {
  it('returns ALL_PERMISSIONS for Administrator base permissions', () => {
    const result = computeChannelPermissions(
      ALL_PERMISSIONS,
      USER_ID,
      [makeOverwrite(GUILD_ID, 0, 0n, Permission.SendMessages)],
      [],
      GUILD_ID,
    );
    expect(result).toBe(ALL_PERMISSIONS);
  });

  it('applies @everyone deny overwrite', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const overwrites = [makeOverwrite(GUILD_ID, 0, 0n, Permission.SendMessages)];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [], GUILD_ID);

    expect(hasPermission(result, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(result, Permission.SendMessages)).toBe(false);
  });

  it('applies @everyone allow overwrite', () => {
    const base = Permission.ViewChannel;
    const overwrites = [makeOverwrite(GUILD_ID, 0, Permission.SendMessages, 0n)];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [], GUILD_ID);

    expect(hasPermission(result, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
  });

  it('role overwrites override @everyone deny', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const roleId = 'role-mod';
    const overwrites = [
      makeOverwrite(GUILD_ID, 0, 0n, Permission.SendMessages),  // @everyone deny
      makeOverwrite(roleId, 0, Permission.SendMessages, 0n),     // role allow
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [roleId], GUILD_ID);

    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
  });

  it('aggregates multiple role overwrites', () => {
    const base = Permission.ViewChannel | Permission.SendMessages | Permission.EmbedLinks;
    const roleA = 'role-a';
    const roleB = 'role-b';
    const overwrites = [
      makeOverwrite(GUILD_ID, 0, 0n, Permission.SendMessages | Permission.EmbedLinks),
      makeOverwrite(roleA, 0, Permission.SendMessages, 0n),
      makeOverwrite(roleB, 0, Permission.EmbedLinks, 0n),
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [roleA, roleB], GUILD_ID);

    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
    expect(hasPermission(result, Permission.EmbedLinks)).toBe(true);
  });

  it('member overwrite overrides role deny', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const roleId = 'role-mod';
    const overwrites = [
      makeOverwrite(roleId, 0, 0n, Permission.SendMessages),          // role deny
      makeOverwrite(USER_ID, 1, Permission.SendMessages, 0n),         // member allow
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [roleId], GUILD_ID);

    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
  });

  it('member deny overrides role allow', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const roleId = 'role-mod';
    const overwrites = [
      makeOverwrite(roleId, 0, Permission.SendMessages, 0n),          // role allow
      makeOverwrite(USER_ID, 1, 0n, Permission.SendMessages),         // member deny
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [roleId], GUILD_ID);

    expect(hasPermission(result, Permission.SendMessages)).toBe(false);
  });

  it('passes through base permissions when no overwrites exist', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const result = computeChannelPermissions(base, USER_ID, [], [], GUILD_ID);
    expect(result).toBe(base);
  });

  it('ignores overwrites for roles the member does not have', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const overwrites = [
      makeOverwrite('role-other', 0, 0n, Permission.SendMessages),
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [], GUILD_ID);

    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
  });

  it('ignores member overwrites for other users', () => {
    const base = Permission.ViewChannel | Permission.SendMessages;
    const overwrites = [
      makeOverwrite('other-user', 1, 0n, Permission.SendMessages),
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [], GUILD_ID);

    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
  });

  it('handles the full hierarchy: @everyone deny -> role allow -> member deny', () => {
    const base = Permission.ViewChannel | Permission.SendMessages | Permission.EmbedLinks;
    const roleId = 'role-mod';
    const overwrites = [
      makeOverwrite(GUILD_ID, 0, 0n, Permission.SendMessages | Permission.EmbedLinks),
      makeOverwrite(roleId, 0, Permission.SendMessages | Permission.EmbedLinks, 0n),
      makeOverwrite(USER_ID, 1, 0n, Permission.EmbedLinks),
    ];

    const result = computeChannelPermissions(base, USER_ID, overwrites, [roleId], GUILD_ID);

    expect(hasPermission(result, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(result, Permission.SendMessages)).toBe(true);
    expect(hasPermission(result, Permission.EmbedLinks)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasPermission
// ---------------------------------------------------------------------------

describe('hasPermission', () => {
  it('returns true when the permission bit is set', () => {
    const perms = Permission.ViewChannel | Permission.SendMessages;
    expect(hasPermission(perms, Permission.ViewChannel)).toBe(true);
    expect(hasPermission(perms, Permission.SendMessages)).toBe(true);
  });

  it('returns false when the permission bit is not set', () => {
    const perms = Permission.ViewChannel;
    expect(hasPermission(perms, Permission.SendMessages)).toBe(false);
  });

  it('returns true for any permission when Administrator is set', () => {
    const perms = Permission.Administrator;
    expect(hasPermission(perms, Permission.KickMembers)).toBe(true);
    expect(hasPermission(perms, Permission.ManageGuild)).toBe(true);
    expect(hasPermission(perms, Permission.BanMembers)).toBe(true);
  });

  it('checks compound permission flags', () => {
    const perms = Permission.ViewChannel | Permission.SendMessages;
    const compound = Permission.ViewChannel | Permission.SendMessages;
    expect(hasPermission(perms, compound)).toBe(true);
  });

  it('returns false for zero permissions', () => {
    expect(hasPermission(0n, Permission.ViewChannel)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canManageRole
// ---------------------------------------------------------------------------

describe('canManageRole', () => {
  it('returns true when actor position is higher than target', () => {
    expect(canManageRole(5, 3)).toBe(true);
  });

  it('returns false when actor position equals target', () => {
    expect(canManageRole(3, 3)).toBe(false);
  });

  it('returns false when actor position is lower than target', () => {
    expect(canManageRole(2, 5)).toBe(false);
  });

  it('handles position 0 (lowest)', () => {
    expect(canManageRole(1, 0)).toBe(true);
    expect(canManageRole(0, 0)).toBe(false);
  });

  it('uses ID tiebreaker when positions are equal', () => {
    // Lower ID = created earlier = higher authority
    expect(canManageRole(3, 3, '100', '200')).toBe(true);
    expect(canManageRole(3, 3, '200', '100')).toBe(false);
    expect(canManageRole(3, 3, '100', '100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyImplicitDenials
// ---------------------------------------------------------------------------

describe('applyImplicitDenials', () => {
  it('denies all channel perms when VIEW_CHANNEL is not set', () => {
    const perms = Permission.SendMessages | Permission.AttachFiles;
    const result = applyImplicitDenials(perms);
    expect(result & Permission.SendMessages).toBe(0n);
    expect(result & Permission.AttachFiles).toBe(0n);
  });

  it('allows perms when VIEW_CHANNEL is set', () => {
    const perms = Permission.ViewChannel | Permission.SendMessages | Permission.AttachFiles;
    const result = applyImplicitDenials(perms);
    expect(result & Permission.SendMessages).toBe(Permission.SendMessages);
    expect(result & Permission.AttachFiles).toBe(Permission.AttachFiles);
  });

  it('denies mention/tts/files/embeds when SEND_MESSAGES is not set', () => {
    const perms = Permission.ViewChannel | Permission.MentionEveryone | Permission.SendTTSMessages | Permission.AttachFiles | Permission.EmbedLinks;
    const result = applyImplicitDenials(perms);
    expect(result & Permission.MentionEveryone).toBe(0n);
    expect(result & Permission.SendTTSMessages).toBe(0n);
    expect(result & Permission.AttachFiles).toBe(0n);
    expect(result & Permission.EmbedLinks).toBe(0n);
  });

  it('denies voice perms when CONNECT is not set', () => {
    const perms = Permission.ViewChannel | Permission.Speak | Permission.MuteMembers | Permission.UseVAD;
    const result = applyImplicitDenials(perms);
    expect(result & Permission.Speak).toBe(0n);
    expect(result & Permission.MuteMembers).toBe(0n);
    expect(result & Permission.UseVAD).toBe(0n);
  });

  it('allows voice perms when CONNECT is set', () => {
    const perms = Permission.ViewChannel | Permission.Connect | Permission.Speak | Permission.UseVAD;
    const result = applyImplicitDenials(perms);
    expect(result & Permission.Speak).toBe(Permission.Speak);
    expect(result & Permission.UseVAD).toBe(Permission.UseVAD);
  });
});

// ---------------------------------------------------------------------------
// applyTimeoutPermissions
// ---------------------------------------------------------------------------

describe('applyTimeoutPermissions', () => {
  it('strips all perms except VIEW_CHANNEL and READ_MESSAGE_HISTORY for timed-out user', () => {
    const perms = Permission.ViewChannel | Permission.SendMessages | Permission.ReadMessageHistory | Permission.ManageMessages;
    const result = applyTimeoutPermissions(perms, true, false);
    expect(result & Permission.ViewChannel).toBe(Permission.ViewChannel);
    expect(result & Permission.ReadMessageHistory).toBe(Permission.ReadMessageHistory);
    expect(result & Permission.SendMessages).toBe(0n);
    expect(result & Permission.ManageMessages).toBe(0n);
  });

  it('does not strip perms for non-timed-out user', () => {
    const perms = Permission.ViewChannel | Permission.SendMessages;
    const result = applyTimeoutPermissions(perms, false, false);
    expect(result).toBe(perms);
  });

  it('does not strip perms for guild owner even if timed out', () => {
    const perms = Permission.ViewChannel | Permission.SendMessages;
    const result = applyTimeoutPermissions(perms, true, true);
    expect(result).toBe(perms);
  });

  it('does not strip perms for ADMINISTRATOR even if timed out', () => {
    const perms = Permission.Administrator | Permission.ViewChannel | Permission.SendMessages;
    const result = applyTimeoutPermissions(perms, true, false);
    expect(result).toBe(perms);
  });
});
