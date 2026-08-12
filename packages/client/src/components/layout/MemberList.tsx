import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setMembers, setMembersLoading, updateMember, removeMember } from '../../stores/membersSlice';
import { setActivePopoverUserId, openUserPopover } from '../../stores/uiSlice';
import { addDmChannel, selectDmChannel } from '../../stores/dmSlice';
import { addChannel, selectChannel } from '../../stores/channelsSlice';
import { selectMembersByGuild, selectRolesByGuild, selectPresences } from '../../stores/selectors';
import { usePermissions } from '../../hooks/usePermissions';
import { api } from '../../api/rest';
import { ContextMenu, useContextMenu, getUserContextItems } from '../ui/ContextMenu';
import { ConfirmModal } from '../modals/ConfirmModal';
import type { GuildMember } from '../../stores/membersSlice';
import styles from './memberList.module.scss';

interface RoleGroup {
  roleId: string;
  roleName: string;
  roleColor: string;
  isOnline: boolean;
  members: GuildMember[];
}

const STATUS_COLORS: Record<string, string> = {
  online: '#28aa5e',
  idle: '#f5b737',
  dnd: '#f74448',
  offline: '#858993',
};

function getInitials(name: string): string {
  return name.charAt(0).toUpperCase();
}

function getMemberStatus(
  member: GuildMember,
  presences: Record<string, { status: string }>,
): 'online' | 'idle' | 'dnd' | 'offline' {
  if (!member?.user?.id) return 'offline';
  const presence = presences[member.user.id];
  if (!presence) return 'offline';
  const status = presence.status;
  if (status === 'online' || status === 'idle' || status === 'dnd' || status === 'offline') {
    return status;
  }
  return 'offline';
}

/** SVG crown icon for the server owner */
const CrownIcon = () => (
  <svg
    className={styles.crownIcon}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    role="img"
    aria-label="Server Owner"
  >
    <path
      d="M13.6572 5.42868L13.8936 9.36975C13.9078 9.60896 13.7089 9.80483 13.4696 9.78725C12.5885 9.72476 10.8129 9.56254 8.00002 9.56254C5.18713 9.56254 3.41156 9.72476 2.53046 9.78725C2.29118 9.80483 2.09222 9.60896 2.10641 9.36975L2.34284 5.42868C2.34706 5.35552 2.36856 5.28427 2.40559 5.22074C2.53417 4.99989 2.82097 4.93188 3.0442 5.06746L5.00002 6.24993L7.5286 2.8685C7.56003 2.82512 7.60007 2.78866 7.64607 2.76134C7.87032 2.63494 8.15376 2.71533 8.28056 2.93889L10 5.99993L12.9558 5.06746C12.9974 5.05401 13.0409 5.04735 13.0846 5.04735C13.3286 5.04735 13.5286 5.24732 13.5286 5.49131C13.5286 5.49731 13.5285 5.50331 13.5282 5.50931L13.6572 5.42868ZM3.50002 11.4999C3.50002 11.224 3.72388 10.9999 4.00002 10.9999H12C12.2762 10.9999 12.5 11.224 12.5 11.4999V12.9999C12.5 13.2761 12.2762 13.4999 12 13.4999H4.00002C3.72388 13.4999 3.50002 13.2761 3.50002 12.9999V11.4999Z"
      fill="#f5b737"
    />
  </svg>
);

export interface MemberListProps {
  guildId: string | null;
}

