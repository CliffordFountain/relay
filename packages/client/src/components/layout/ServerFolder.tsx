import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { toggleFolderExpanded, selectGuild, removeFolder, updateFolder } from '../../stores/guildsSlice';
import { clearSelectedChannel } from '../../stores/channelsSlice';
import { selectDmChannel } from '../../stores/dmSlice';
import { Tooltip } from '../ui/Tooltip';
import { ContextMenu, useContextMenu } from '../ui/ContextMenu';
import type { GuildFolder } from '../../stores/guildsSlice';
import { cdnBase } from '../../utils/cdn';
import styles from './serverFolder.module.scss';
import sidebarStyles from './serverSidebar.module.scss';

// Relay's preset folder colors
const FOLDER_PRESET_COLORS: Array<{ name: string; value: number }> = [
  { name: 'Blue', value: 0x3B82F6 },
  { name: 'Green', value: 0x5CF78C },
  { name: 'Yellow', value: 0xF9EC61 },
  { name: 'Red', value: 0xF2474A },
  { name: 'Purple', value: 0x9B59B6 },
  { name: 'Orange', value: 0xE67E22 },
  { name: 'Pink', value: 0xF04AA3 },
];

// ─── Folder Settings Popup ───

interface FolderSettingsPopupProps {
  folder: GuildFolder;
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (name: string | null, color: number | null) => void;
}

const FolderSettingsPopup = ({ folder, anchorRect, onClose, onSave }: FolderSettingsPopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [folderName, setFolderName] = useState(folder.name ?? '');
  const [selectedColor, setSelectedColor] = useState<number | null>(folder.color);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSave = () => {
    onSave(folderName.trim() || null, selectedColor);
    onClose();
  };

  return createPortal(
    <div
      className={styles.folderSettingsPopup}
      ref={popupRef}
      style={{
        top: anchorRect.bottom + 8,
        left: anchorRect.right + 8,
      }}
      role="dialog"
      aria-label="Folder Settings"
    >
      <div className={styles.folderSettingsHeader}>Folder Settings</div>

      <label className={styles.folderSettingsLabel} htmlFor="folder-name-input">
        FOLDER NAME
      </label>
      <input
        id="folder-name-input"
        className={styles.folderSettingsInput}
        value={folderName}
        onChange={(e) => setFolderName(e.target.value)}
        placeholder="Folder name"
        maxLength={100}
      />

      <label className={styles.folderSettingsLabel}>FOLDER COLOR</label>
      <div className={styles.folderColorGrid}>
        {FOLDER_PRESET_COLORS.map(preset => {
          const colorHex = `#${preset.value.toString(16).padStart(6, '0')}`;
          const isSelected = selectedColor === preset.value;
          return (
            <button
              key={preset.name}
              className={`${styles.folderColorSwatch} ${isSelected ? styles.folderColorSwatchSelected : ''}`}
              style={{ backgroundColor: colorHex }}
              onClick={() => setSelectedColor(isSelected ? null : preset.value)}
              title={preset.name}
              aria-label={`${preset.name} color${isSelected ? ' (selected)' : ''}`}
              aria-pressed={isSelected}
              type="button"
            />
          );
        })}
      </div>

      <div className={styles.folderSettingsActions}>
        <button
          className={styles.folderSettingsSaveBtn}
          onClick={handleSave}
          type="button"
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  );
};

export interface ServerFolderProps {
  folder: GuildFolder;
}

