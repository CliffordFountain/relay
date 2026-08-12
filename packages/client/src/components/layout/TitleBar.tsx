import { useState } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import {
  toggleInboxPanel,
  toggleThreadsPanel,
  togglePinnedMessagesPanel,
  setMemberSidebarOpen,
  closeInboxPanel,
  closeThreadsPanel,
  toggleActiveNowPanel,
  openModal,
} from '../../stores/uiSlice';
import { openSearch, closeSearch } from '../../stores/searchSlice';
import { Tooltip } from '../ui/Tooltip';
import { AboutModal } from '../ui/AboutModal';
import styles from './titleBar.module.scss';

const isElectron = !!(window as unknown as Record<string, unknown>).electronAPI;

const ThreadsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M5.43 21a1.93 1.93 0 0 1-1.93-1.93V4.93C3.5 3.87 4.37 3 5.43 3h13.14c1.06 0 1.93.87 1.93 1.93v10.14c0 1.06-.87 1.93-1.93 1.93H9.52L5.43 21ZM7.44 7.93a.5.5 0 0 0 0 1h9.12a.5.5 0 0 0 0-1H7.44Zm0 3.57a.5.5 0 0 0 0 1h9.12a.5.5 0 0 0 0-1H7.44Zm0 3.57a.5.5 0 0 0 0 1h5.48a.5.5 0 0 0 0-1H7.44Z" />
  </svg>
);

const PinnedIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22 12L12.101 2.10101L10.686 3.51401L12.101 4.92901L7.15001 9.87801V11.293L4.44301 13.999L7.15001 16.706L2.20001 21.656L3.61301 23.07L8.56401 18.12L11.271 20.827L13.978 18.12V16.706L18.928 11.756L20.343 13.171L21.757 11.757L22 12ZM13.978 16.706L11.271 19.413L4.44301 12.585L7.15001 9.87801L13.978 16.706Z" />
  </svg>
);

const NotificationBellIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18 9V14C18 15.657 19.344 17 21 17V18H3V17C4.656 17 6 15.657 6 14V9C6 5.686 8.686 3 12 3C15.314 3 18 5.686 18 9ZM11.9999 22C10.5239 22 9.24793 21.19 8.55493 20H15.4449C14.7519 21.19 13.4759 22 11.9999 22Z" />
  </svg>
);

const MemberListIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.795 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006ZM20 20.006H22V19.006C22 16.4498 20.2085 14.4503 17.3712 13.4639C18.8825 14.605 20 16.4 20 19.006V20.006Z" />
    <path d="M18 8.00598C18 10.211 16.206 12.006 14 12.006C13.1 12.006 12.274 11.702 11.6 11.192C12.49 10.366 13 9.244 13 8.00598C13 6.76798 12.49 5.64598 11.6 4.81998C12.274 4.30998 13.1 4.00598 14 4.00598C16.206 4.00598 18 5.80098 18 8.00598Z" />
  </svg>
);

const SearchIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z" />
  </svg>
);

const InboxIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H5Zm8.8 5.15a.5.5 0 0 0-.86-.02L10.47 11H8a1 1 0 1 0 0 2h3a.5.5 0 0 0 .43-.24l1.9-3.17 1.44 4.33A.5.5 0 0 0 15.24 14h.76a1 1 0 1 0 0-2h-.38l-1.82-4.85Z" />
  </svg>
);

const HelpIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.486 2 2 6.487 2 12C2 17.515 6.486 22 12 22C17.514 22 22 17.515 22 12C22 6.487 17.514 2 12 2ZM12 18.25C11.31 18.25 10.75 17.69 10.75 17C10.75 16.31 11.31 15.75 12 15.75C12.69 15.75 13.25 16.31 13.25 17C13.25 17.69 12.69 18.25 12 18.25ZM13 13.875V15H11V12H12C13.104 12 14 11.104 14 10C14 8.896 13.104 8 12 8C10.896 8 10 8.896 10 10H8C8 7.795 9.795 6 12 6C14.205 6 16 7.795 16 10C16 11.861 14.723 13.429 13 13.875Z" />
  </svg>
);

