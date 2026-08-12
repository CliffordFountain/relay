import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { selectGuild, clearSelectedGuild, removeGuild } from '../../stores/guildsSlice';
import { clearSelectedChannel } from '../../stores/channelsSlice';
import { selectDmChannel } from '../../stores/dmSlice';
import { openModal } from '../../stores/uiSlice';
import { selectGuildList } from '../../stores/selectors';
import { api } from '../../api/rest';
import { RelationshipType } from '../../stores/relationshipsSlice';
import { Tooltip } from '../ui/Tooltip';
import { ContextMenu, useContextMenu, getGuildContextItems } from '../ui/ContextMenu';
import { ServerFolder } from './ServerFolder';
import { DiscoverModal } from '../modals/DiscoverModal';
import { cdnBase } from '../../utils/cdn';
import styles from './serverSidebar.module.scss';

export interface ServerSidebarProps {
  onOpenServerSettings?: () => void;
}

export const ServerSidebar = ({ onOpenServerSettings }: ServerSidebarProps = {}) => {
  const guilds = useAppSelector(selectGuildList);
  const selectedId = useAppSelector(s => s.guilds.selectedGuildId);
  const folders = useAppSelector(s => s.guilds.folders);
  const unreadByChannel = useAppSelector(s => s.notifications.unreadByChannel);
  const mentionsByChannel = useAppSelector(s => s.notifications.mentionsByChannel);
  const channels = useAppSelector(s => s.channels.channels);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const relationships = useAppSelector(s => s.relationships.relationships);
  const presences = useAppSelector(s => s.presence.presences);
  const dmUnread = useAppSelector(s => s.notifications.unreadByChannel);
  const dmChannels = useAppSelector(s => s.dm.dmChannels);
  const dispatch = useAppDispatch();

  // Compute home button activity dot
  const homeActivityDot = useMemo((): 'green' | 'yellow' | null => {
    // Check for pending friend requests (yellow dot)
    const hasPendingRequests = Object.values(relationships).some(
      rel => rel.type === RelationshipType.INCOMING_REQUEST
    );
    if (hasPendingRequests) return 'yellow';

    // Check for online friends with pending DM messages (green dot)
    const friendIds = Object.values(relationships)
      .filter(rel => rel.type === RelationshipType.FRIEND)
      .map(rel => rel.user.id);

    const hasOnlineFriendsWithMessages = friendIds.some(friendId => {
      const presence = presences[friendId];
      const isOnline = presence && presence.status !== 'offline';
      // Check if any DM channel with this friend has unreads
      const hasDmUnread = dmChannels.some(dmCh => {
        return (dmUnread[dmCh.id] ?? 0) > 0 && dmCh.recipients.some(r => r.id === friendId);
      });
      return isOnline && hasDmUnread;
    });

    if (hasOnlineFriendsWithMessages) return 'green';

    return null;
  }, [relationships, presences, dmUnread, dmChannels]);
  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [discoverModalOpen, setDiscoverModalOpen] = useState(false);
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // Collect all guild IDs that are inside a folder
  const guildIdsInFolders = new Set(folders.flatMap(f => f.guildIds));

  // Guilds not in any folder
  const standaloneGuilds = guilds.filter(g => !guildIdsInFolders.has(g.id));

  const getGuildHasUnread = (guildId: string): boolean => {
    return Object.values(channels)
      .filter(c => c.guild_id === guildId)
      .some(c => (unreadByChannel[c.id] ?? 0) > 0);
  };

  const getGuildMentionCount = (guildId: string): number => {
    return Object.values(channels)
      .filter(c => c.guild_id === guildId)
      .reduce((sum, c) => sum + (mentionsByChannel[c.id] ?? 0), 0);
  };

  const handleHomeClick = () => {
    dispatch(clearSelectedGuild());
    dispatch(clearSelectedChannel());
    dispatch(selectDmChannel(null));
    navigate('/channels/@me');
  };

  const handleGuildClick = (guildId: string) => {
    if (selectedId === guildId) return;
    dispatch(selectGuild(guildId));
    dispatch(clearSelectedChannel());
    dispatch(selectDmChannel(null));
    navigate(`/channels/${guildId}`);
  };

  const handleGuildContextMenu = useCallback((e: React.MouseEvent, guild: { id: string; name: string; owner_id: string }) => {
    e.preventDefault();
    e.stopPropagation();
    const isOwner = guild.owner_id === currentUserId;
    const items = getGuildContextItems(
      guild,
      {
        onServerSettings: () => {
          dispatch(selectGuild(guild.id));
          if (onOpenServerSettings) onOpenServerSettings();
        },
        onCreateChannel: () => {
          dispatch(selectGuild(guild.id));
          dispatch(openModal({ modal: 'createChannel' }));
        },
        onCreateInvite: () => {
          dispatch(openModal({
            modal: 'invite',
            props: { channelId: '', serverName: guild.name },
          }));
        },
        onLeaveServer: () => {
          void api.leaveGuild(guild.id);
          dispatch(removeGuild(guild.id));
        },
      },
      { isOwner, canManage: isOwner }
    );
    openContextMenu(e, items);
  }, [currentUserId, dispatch, openContextMenu, onOpenServerSettings]);


  const getGuildAcronym = (name: string | null | undefined): string => {
    if (!name) return '?';
    return name
      .split(/\s+/)
      .map(word => word.charAt(0))
      .filter(Boolean)
      .slice(0, 3)
      .join('')
      .toUpperCase();
  };

  const getPillClass = (guildId: string): string => {
    if (selectedId === guildId) return styles.pillActive ?? '';
    if (hoveredId === guildId) return styles.pillHover ?? '';
    if (getGuildHasUnread(guildId)) return styles.pillUnread ?? '';
    return '';
  };

  return (
    <nav className={styles.sidebar} aria-label="Servers">
      <div role="tree" aria-label="Servers">
        {/* Home Button */}
        <div role="group" aria-label="Direct Messages">
          <Tooltip text="Direct Messages" position="right">
            <div
              className={`${styles.serverItem} ${selectedId === null ? styles.homeActive ?? '' : ''}`}
              onClick={handleHomeClick}
              role="treeitem"
              tabIndex={0}
              aria-label="Home"
              aria-selected={selectedId === null}
              onKeyDown={(e) => { if (e.key === 'Enter') handleHomeClick(); }}
              onMouseEnter={() => setHoveredId('home')}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className={`${styles.pill} ${
                selectedId === null
                  ? styles.pillActive ?? ''
                  : hoveredId === 'home'
                    ? styles.pillHover ?? ''
                    : ''
              }`} />
              <div className={styles.iconWrapper}>
                <div className={styles.homeIcon}>
                  {/* Original Relay mark: concentric "relay" signal rings */}
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
                    <circle
                      cx="12"
                      cy="12"
                      r="6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      strokeDasharray="12.6 6.3"
                      transform="rotate(-30 12 12)"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="9.4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      strokeDasharray="19.7 9.85"
                      transform="rotate(15 12 12)"
                      opacity="0.5"
                    />
                  </svg>
                </div>
                {homeActivityDot && (
                  <div
                    className={`${styles.activityDot} ${homeActivityDot === 'green' ? styles.activityDotGreen : styles.activityDotYellow}`}
                    aria-label={homeActivityDot === 'green' ? 'Friends online with messages' : 'Pending friend requests'}
                  />
                )}
              </div>
            </div>
          </Tooltip>
        </div>

        <div className={styles.separator} />

        {/* Server Folders */}
        {folders.length > 0 && (
          <div role="group" aria-label="Server Folders">
            {folders.map(folder => (
              <ServerFolder key={folder.id} folder={folder} />
            ))}
          </div>
        )}

        {/* Standalone Guild List (not in folders) */}
        <div role="group" aria-label="Servers">
          {standaloneGuilds.map(g => (
            <Tooltip key={g.id} text={g.name} position="right">
              <div
                className={`${styles.serverItem} ${selectedId === g.id ? styles.active ?? '' : ''}`}
                onClick={() => handleGuildClick(g.id)}
                onContextMenu={(e) => handleGuildContextMenu(e, g)}
                onMouseEnter={() => setHoveredId(g.id)}
                onMouseLeave={() => setHoveredId(null)}
                role="treeitem"
                tabIndex={0}
                aria-label={g.name}
                aria-selected={selectedId === g.id}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleGuildClick(g.id);
                  }
                }}
              >
                <div className={`${styles.pill} ${getPillClass(g.id)}`} />
                <div className={styles.iconWrapper}>
                  <div className={styles.guildIcon}>
                    {g.icon ? (
                      <img
                        src={g.icon.startsWith('data:') ? g.icon : `${cdnBase()}/icons/${g.id}/${g.icon}.png`}
                        alt={g.name}
                        loading="lazy"
                      />
                    ) : (
                      getGuildAcronym(g.name)
                    )}
                  </div>
                  {getGuildMentionCount(g.id) > 0 && (
                    <div className={styles.badge} aria-label={`${getGuildMentionCount(g.id)} mentions`}>
                      {getGuildMentionCount(g.id)}
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>
          ))}
        </div>

        <div className={styles.separator} />

        {/* Add Server Button */}
        <Tooltip text="Add a Server" position="right">
          <div
            className={styles.addServerItem}
            onClick={() => dispatch(openModal({ modal: 'createGuild' }))}
            role="button"
            aria-label="Add a Server"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') dispatch(openModal({ modal: 'createGuild' })); }}
          >
            <div className={styles.iconWrapper}>
              <div className={styles.addIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 11.1111H12.8889V4H11.1111V11.1111H4V12.8889H11.1111V20H12.8889V12.8889H20V11.1111Z" />
                </svg>
              </div>
            </div>
          </div>
        </Tooltip>

        {/* Discover Servers Button */}
        <Tooltip text="Discover Servers" position="right">
          <div
            className={styles.discoverItem}
            onClick={() => setDiscoverModalOpen(true)}
            role="button"
            aria-label="Discover servers"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setDiscoverModalOpen(true); }}
          >
            <div className={styles.iconWrapper}>
              <div className={styles.discoverIcon}>
                {/* Compass needle, matching the other rail glyphs' 24x24 currentColor style */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path
                    fill="currentColor"
                    d="M15.5 8.5L13.2 13.2L8.5 15.5L10.8 10.8L15.5 8.5Z"
                  />
                </svg>
              </div>
            </div>
          </div>
        </Tooltip>

      </div>{/* close tree */}

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {discoverModalOpen && (
        <DiscoverModal onClose={() => setDiscoverModalOpen(false)} />
      )}
    </nav>
  );
};