export const ServerFolder = ({ folder }: ServerFolderProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const guilds = useAppSelector(s => s.guilds.guilds);
  const selectedId = useAppSelector(s => s.guilds.selectedGuildId);
  const unreadByChannel = useAppSelector(s => s.notifications.unreadByChannel);
  const mentionsByChannel = useAppSelector(s => s.notifications.mentionsByChannel);
  const channels = useAppSelector(s => s.channels.channels);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showFolderSettings, setShowFolderSettings] = useState(false);
  const [folderSettingsRect, setFolderSettingsRect] = useState<DOMRect | null>(null);
  const folderRef = useRef<HTMLDivElement>(null);
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  const folderGuilds = folder.guildIds
    .map(id => guilds[id])
    .filter((g): g is NonNullable<typeof g> => g !== undefined);

  const folderName = folder.name ?? `${folderGuilds.length} Servers`;

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

  const folderHasUnread = folderGuilds.some(g => getGuildHasUnread(g.id));
  const folderMentionCount = folderGuilds.reduce((sum, g) => sum + getGuildMentionCount(g.id), 0);
  const folderContainsSelected = folderGuilds.some(g => g.id === selectedId);

  const handleToggle = () => {
    dispatch(toggleFolderExpanded(folder.id));
  };

  const handleGuildClick = (guildId: string) => {
    if (selectedId === guildId) return;
    dispatch(selectGuild(guildId));
    dispatch(clearSelectedChannel());
    dispatch(selectDmChannel(null));
    navigate(`/channels/${guildId}`);
  };

  const handleFolderContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, [
      {
        id: 'folder-settings',
        label: 'Folder Settings',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        ),
        onClick: () => {
          if (folderRef.current) {
            setFolderSettingsRect(folderRef.current.getBoundingClientRect());
          }
          setShowFolderSettings(true);
        },
      },
      { id: 'sep-1', separator: true as const },
      {
        id: 'delete-folder',
        label: 'Delete Folder',
        danger: true,
        onClick: () => {
          dispatch(removeFolder(folder.id));
        },
      },
    ]);
  }, [dispatch, folder.id, openContextMenu]);

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
    if (selectedId === guildId) return sidebarStyles.pillActive ?? '';
    if (hoveredId === guildId) return sidebarStyles.pillHover ?? '';
    if (getGuildHasUnread(guildId)) return sidebarStyles.pillUnread ?? '';
    return '';
  };

  const handleFolderSettingsSave = useCallback((name: string | null, color: number | null) => {
    dispatch(updateFolder({ id: folder.id, name, color }));
  }, [dispatch, folder.id]);

  const folderColor = folder.color !== null
    ? `#${folder.color.toString(16).padStart(6, '0')}`
    : undefined;

  // Mini icons for collapsed view (up to 4)
  const miniGuilds = folderGuilds.slice(0, 4);

  if (folder.expanded) {
    return (
      <div className={styles.folderExpanded} role="group" aria-label={folderName} ref={folderRef}>
        {/* Folder toggle header */}
        <Tooltip text={folderName} position="right">
          <div
            className={styles.folderHeader}
            onClick={handleToggle}
            onContextMenu={handleFolderContextMenu}
            role="button"
            tabIndex={0}
            aria-label={`${folderName} - click to collapse`}
            aria-expanded={true}
            onKeyDown={(e) => { if (e.key === 'Enter') handleToggle(); }}
          >
            <div className={sidebarStyles.iconWrapper}>
              <div
                className={styles.folderIconExpanded}
                style={folderColor ? { backgroundColor: folderColor } : undefined}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M2 5C2 3.89543 2.89543 3 4 3H9.58579C10.116 3 10.6249 3.21071 11 3.58579L12.4142 5H20C21.1046 5 22 5.89543 22 7V19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19V5Z" />
                </svg>
              </div>
            </div>
          </div>
        </Tooltip>

        {/* Expanded guild list */}
        <div className={styles.folderGuildList}>
          {folderGuilds.map(g => (
            <Tooltip key={g.id} text={g.name} position="right">
              <div
                className={`${sidebarStyles.serverItem} ${selectedId === g.id ? sidebarStyles.active ?? '' : ''}`}
                onClick={() => handleGuildClick(g.id)}
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
                <div className={`${sidebarStyles.pill} ${getPillClass(g.id)}`} />
                <div className={sidebarStyles.iconWrapper}>
                  <div className={sidebarStyles.guildIcon}>
                    {g.icon ? (
                      <img
                        src={`${cdnBase()}/icons/${g.id}/${g.icon}.png`}
                        alt={g.name}
                        loading="lazy"
                      />
                    ) : (
                      getGuildAcronym(g.name)
                    )}
                  </div>
                  {getGuildMentionCount(g.id) > 0 && (
                    <div className={sidebarStyles.badge} aria-label={`${getGuildMentionCount(g.id)} mentions`}>
                      {getGuildMentionCount(g.id)}
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>
          ))}
        </div>

        {/* Folder bottom border */}
        <div
          className={styles.folderBottomBar}
          style={folderColor ? { backgroundColor: folderColor } : undefined}
        />

        {contextMenu && (
          <ContextMenu
            items={contextMenu.items}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={closeContextMenu}
          />
        )}

        {showFolderSettings && folderSettingsRect && (
          <FolderSettingsPopup
            folder={folder}
            anchorRect={folderSettingsRect}
            onClose={() => setShowFolderSettings(false)}
            onSave={handleFolderSettingsSave}
          />
        )}
      </div>
    );
  }

  // Collapsed folder view - show 2x2 grid of mini icons
  return (
    <div className={styles.folderCollapsed} role="group" aria-label={folderName} ref={folderRef}>
      <Tooltip text={folderName} position="right">
        <div
          className={sidebarStyles.serverItem}
          onClick={handleToggle}
          onContextMenu={handleFolderContextMenu}
          role="button"
          tabIndex={0}
          aria-label={`${folderName} - click to expand`}
          aria-expanded={false}
          onKeyDown={(e) => { if (e.key === 'Enter') handleToggle(); }}
        >
          {/* Pill for folder unread */}
          <div className={`${sidebarStyles.pill} ${
            folderContainsSelected
              ? sidebarStyles.pillActive ?? ''
              : folderHasUnread
                ? sidebarStyles.pillUnread ?? ''
                : ''
          }`} />
          <div className={sidebarStyles.iconWrapper}>
            <div
              className={styles.folderIconCollapsed}
              style={folderColor ? { backgroundColor: folderColor } : undefined}
            >
              <div className={styles.miniIconGrid}>
                {miniGuilds.map(g => (
                  <div key={g.id} className={styles.miniIcon}>
                    {g.icon ? (
                      <img
                        src={`${cdnBase()}/icons/${g.id}/${g.icon}.png`}
                        alt={g.name}
                        loading="lazy"
                      />
                    ) : (
                      getGuildAcronym(g.name)
                    )}
                  </div>
                ))}
                {/* Fill empty slots */}
                {Array.from({ length: 4 - miniGuilds.length }).map((_, i) => (
                  <div key={`empty-${String(i)}`} className={styles.miniIconEmpty} />
                ))}
              </div>
            </div>
            {folderMentionCount > 0 && (
              <div className={sidebarStyles.badge} aria-label={`${String(folderMentionCount)} mentions`}>
                {folderMentionCount}
              </div>
            )}
          </div>
        </div>
      </Tooltip>

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {showFolderSettings && folderSettingsRect && (
        <FolderSettingsPopup
          folder={folder}
          anchorRect={folderSettingsRect}
          onClose={() => setShowFolderSettings(false)}
          onSave={handleFolderSettingsSave}
        />
      )}
    </div>
  );
};