export interface TitleBarProps {
  className?: string;
}

export const TitleBar = () => {
  const dispatch = useAppDispatch();
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const guilds = useAppSelector(s => s.guilds.guilds);
  const selectedGuild = selectedGuildId ? guilds[selectedGuildId] : null;
  const selectedDmChannelId = useAppSelector(s => s.dm.selectedDmChannelId);
  const inboxOpen = useAppSelector(s => s.ui.inboxPanelOpen);
  const threadsPanelOpen = useAppSelector(s => s.ui.threadsPanelOpen);
  const pinnedPanelOpen = useAppSelector(s => s.ui.pinnedMessagesPanelOpen);
  const memberSidebarOpen = useAppSelector(s => s.ui.memberSidebarOpen);
  const activeNowPanelOpen = useAppSelector(s => s.ui.activeNowPanelOpen);
  const searchOpen = useAppSelector(s => s.search.isOpen);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);

  const isServerChannel = selectedGuildId !== null && selectedGuildId !== '@me';
  const isFriendsPage = (selectedGuildId === null || selectedGuildId === '@me') && !selectedDmChannelId;

  const getTitleContent = (): { text: string; showWaveIcon: boolean } => {
    if (isFriendsPage) {
      return { text: 'Friends', showWaveIcon: true };
    }
    if (selectedGuild?.name) {
      return { text: selectedGuild.name, showWaveIcon: false };
    }
    return { text: 'Relay', showWaveIcon: false };
  };

  const titleContent = getTitleContent();

  const handleInboxClick = () => {
    dispatch(toggleInboxPanel());
  };

  const handleThreadsClick = () => {
    dispatch(toggleThreadsPanel());
  };

  const handlePinnedClick = () => {
    dispatch(togglePinnedMessagesPanel());
  };

  // The right-hand panel slot (rendered in AppLayout) is shared by the Inbox, Threads,
  // Search and Member panels with a fixed priority (inbox > threads > search > member),
  // so an open Inbox/Threads/Search hides the member list even while memberSidebarOpen is
  // true -- which is why this button "did nothing" while one of those panels was open.
  // Derive the list's ACTUAL visibility, and when revealing it close whatever is occupying
  // the slot so the button reliably shows/hides the member list.
  const memberListVisible = memberSidebarOpen && !inboxOpen && !threadsPanelOpen && !searchOpen;

  const handleMemberListClick = () => {
    if (memberListVisible) {
      dispatch(setMemberSidebarOpen(false));
    } else {
      if (inboxOpen) dispatch(closeInboxPanel());
      if (threadsPanelOpen) dispatch(closeThreadsPanel());
      if (searchOpen) dispatch(closeSearch());
      dispatch(setMemberSidebarOpen(true));
    }
  };

  const handleSearchClick = () => {
    dispatch(searchOpen ? closeSearch() : openSearch());
  };

  const handleActiveNowToggle = () => {
    dispatch(toggleActiveNowPanel());
  };

  const handleNotificationSettingsClick = () => {
    if (selectedGuildId) {
      dispatch(openModal({ modal: 'notificationSettings', props: { guildId: selectedGuildId } }));
    }
  };

  const handleHelpClick = () => {
    setAboutModalOpen(true);
  };

  const renderChannelActions = () => (
    <>
      {isServerChannel && (
        <>
          <Tooltip text="Threads">
            <button
              className={`${styles.titleActionBtn} ${threadsPanelOpen ? styles.titleActionBtnActive : ''}`}
              aria-label="Threads"
              type="button"
              onClick={handleThreadsClick}
            >
              <ThreadsIcon />
            </button>
          </Tooltip>
          <Tooltip text="Pinned Messages">
            <button
              className={`${styles.titleActionBtn} ${pinnedPanelOpen ? styles.titleActionBtnActive : ''}`}
              aria-label="Pinned Messages"
              type="button"
              onClick={handlePinnedClick}
            >
              <PinnedIcon />
            </button>
          </Tooltip>
          <Tooltip text="Notification Settings">
            <button
              className={styles.titleActionBtn}
              aria-label="Notification Settings"
              type="button"
              onClick={handleNotificationSettingsClick}
            >
              <NotificationBellIcon />
            </button>
          </Tooltip>
          <Tooltip text="Member List">
            <button
              className={`${styles.titleActionBtn} ${memberListVisible ? styles.titleActionBtnActive : ''}`}
              aria-label="Member List"
              type="button"
              onClick={handleMemberListClick}
            >
              <MemberListIcon />
            </button>
          </Tooltip>
        </>
      )}
      <div className={styles.searchContainer}>
        <Tooltip text="Search">
          <button
            className={`${styles.titleActionBtn} ${searchOpen ? styles.titleActionBtnActive : ''}`}
            aria-label="Search"
            type="button"
            onClick={handleSearchClick}
          >
            <SearchIcon />
          </button>
        </Tooltip>
      </div>
      <Tooltip text="Inbox">
        <button
          className={`${styles.titleActionBtn} ${inboxOpen ? styles.titleActionBtnActive : ''}`}
          aria-label="Inbox"
          type="button"
          onClick={handleInboxClick}
        >
          <InboxIcon />
        </button>
      </Tooltip>
      {isFriendsPage && (
        <Tooltip text="Active Now">
          <button
            className={`${styles.titleActionBtn} ${activeNowPanelOpen ? styles.titleActionBtnActive : ''}`}
            aria-label="Active Now"
            type="button"
            onClick={handleActiveNowToggle}
          >
            <MemberListIcon />
          </button>
        </Tooltip>
      )}
      <Tooltip text="About &amp; Help">
        <button
          className={styles.titleActionBtn}
          aria-label="About &amp; Help"
          type="button"
          onClick={handleHelpClick}
        >
          <HelpIcon />
        </button>
      </Tooltip>
      {aboutModalOpen && <AboutModal onClose={() => setAboutModalOpen(false)} />}
    </>
  );

  if (isElectron) {
    const api = (window as unknown as { electronAPI: { minimize: () => void; maximize: () => void; close: () => void; platform?: string } }).electronAPI;
    return (
      <div className={styles.titlebar}>
        <div className={styles.drag}>
          {titleContent.showWaveIcon && (
            <span className={styles.waveIcon} aria-hidden="true">&#128075;</span>
          )}
          <span className={styles.title}>{titleContent.text}</span>
        </div>
        <div className={styles.titleActions}>
          {renderChannelActions()}
        </div>
        {api.platform !== 'darwin' && (
          <div className={styles.controls}>
            <button className={styles.btn} onClick={() => api.minimize()} type="button">&#x2500;</button>
            <button className={styles.btn} onClick={() => api.maximize()} type="button">&#x25A1;</button>
            <button className={`${styles.btn} ${styles.close}`} onClick={() => api.close()} type="button">&#x2715;</button>
          </div>
        )}
      </div>
    );
  }

  // Web version - show title bar without window controls
  return (
    <div className={styles.titlebar}>
      <div className={styles.drag} />
      <div className={styles.centerTitle}>
        {titleContent.showWaveIcon ? (
          <span className={styles.waveIcon} aria-hidden="true">&#128075;</span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={styles.titleIcon}>
            <path d="M19.73 4.87l-3.98-.6-.35.49c-.67.93-1.61 1.56-2.62 1.56-.84 0-1.74-.36-2.62-1.56l-.36-.49-3.98.6C4.83 5.01 4 5.97 4 7.09V19c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V7.09c0-1.12-.83-2.08-1.97-2.22zM12 18.56c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z" />
          </svg>
        )}
        <span className={styles.title}>{titleContent.text}</span>
      </div>
      <div className={styles.titleActions}>
        {renderChannelActions()}
      </div>
    </div>
  );
};
