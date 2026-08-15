import { useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setActivePopoverUserId } from '../../stores/uiSlice';
import { UserPopover } from './UserPopover';

/**
 * App-level host for the user profile popover so it can be opened from anywhere
 * (the member list, a message author, etc.) by dispatching
 * `openUserPopover({ userId, position, guildId })`. It resolves the guild member
 * from the store and renders nothing when the user isn't a loaded member of that
 * guild (e.g. in a DM), so callers don't each need to own the popover.
 */
export const UserPopoverHost = () => {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((s) => s.ui.activePopoverUserId);
  const position = useAppSelector((s) => s.ui.activePopoverPosition);
  const popoverGuildId = useAppSelector((s) => s.ui.activePopoverGuildId);
  const selectedGuildId = useAppSelector((s) => s.guilds.selectedGuildId);
  const membersByGuild = useAppSelector((s) => s.members.membersByGuild);

  const guildId = popoverGuildId ?? selectedGuildId ?? null;

  const member = useMemo(() => {
    if (!userId || !guildId) return null;
    return membersByGuild[guildId]?.find((m) => m.user.id === userId) ?? null;
  }, [userId, guildId, membersByGuild]);

  if (!userId || !position || !member) return null;

  return (
    <UserPopover
      member={member}
      position={position}
      guildId={guildId ?? undefined}
      onClose={() => dispatch(setActivePopoverUserId(null))}
    />
  );
};
