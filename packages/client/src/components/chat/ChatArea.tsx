import { useEffect, useCallback, useState, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setMessages, prependMessages, setHasMore, setLoadingMore } from '../../stores/messagesSlice';
import { setMemberSidebarOpen, closeInboxPanel, closeThreadsPanel, togglePinnedMessagesPanel, toggleThreadsPanel, openModal } from '../../stores/uiSlice';
import { selectMessagesByChannel } from '../../stores/selectors';
import { openSearch, closeSearch } from '../../stores/searchSlice';
import { api } from '../../api/rest';
import { MessageList } from './MessageList';
import { MediaGridView } from './MediaGridView';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { SearchBar } from '../search/SearchBar';
import { SkeletonMessageList } from '../ui/SkeletonMessage';
import { VoiceChannelView } from '../voice/VoiceChannelView';
import { StageView } from '../stage/StageView';
import { ForumView } from '../forum/ForumView';
import { FriendsPage } from '../friends/FriendsPage';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { NsfwGate, isNsfwAccepted } from './NsfwGate';
import { SlowmodeIndicator } from './SlowmodeIndicator';
import { Tooltip } from '../ui/Tooltip';
import { FollowChannelModal } from '../modals/FollowChannelModal';
import styles from './chatArea.module.scss';

export const ChatArea = () => {
  const dispatch = useAppDispatch();
  const selectedChannelId = useAppSelector(s => s.channels.selectedChannelId);
  const selectedChannel = useAppSelector(s => selectedChannelId ? s.channels.channels[selectedChannelId] : null);
  const messages = useAppSelector(s => selectMessagesByChannel(s, selectedChannelId));
  const hasMore = useAppSelector(s => selectedChannelId ? s.messages.hasMoreByChannel[selectedChannelId] ?? true : true);
  const isLoadingMore = useAppSelector(s => selectedChannelId ? s.messages.loadingMoreByChannel[selectedChannelId] ?? false : false);
  const memberSidebarOpen = useAppSelector(s => s.ui.memberSidebarOpen);
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const selectedGuild = useAppSelector(s => selectedGuildId ? s.guilds.guilds[selectedGuildId] : null);
  const searchOpen = useAppSelector(s => s.search.isOpen);
  const threadsPanelOpen = useAppSelector(s => s.ui.threadsPanelOpen);
  const pinnedPanelOpen = useAppSelector(s => s.ui.pinnedMessagesPanelOpen);
  const inboxOpen = useAppSelector(s => s.ui.inboxPanelOpen);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [nsfwAccepted, setNsfwAccepted] = useState(false);
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0);
  const [topicPopupOpen, setTopicPopupOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [followModalOpen, setFollowModalOpen] = useState(false);
  const dragCounterRef = useRef(0);

  // Reset to the message list whenever the active channel changes.
  useEffect(() => {
    setViewMode('list');
    setFollowModalOpen(false);
  }, [selectedChannelId]);

  // Check NSFW acceptance when channel changes
  useEffect(() => {
    if (selectedChannelId && selectedChannel?.nsfw) {
      setNsfwAccepted(isNsfwAccepted(selectedChannelId));
    } else {
      setNsfwAccepted(false);
    }
  }, [selectedChannelId, selectedChannel?.nsfw]);

  useEffect(() => {
    // Don't fetch messages for voice, stage, or forum channels here (type 2, 13, 15) --
    // voice channels load messages on demand via text-in-voice chat panel
    // stage channels have their own view
    // forum channels load their own posts via ForumView
    if (selectedChannelId && selectedChannel?.type !== 2 && selectedChannel?.type !== 13 && selectedChannel?.type !== 15) {
      setIsInitialLoading(true);
      api.getMessages(selectedChannelId, { limit: 50 }).then(msgs => {
        const reversed = [...msgs].reverse();
        dispatch(setMessages({ channelId: selectedChannelId, messages: reversed }));
        dispatch(setHasMore({ channelId: selectedChannelId, hasMore: msgs.length >= 50 }));
      }).catch(() => {
        // Set empty messages on failure so we don't stay in loading state
        dispatch(setMessages({ channelId: selectedChannelId, messages: [] }));
      }).finally(() => {
        setIsInitialLoading(false);
      });
    }
  }, [selectedChannelId, selectedChannel?.type, dispatch]);

  const handleLoadMore = useCallback(() => {
    if (!selectedChannelId || !hasMore || isLoadingMore) return;

    const oldestMessage = messages[0];
    if (!oldestMessage) return;

    dispatch(setLoadingMore({ channelId: selectedChannelId, loading: true }));

    api.getMessages(selectedChannelId, { before: oldestMessage.id, limit: 50 })
      .then(msgs => {
        const reversed = [...msgs].reverse();
        dispatch(prependMessages({ channelId: selectedChannelId, messages: reversed }));
        dispatch(setHasMore({ channelId: selectedChannelId, hasMore: msgs.length >= 50 }));
      })
      .catch(() => {
        // Silently handle fetch failure
      })
      .finally(() => {
        dispatch(setLoadingMore({ channelId: selectedChannelId, loading: false }));
      });
  }, [selectedChannelId, hasMore, isLoadingMore, messages, dispatch]);

  const handleOpenSearch = useCallback(() => {
    dispatch(openSearch());
  }, [dispatch]);

  // The right-hand panel slot (rendered in AppLayout) is shared by the Inbox, Threads,
  // Search and Member panels with a fixed priority (inbox > threads > search > member),
  // so an open Inbox/Threads/Search hides the member list even while memberSidebarOpen is
  // true. Derive the list's ACTUAL visibility, and when revealing it close whatever is
  // occupying the slot so this toggle reliably shows/hides the member list.
  const memberListVisible = memberSidebarOpen && !inboxOpen && !threadsPanelOpen && !searchOpen;
  const handleToggleMemberList = () => {
    if (memberListVisible) {
      dispatch(setMemberSidebarOpen(false));
    } else {
      if (inboxOpen) dispatch(closeInboxPanel());
      if (threadsPanelOpen) dispatch(closeThreadsPanel());
      if (searchOpen) dispatch(closeSearch());
      dispatch(setMemberSidebarOpen(true));
    }
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
    }
  }, []);

  const handleDroppedFilesConsumed = useCallback(() => {
    setDroppedFiles([]);
  }, []);

  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);

  const handleJumpToMessage = useCallback((messageId: string) => {
    setJumpToMessageId(messageId);
  }, []);

  const handleJumpComplete = useCallback(() => {
    setJumpToMessageId(null);
  }, []);

  // No channel selected at all - show appropriate empty state
  if (!selectedChannelId) {
    // Home view (no guild selected): show FriendsPage
    if (!selectedGuildId) {
      return <FriendsPage />;
    }
    return (
      <div className={styles.area}>
        <div className={styles.empty}>
          Select a channel to start chatting
        </div>
      </div>
    );
  }

  // Channel is selected but not yet in the store (loading channel data)
  if (!selectedChannel) {
    return (
      <div className={styles.area}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <svg className={styles.channelIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 15H15.4104L16.4104 9H10.4104L9.41045 15Z" />
            </svg>
            <span className={styles.channelName}>...</span>
          </div>
        </div>
        <div className={styles.loadingContainer}>
          <SkeletonMessageList count={6} />
        </div>
      </div>
    );
  }

  // Voice channel (type 2) - show VoiceChannelView instead of messages
  if (selectedChannel.type === 2) {
    return (
      <VoiceChannelView
        channelId={selectedChannelId}
        channelName={selectedChannel.name ?? 'Voice Channel'}
      />
    );
  }

  // Stage channel (type 13) - show StageView
  if (selectedChannel.type === 13) {
    return (
      <StageView
        channelId={selectedChannelId}
        channelName={selectedChannel.name ?? 'Stage Channel'}
      />
    );
  }

  // Forum channel (type 15) - show ForumView instead of messages
  if (selectedChannel.type === 15) {
    return (
      <ForumView
        channelId={selectedChannelId}
        channelName={selectedChannel.name ?? 'Forum'}
        channelTopic={selectedChannel.topic}
      />
    );
  }

  // NSFW channel gate
  if (selectedChannel.nsfw && !nsfwAccepted) {
    return (
      <div className={styles.area}>
        <NsfwGate
          channelId={selectedChannelId}
          channelName={selectedChannel.name ?? 'channel'}
          onAccept={() => setNsfwAccepted(true)}
        />
      </div>
    );
  }

  // Determine if this is a DM channel (type 1 or 3)
  const isDm = selectedChannel.type === 1 || selectedChannel.type === 3;
  // Announcement channels (type 5) use a megaphone icon prefix
  const isAnnouncement = selectedChannel.type === 5;
  const slowmodeSeconds = selectedChannel.rate_limit_per_user ?? 0;
  return (
    <div
      className={styles.area}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className={styles.dragOverlay} aria-hidden="true">
          <div className={styles.dragOverlayContent}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" className={styles.dragIcon}>
              <path d="M12 2.00098C6.486 2.00098 2 6.48698 2 12.001C2 17.515 6.486 22.001 12 22.001C17.514 22.001 22 17.515 22 12.001C22 6.48698 17.514 2.00098 12 2.00098ZM17 13.001H13V17.001H11V13.001H7V11.001H11V7.00098H13V11.001H17V13.001Z" />
            </svg>
            <span className={styles.dragText}>
              Upload to #{selectedChannel.name}
            </span>
          </div>
        </div>
      )}
      <section className={styles.header} role="region" aria-label="Channel header">
        <h1 className={styles.srOnly}>
          {selectedGuild ? `${selectedGuild.name}: ${selectedChannel.name}` : selectedChannel.name}
        </h1>
        <div className={styles.headerLeft}>
          {isDm ? (
            <svg className={styles.channelIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm3.5-9c.828 0 1.5-.672 1.5-1.5S16.328 8 15.5 8 14 8.672 14 9.5s.672 1.5 1.5 1.5zm-7 0c.828 0 1.5-.672 1.5-1.5S9.328 8 8.5 8 7 8.672 7 9.5 7.672 11 8.5 11zm3.5 6.5c2.33 0 4.32-1.45 5.116-3.5H6.884A5.508 5.508 0 0 0 12 17.5z" />
            </svg>
          ) : isAnnouncement ? (
            <svg className={styles.channelIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3.9 8.26H2V15.2941H3.9V8.26Z" />
              <path d="M19.1 4V5.12659L4.85 8.26447V18.1176C4.85 18.5496 5.1464 18.9252 5.5701 19.0315L9.3701 19.8979C9.4461 19.9161 9.5765 19.9474 9.6335 19.9474C10.0015 19.9474 10.3335 19.7161 10.4535 19.3474L11.8795 14.9474L19.1 16.6V17.7H21V4H19.1Z" />
            </svg>
          ) : (
            <svg className={styles.channelIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 15H15.4104L16.4104 9H10.4104L9.41045 15Z" />
            </svg>
          )}
          <span className={styles.channelName}>{selectedChannel.name}</span>
          {selectedChannel.topic && (
            <>
              <div className={styles.topicDivider} aria-hidden="true" />
              <button
                className={styles.topicButton}
                onClick={() => setTopicPopupOpen(true)}
                type="button"
                aria-label="Click to view full topic"
                title={selectedChannel.topic}
              >
                {selectedChannel.topic}
              </button>
            </>
          )}
        </div>
        <div className={styles.headerToolbar}>
          <div className={styles.viewToggle} role="group" aria-label="Message view mode">
            <button
              type="button"
              className={`${styles.viewToggleButton} ${viewMode === 'list' ? styles.viewToggleButtonActive : ''}`}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="List view"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z" />
              </svg>
              <span>List</span>
            </button>
            <button
              type="button"
              className={`${styles.viewToggleButton} ${viewMode === 'grid' ? styles.viewToggleButtonActive : ''}`}
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
              </svg>
              <span>Grid</span>
            </button>
          </div>
          {isAnnouncement && (
            <Tooltip text="Follow" position="top">
              <button
                className={`${styles.toolbarButton} ${followModalOpen ? styles.toolbarButtonActive : ''}`}
                onClick={() => setFollowModalOpen(true)}
                aria-label="Follow"
                type="button"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M4 4v3c7.732 0 14 6.268 14 14h3C21 10.059 13.941 3 4 3v1zm0 6v3c3.309 0 6 2.691 6 6h3c0-4.962-4.038-9-9-9zm2.18 7.82c0 1.005-.815 1.82-1.82 1.82s-1.82-.815-1.82-1.82.815-1.82 1.82-1.82 1.82.815 1.82 1.82z" />
                </svg>
              </button>
            </Tooltip>
          )}
          {!isDm && selectedGuildId && (
            <button
              className={`${styles.toolbarButton} ${threadsPanelOpen ? styles.toolbarButtonActive : ''}`}
              onClick={() => dispatch(toggleThreadsPanel())}
              aria-label="Threads"
              title="Threads"
              type="button"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3.48 2.01C2.65 2.04 2 2.72 2 3.55V18.24C2 19.08 2.67 19.74 3.5 19.74H6V22.24C6 22.51 6.11 22.77 6.29 22.95C6.68 23.34 7.31 23.34 7.7 22.95L10.96 19.74H14.5C15.33 19.74 16 19.07 16 18.24V15.74H17.5C18.33 15.74 19 15.07 19 14.24V10.74H20.5C21.33 10.74 22 10.07 22 9.24V3.55C22 2.72 21.33 2.05 20.5 2.05L3.48 2.01ZM4 4.05H20V8.74H18.5C17.67 8.74 17 9.41 17 10.24V13.74H14.5C13.67 13.74 13 14.41 13 15.24V17.74H8L4 21.74V4.05Z" />
              </svg>
            </button>
          )}
          {!isDm && selectedGuildId && (
            <button
              className={styles.toolbarButton}
              onClick={() => dispatch(openModal({ modal: 'notificationSettings', props: { guildId: selectedGuildId } }))}
              aria-label="Notification Settings"
              title="Notification Settings"
              type="button"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18 9V14C18 15.657 19.343 17 21 17V18H3V17C4.657 17 6 15.657 6 14V9C6 5.686 8.686 3 12 3C15.314 3 18 5.686 18 9ZM11.9999 22C10.5239 22 9.24793 21.19 8.55493 20H15.4449C14.7519 21.19 13.4759 22 11.9999 22Z" />
              </svg>
            </button>
          )}
          {!isDm && selectedGuildId && (
            <button
              className={`${styles.toolbarButton} ${pinnedPanelOpen ? styles.toolbarButtonActive : ''}`}
              onClick={() => dispatch(togglePinnedMessagesPanel())}
              aria-label="Pinned Messages"
              title="Pinned Messages"
              type="button"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M22 12.41L13.59 4 12 5.59l1.59 1.59-5.89 5.89-1.18-1.18L5.12 13.3l3.54 3.53-4.24 4.24 1.42 1.41 4.24-4.24 3.53 3.54 1.41-1.42-1.18-1.18 5.89-5.89L21.41 14 22 12.41z" />
              </svg>
            </button>
          )}
          {selectedGuildId && (
            <button
              className={`${styles.toolbarButton} ${memberListVisible ? styles.toolbarButtonActive : ''}`}
              onClick={handleToggleMemberList}
              aria-label="Toggle member list"
              title="Toggle member list"
              type="button"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.795 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006ZM20 20.006H22V19.006C22 16.4498 20.2179 14.4517 17.2837 13.3265C19.8927 14.7749 20 17.2516 20 19.006V20.006ZM17.5 4.00598C17.5 4.00598 17 4.00598 17 4.00598C15.5 8.00598 18.5 12.006 17 12.006C19.206 12.006 21 10.211 21 8.00598C21 5.80098 19.206 4.00598 17.5 4.00598Z" />
              </svg>
            </button>
          )}
          {searchOpen && selectedGuildId ? (
            <SearchBar guildId={selectedGuildId} />
          ) : (
            !isDm && selectedGuildId && (
              <div className={styles.searchBar} onClick={handleOpenSearch} role="combobox" aria-label="Search" aria-expanded={false} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') handleOpenSearch(); }}>
                <input
                  type="text"
                  placeholder={`Search ${selectedGuild?.name || 'server'}`}
                  className={styles.searchInput}
                  readOnly
                  tabIndex={-1}
                />
                <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z" />
                </svg>
              </div>
            )
          )}
        </div>
      </section>
      {viewMode === 'grid' ? (
        <MediaGridView channelId={selectedChannelId} />
      ) : isInitialLoading ? (
        <div className={styles.loadingContainer}>
          <SkeletonMessageList count={8} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          channelId={selectedChannelId}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          isAnnouncement={isAnnouncement}
          jumpToMessageId={jumpToMessageId}
          onJumpComplete={handleJumpComplete}
        />
      )}
      <TypingIndicator channelId={selectedChannelId} />
      {slowmodeSeconds > 0 && (
        <SlowmodeIndicator
          seconds={slowmodeSeconds}
          cooldown={slowmodeCooldown}
        />
      )}
      <MessageInput
        channelId={selectedChannelId}
        externalFiles={droppedFiles}
        onExternalFilesConsumed={handleDroppedFilesConsumed}
        slowmodeSeconds={slowmodeSeconds}
        onSlowmodeCooldownChange={setSlowmodeCooldown}
      />
      {pinnedPanelOpen && (
        <PinnedMessagesPanel
          channelId={selectedChannelId}
          onJumpToMessage={handleJumpToMessage}
        />
      )}
      {followModalOpen && isAnnouncement && (
        <FollowChannelModal
          channelId={selectedChannelId}
          channelName={selectedChannel.name}
          onClose={() => setFollowModalOpen(false)}
        />
      )}
      {topicPopupOpen && selectedChannel.topic && (
        <div
          className={styles.topicPopupBackdrop}
          onClick={() => setTopicPopupOpen(false)}
          role="presentation"
        >
          <div
            className={styles.topicPopup}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Channel topic"
          >
            <div className={styles.topicPopupHeader}>
              <h2 className={styles.topicPopupTitle}>#{selectedChannel.name}</h2>
              <button
                className={styles.topicPopupClose}
                onClick={() => setTopicPopupOpen(false)}
                type="button"
                aria-label="Close"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                </svg>
              </button>
            </div>
            <div className={styles.topicPopupBody}>
              <p className={styles.topicPopupText}>{selectedChannel.topic}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
