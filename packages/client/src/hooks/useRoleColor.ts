import { useMemo } from 'react';
import { useAppSelector } from './useAppDispatch';
import { selectRolesByGuild, selectMembersByGuild } from '../stores/selectors';
import type { Role } from '../stores/rolesSlice';

/**
 * Convert a numeric role color (integer) to a CSS hex string.
 * Returns undefined if the color is 0 (default / no color).
 */
const roleColorToHex = (color: number): string | undefined => {
  if (color === 0) return undefined;
  return `#${color.toString(16).padStart(6, '0')}`;
};

/**
 * Given a list of role IDs assigned to a member and the guild's roles,
 * find the highest-positioned role that has a non-default color set.
 * Returns the CSS hex color string or undefined.
 */
const getHighestRoleColor = (
  memberRoleIds: string[],
  guildRoles: Role[],
): string | undefined => {
  if (memberRoleIds.length === 0) return undefined;

  const coloredRoles = memberRoleIds
    .map(rid => guildRoles.find(r => r.id === rid))
    .filter((r): r is Role => r != null && r.color !== 0)
    .sort((a, b) => b.position - a.position);

  if (coloredRoles.length > 0 && coloredRoles[0]) {
    return roleColorToHex(coloredRoles[0].color);
  }
  return undefined;
};

/**
 * Hook that returns a function to look up the role color for a given user ID
 * within the current guild context.
 *
 * Returns undefined when there is no guild context (DMs) or when the user
 * has no role with a color set.
 */
export const useRoleColor = (guildId: string | null | undefined): (userId: string) => string | undefined => {
  const showRoleColors = useAppSelector(s => s.settings.showRoleColors);
  const roles = useAppSelector(s => selectRolesByGuild(s, guildId ?? null));
  const members = useAppSelector(s => selectMembersByGuild(s, guildId ?? null));

  const memberRoleMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const member of members) {
      map.set(member.user.id, member.roles);
    }
    return map;
  }, [members]);

  const getRoleColor = useMemo(() => {
    return (userId: string): string | undefined => {
      // When the user has turned off role colors, always fall back to the
      // default text color instead of a per-role one.
      if (!showRoleColors) return undefined;
      if (!guildId) return undefined;
      const memberRoleIds = memberRoleMap.get(userId);
      if (!memberRoleIds) return undefined;
      return getHighestRoleColor(memberRoleIds, roles);
    };
  }, [showRoleColors, guildId, memberRoleMap, roles]);

  return getRoleColor;
};