export const MemberList = ({ guildId }: MemberListProps) => {
  const dispatch = useAppDispatch();
  const members = useAppSelector(s => selectMembersByGuild(s, guildId));
  const isLoading = useAppSelector(s => s.members.isLoading);
  const activePopoverUserId = useAppSelector(s => s.ui.activePopoverUserId);
  const selectedGuild = useAppSelector(s => guildId ? s.guilds.guilds[guildId] : null);
  const roles = useAppSelector(s => selectRolesByGuild(s, guildId));
  const presences = useAppSelector(selectPresences);
  const perms = usePermissions(guildId);

  const [nicknameEditUserId, setNicknameEditUserId] = useState<string | null>(null);
  const [nicknameValue, setNicknameValue] = useState('');
  const memberListRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  useEffect(() => {
    if (!guildId) return;
    dispatch(setMembersLoading(true));
    api.getGuildMembers(guildId)
      .then((data: unknown) => {
        const rawMembers = data as Array<Record<string, unknown>>;
        const memberData: GuildMember[] = rawMembers
          .filter((m) => m && (m.user_id || (m.user && typeof m.user === 'object')))
          .map((m) => {
            // API returns { user: { id, username, display_name, avatar, bot }, nick, roles, joined_at }
            if (m.user && typeof m.user === 'object') {
              const rawUser = m.user as Record<string, unknown>;
              const userId = String(rawUser.id ?? '');
              return {
                user: {
                  id: userId,
                  username: String(rawUser.username ?? ''),
                  displayName: String(rawUser.global_name || rawUser.display_name || rawUser.username || ''),
                  avatar: (rawUser.avatar as string | null) ?? null,
                  bot: Boolean(rawUser.bot ?? false),
                },
                roles: Array.isArray(m.roles) ? m.roles as string[] : [],
                nick: (m.nick as string | null) ?? null,
                joinedAt: String(m.joined_at ?? ''),
              };
            }
            // Legacy fallback for old API format with flat user_id
            const userId = String(m.user_id ?? '');
            return {
              user: {
                id: userId,
                username: String(m.username ?? m.nick ?? `User-${userId.slice(-4)}`),
                displayName: String(m.display_name || m.nick || m.username || ''),
                avatar: (m.avatar as string | null) ?? null,
                bot: false,
              },
              roles: Array.isArray(m.roles) ? m.roles as string[] : [],
              nick: (m.nick as string | null) ?? null,
              joinedAt: String(m.joined_at ?? ''),
            };
          });
        dispatch(setMembers({ guildId, members: memberData }));
      })
      .catch(() => {
        dispatch(setMembers({ guildId, members: [] }));
      })
      .finally(() => {
        dispatch(setMembersLoading(false));
      });
  }, [guildId, dispatch]);

  const roleGroups = useMemo((): RoleGroup[] => {
    if (!members.length) return [];

    const validMembers = members.filter(m => m?.user?.id);

    // Build hoisted role groups (sorted by position descending = highest first)
    const hoistedRoles = [...roles]
      .filter(r => r.hoist && r.id !== guildId) // @everyone is never hoisted visually
      .sort((a, b) => b.position - a.position);

    const groups: RoleGroup[] = [];
    const assignedMemberIds = new Set<string>();

    // For each hoisted role, collect members who have that role
    for (const role of hoistedRoles) {
      const roleMembers = validMembers.filter(m => {
        if (assignedMemberIds.has(m.user.id)) return false;
        return m.roles.includes(role.id);
      });

      if (roleMembers.length > 0) {
        for (const rm of roleMembers) {
          assignedMemberIds.add(rm.user.id);
        }

        const roleColor = role.color
          ? `#${role.color.toString(16).padStart(6, '0')}`
          : '';

        // Split into online and offline
        const onlineMembers = roleMembers.filter(m => getMemberStatus(m, presences) !== 'offline');
        const offlineMembers = roleMembers.filter(m => getMemberStatus(m, presences) === 'offline');

        if (onlineMembers.length > 0) {
          groups.push({
            roleId: `${role.id}-online`,
            roleName: role.name,
            roleColor,
            isOnline: true,
            members: onlineMembers,
          });
        }
        if (offlineMembers.length > 0) {
          groups.push({
            roleId: `${role.id}-offline`,
            roleName: `${role.name} -- Offline`,
            roleColor,
            isOnline: false,
            members: offlineMembers,
          });
        }
      }
    }

    // Remaining members go to Online / Offline groups
    const remainingMembers = validMembers.filter(m => !assignedMemberIds.has(m.user.id));
    const onlineRemaining = remainingMembers.filter(m => getMemberStatus(m, presences) !== 'offline');
    const offlineRemaining = remainingMembers.filter(m => getMemberStatus(m, presences) === 'offline');

    if (onlineRemaining.length > 0) {
      groups.push({
        roleId: 'online',
        roleName: 'Online',
        roleColor: '',
        isOnline: true,
        members: onlineRemaining,
      });
    }

    if (offlineRemaining.length > 0) {
      groups.push({
        roleId: 'offline',
        roleName: 'Offline',
        roleColor: '',
        isOnline: false,
        members: offlineRemaining,
      });
    }

    return groups;
  }, [members, roles, guildId, presences]);

  const handleMemberClick = useCallback((member: GuildMember, event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    if (activePopoverUserId === member.user.id) {
      dispatch(setActivePopoverUserId(null));
    } else {
      dispatch(openUserPopover({ userId: member.user.id, position: { top: rect.top, left: rect.left }, guildId }));
    }
  }, [activePopoverUserId, dispatch, guildId]);


  /** Open (or create) a DM with the member and navigate to it, mirroring FriendsPage. */
  const handleMessageMember = useCallback((userId: string) => {
    api.createDm(userId)
      .then(dm => {
        dispatch(addDmChannel(dm));
        dispatch(addChannel({
          id: dm.id,
          guild_id: null,
          type: dm.type,
          name: dm.recipients[0]?.username ?? 'Direct Message',
          topic: null,
          position: 0,
          parent_id: null,
        }));
        dispatch(selectDmChannel(dm.id));
        dispatch(selectChannel(dm.id));
        navigate(`/channels/@me/${dm.id}`);
      })
      .catch(() => { /* silent */ });
  }, [dispatch, navigate]);

  /** Insert an @mention into the open message composer, if one is mounted. */
  const handleMentionMember = useCallback((username: string) => {
    const inputEl = document.querySelector('textarea[aria-label^="Message"]') as HTMLTextAreaElement | null;
    if (!inputEl) return;
    const event = new Event('input', { bubbles: true });
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    nativeInputValueSetter?.call(inputEl, inputEl.value + `@${username} `);
    inputEl.dispatchEvent(event);
    inputEl.focus();
  }, []);

  const handleKickMember = useCallback((userId: string) => {
    if (!guildId) return;
    api.kickMember(guildId, userId)
      .then(() => dispatch(removeMember({ guildId, userId })))
      .catch(() => { /* silent */ });
  }, [dispatch, guildId]);

  const handleBanMember = useCallback((userId: string) => {
    if (!guildId) return;
    api.createBan(guildId, userId)
      .then(() => dispatch(removeMember({ guildId, userId })))
      .catch(() => { /* silent */ });
  }, [dispatch, guildId]);

  const handleSaveNickname = useCallback(() => {
    if (nicknameEditUserId && guildId) {
      const newNick = nicknameValue.trim() || null;
      const userId = nicknameEditUserId;
      api.updateMemberNick(guildId, userId, newNick)
        .then(() => dispatch(updateMember({ guildId, userId, changes: { nick: newNick } })))
        .catch(() => { /* silent */ });
    }
    setNicknameEditUserId(null);
  }, [dispatch, guildId, nicknameEditUserId, nicknameValue]);

  const handleMemberContextMenu = useCallback((e: React.MouseEvent, member: GuildMember) => {
    e.preventDefault();
    e.stopPropagation();
    // Capture the anchor position now — the event target is gone by the time a menu
    // item's onClick fires.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const displayName = member.nick ?? member.user.displayName ?? member.user.username;
    const canManage = perms.isOwner || perms.isAdmin;
    const items = getUserContextItems(
      { id: member.user.id, username: displayName },
      {
        onProfile: () => {
          // Open the same profile popover as left-click.
          dispatch(openUserPopover({ userId: member.user.id, position: { top: rect.top, left: rect.left }, guildId }));
        },
        onMessage: () => {
          handleMessageMember(member.user.id);
        },
        onMention: () => {
          handleMentionMember(member.user.username);
        },
        onChangeNickname: perms.canManageNicknames || perms.isOwner ? () => {
          setNicknameValue(member.nick ?? '');
          setNicknameEditUserId(member.user.id);
        } : undefined,
        onKick: perms.canKickMembers ? () => {
          handleKickMember(member.user.id);
        } : undefined,
        onBan: perms.canBanMembers ? () => {
          handleBanMember(member.user.id);
        } : undefined,
      },
      {
        canManage: canManage || perms.canManageNicknames,
        canKick: perms.canKickMembers,
        canBan: perms.canBanMembers,
      }
    );
    openContextMenu(e, items);
  }, [perms, openContextMenu, dispatch, handleMessageMember, handleMentionMember, handleKickMember, handleBanMember]);


  /**
   * Get the display color for a member based on their highest hoisted role with a color.
   */
  const getMemberColor = useCallback((member: GuildMember): string | undefined => {
    if (!member.roles.length) return undefined;

    // Find highest-position role that has a color
    const memberRoles = member.roles
      .map(rid => roles.find(r => r.id === rid))
      .filter((r): r is NonNullable<typeof r> => r != null && r.color !== 0)
      .sort((a, b) => b.position - a.position);

    if (memberRoles.length > 0 && memberRoles[0]) {
      return `#${memberRoles[0].color.toString(16).padStart(6, '0')}`;
    }
    return undefined;
  }, [roles]);

  if (!guildId) return null;

  if (isLoading && members.length === 0) {
    return (
      <aside className={styles.memberList} role="complementary" aria-label="Member list">
        <div className={styles.headerSpacer} />
        <div className={styles.skeletonContainer}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.skeletonItem}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonName} />
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.memberList} role="complementary" aria-label="Member list" ref={memberListRef}>
      <div className={styles.headerSpacer} />
      <div className={styles.scroller}>
        {roleGroups.map(group => (
          <div key={group.roleId} className={styles.roleGroup}>
            <h3 className={styles.roleHeader}>
              {group.roleName} &mdash; {group.members.length}
            </h3>
            {group.members.map(member => {
              const status = getMemberStatus(member, presences);
              const displayName = member.nick || member.user.displayName || member.user.username || 'Unknown';
              const isOffline = status === 'offline';
              const isServerOwner = selectedGuild?.owner_id === member.user.id;
              const memberColor = getMemberColor(member);

              return (
                <div
                  key={member.user.id}
                  className={`${styles.memberItem} ${isOffline ? styles.memberItemOffline : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${displayName}, ${status}${isServerOwner ? ', Server Owner' : ''}`}
                  onClick={(e) => handleMemberClick(member, e)}
                  onContextMenu={(e) => handleMemberContextMenu(e, member)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleMemberClick(member, e as unknown as React.MouseEvent<HTMLDivElement>);
                    }
                  }}
                >
                  <div className={styles.avatarWrapper}>
                    <div
                      className={`${styles.avatar} ${isOffline ? styles.avatarOffline : ''}`}
                      style={{ backgroundColor: memberColor ?? (group.roleColor || '#3b82f6') }}
                    >
                      {member.user.avatar ? (
                        <img
                          src={member.user.avatar}
                          alt=""
                          className={styles.avatarImage}
                          loading="lazy"
                        />
                      ) : (
                        <span className={styles.avatarInitials}>
                          {getInitials(displayName)}
                        </span>
                      )}
                    </div>
                    <div
                      className={styles.statusDot}
                      style={{ backgroundColor: STATUS_COLORS[status] }}
                      aria-label={status}
                    />
                  </div>
                  <div className={styles.memberInfo}>
                    <span
                      className={`${styles.memberName} ${isOffline ? styles.memberNameOffline : ''}`}
                      style={memberColor ? { color: memberColor } : undefined}
                    >
                      {displayName}
                    </span>
                    {isServerOwner && <CrownIcon />}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {nicknameEditUserId && (
        <ConfirmModal
          title="Change Nickname"
          description="Enter a new nickname for this member in this server."
          confirmLabel="Save"
          onConfirm={handleSaveNickname}
          onCancel={() => setNicknameEditUserId(null)}
        >
          <input
            type="text"
            className={styles.nicknameInput}
            value={nicknameValue}
            onChange={(e) => setNicknameValue(e.target.value)}
            maxLength={32}
            autoFocus
            aria-label="Nickname"
          />
        </ConfirmModal>
      )}
    </aside>
  );
};
