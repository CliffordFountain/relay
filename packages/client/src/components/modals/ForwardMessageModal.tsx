import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppSelector } from '../../hooks/useAppDispatch';
import type { Message } from '../../stores/messagesSlice';
import type { Channel } from '../../stores/channelsSlice';
import { api } from '../../api/rest';
import styles from './forwardMessageModal.module.scss';

interface ForwardTarget {
  id: string;
  name: string;
  type: 'channel' | 'dm';
  guildName?: string;
}

export interface ForwardMessageModalProps {
  message: Message;
  onClose: () => void;
}

export const ForwardMessageModal = ({ message, onClose }: ForwardMessageModalProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const channels = useAppSelector(s => s.channels.channels);
  const guilds = useAppSelector(s => s.guilds.guilds);
  const dmChannels = useAppSelector(s => s.dm.dmChannels);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Build list of targets: text channels + DMs
  const targets = useMemo((): ForwardTarget[] => {
    const result: ForwardTarget[] = [];

    // Add guild text channels (type 0 = text, type 5 = announcement)
    const channelList = Object.values(channels) as Channel[];
    for (const ch of channelList) {
      if (ch.type !== 0 && ch.type !== 5) continue;
      if (!ch.name) continue;
      const guild = ch.guild_id ? guilds[ch.guild_id] : undefined;
      result.push({
        id: ch.id,
        name: ch.name,
        type: 'channel',
        guildName: guild?.name,
      });
    }

    // Add DM channels
    for (const dm of dmChannels) {
      const name = dm.recipients.map(r => r.username).join(', ') || 'Direct Message';
      result.push({
        id: dm.id,
        name,
        type: 'dm',
      });
    }

    return result;
  }, [channels, guilds, dmChannels]);

  const filteredTargets = useMemo(() => {
    if (!searchQuery.trim()) return targets;
    const query = searchQuery.toLowerCase();
    return targets.filter(t =>
      t.name.toLowerCase().includes(query) ||
      (t.guildName && t.guildName.toLowerCase().includes(query))
    );
  }, [targets, searchQuery]);

  const guildChannels = useMemo(
    () => filteredTargets.filter(t => t.type === 'channel'),
    [filteredTargets]
  );
  const dmTargets = useMemo(
    () => filteredTargets.filter(t => t.type === 'dm'),
    [filteredTargets]
  );

  const handleForward = useCallback((targetChannelId: string) => {
    void api.sendMessage(targetChannelId, {
      content: message.content,
    });
    onClose();
  }, [message.content, onClose]);

  const previewContent = message.content.length > 100
    ? message.content.slice(0, 100) + '...'
    : message.content;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="forward-modal-title"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title} id="forward-modal-title">Forward Message</h2>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            placeholder="Search for a channel or DM"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search channels and DMs"
          />
        </div>

        <div className={styles.messagePreview}>
          <span className={styles.previewAuthor}>{message.author.username}</span>
          <div className={styles.previewContent}>{previewContent}</div>
        </div>

        <div className={styles.channelList}>
          {guildChannels.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Text Channels</div>
              {guildChannels.map(target => (
                <button
                  key={target.id}
                  className={styles.channelItem}
                  onClick={() => handleForward(target.id)}
                  type="button"
                  aria-label={`Forward to #${target.name}`}
                >
                  <svg className={styles.channelIcon} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 9L8.35045 15H14.3504L15.4104 9H9.41045Z" />
                  </svg>
                  <span className={styles.channelName}>{target.name}</span>
                  {target.guildName && (
                    <span className={styles.guildName}>{target.guildName}</span>
                  )}
                </button>
              ))}
            </>
          )}

          {dmTargets.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Direct Messages</div>
              {dmTargets.map(target => (
                <button
                  key={target.id}
                  className={styles.channelItem}
                  onClick={() => handleForward(target.id)}
                  type="button"
                  aria-label={`Forward to ${target.name}`}
                >
                  <div className={styles.dmAvatar}>
                    {target.name.charAt(0).toUpperCase()}
                  </div>
                  <span className={styles.channelName}>{target.name}</span>
                </button>
              ))}
            </>
          )}

          {filteredTargets.length === 0 && (
            <div className={styles.emptyState}>
              No channels or DMs found
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
