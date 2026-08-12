import { useState, useCallback, Component, type ReactNode } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { useRouteSync } from '../../hooks/useRouteSync';
import { closeModal } from '../../stores/uiSlice';
import { ServerSidebar } from './ServerSidebar';
import { ChannelSidebar } from './ChannelSidebar';
import { UserPanel } from './UserPanel';
import { ChatArea } from '../chat/ChatArea';
import { MemberList } from './MemberList';
import { UserPopoverHost } from '../ui/UserPopoverHost';
import { ScreenSharePicker } from '../voice/ScreenSharePicker';
import { DMList } from '../dm/DMList';
import { UserSettings } from '../settings/UserSettings';
import { ServerSettings } from '../settings/ServerSettings';
import { ChannelSettings } from '../settings/ChannelSettings';
import { CreateGuildModal } from '../modals/CreateGuildModal';
import { CreateChannelModal } from '../modals/CreateChannelModal';
import { InviteModal } from '../modals/InviteModal';
import { JoinGuildModal } from '../modals/JoinGuildModal';
import { ImageLightbox } from '../modals/ImageLightbox';
import { CreateGroupDMModal } from '../modals/CreateGroupDMModal';
import { NotificationSettingsModal } from '../modals/NotificationSettingsModal';
import { CreateEventModal } from '../modals/CreateEventModal';
import { GuildEventsModal } from '../modals/GuildEventsModal';
import { EditServerProfileModal } from '../modals/EditServerProfileModal';
import { SearchResults } from '../search/SearchResults';
import { CreateForumPost } from '../forum/CreateForumPost';
import { ThreadView } from '../threads/ThreadView';
import { ThreadsPanel } from '../threads/ThreadsPanel';
import { TitleBar } from './TitleBar';
import { QuickSwitcher } from '../ui/QuickSwitcher';
import { InboxPanel } from '../ui/InboxPanel';
import styles from './appLayout.module.scss';

interface ErrorFallbackProps {
  onRetry: () => void;
  error?: Error | null;
}

const ErrorFallback = ({ onRetry, error }: ErrorFallbackProps) => (
  <div className={styles.errorFallback} role="alert">
    <div className={styles.errorFallbackCard}>
      <svg
        className={styles.errorFallbackIcon}
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15c-.55 0-1-.45-1-1v-1c0-.55.45-1 1-1s1 .45 1 1v1c0 .55-.45 1-1 1zm1-5c0 .55-.45 1-1 1s-1-.45-1-1V8c0-.55.45-1 1-1s1 .45 1 1v4z" />
      </svg>
      <h3 className={styles.errorFallbackHeading}>Something went wrong</h3>
      <p className={styles.errorFallbackDescription}>This section encountered an error</p>
      {error?.message && (
        // Surface the real reason so the problem is diagnosable instead of opaque.
        <pre className={styles.errorFallbackDetail}>{error.message}</pre>
      )}
      <button
        className={styles.errorFallbackButton}
        onClick={onRetry}
        type="button"
      >
        Try Again
      </button>
    </div>
  </div>
);

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; label?: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Log the real error + which component subtree threw, so a boundary hit is
    // diagnosable rather than a silent "Something went wrong".
    // eslint-disable-next-line no-console
    console.error(
      `[Relay] Section error${this.props.label ? ` in ${this.props.label}` : ''}:`,
      error,
      info?.componentStack,
    );
  }
  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <ErrorFallback onRetry={this.handleRetry} error={this.state.error} />;
    }
    return this.props.children;
  }
}

export const AppLayout = () => {
  // Sync URL params with Redux state
  useRouteSync();

  const [showSettings, setShowSettings] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [channelSettingsId, setChannelSettingsId] = useState<string | null>(null);
  const memberSidebarOpen = useAppSelector(s => s.ui.memberSidebarOpen);
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const activeModal = useAppSelector(s => s.ui.activeModal);
  const modalProps = useAppSelector(s => s.ui.modalProps);
  const searchOpen = useAppSelector(s => s.search.isOpen);
  const selectedThreadId = useAppSelector(s => s.threads.selectedThreadId);
  const threadsPanelOpen = useAppSelector(s => s.ui.threadsPanelOpen);
  const selectedChannelId = useAppSelector(s => s.channels.selectedChannelId);
  const inboxPanelOpen = useAppSelector(s => s.ui.inboxPanelOpen);

  const dispatch = useAppDispatch();
  const handleOpenSettings = () => setShowSettings(true);
  const handleOpenServerSettings = () => setShowServerSettings(true);
  const handleOpenChannelSettings = useCallback((channelId: string) => setChannelSettingsId(channelId), []);
  const handleCloseModal = useCallback(() => dispatch(closeModal()), [dispatch]);

  return (
    <>
      <TitleBar />
      <div className={styles.layout}>
        <div className={styles.sidebarWrapper}>
          <ErrorBoundary label="ServerSidebar">
            <ServerSidebar onOpenServerSettings={handleOpenServerSettings} />
          </ErrorBoundary>
          <div className={styles.channelColumn}>
            <ErrorBoundary label="ChannelList">

              {selectedGuildId ? (
                <ChannelSidebar
                  onOpenSettings={handleOpenSettings}
                  onOpenServerSettings={handleOpenServerSettings}
                  onOpenChannelSettings={handleOpenChannelSettings}
                />
              ) : (
                <DMList onOpenSettings={handleOpenSettings} />
              )}
            </ErrorBoundary>
          </div>
          <UserPanel onOpenSettings={handleOpenSettings} />
        </div>
        <div className={styles.mainContent}>
          <ErrorBoundary label="ChatArea">
            <ChatArea />
          </ErrorBoundary>
          {selectedThreadId && (
            <ErrorBoundary>
              <ThreadView threadId={selectedThreadId} />
            </ErrorBoundary>
          )}
          <ErrorBoundary>
            {inboxPanelOpen ? (
              <InboxPanel />
            ) : threadsPanelOpen && selectedChannelId && selectedGuildId ? (
              <ThreadsPanel channelId={selectedChannelId} />
            ) : searchOpen && selectedGuildId ? (
              <SearchResults guildId={selectedGuildId} />
            ) : (
              memberSidebarOpen && selectedGuildId && (
                <MemberList guildId={selectedGuildId} />
              )
            )}
          </ErrorBoundary>
        </div>
        <UserPopoverHost />
        <ScreenSharePicker />
        {showSettings && <UserSettings onClose={() => setShowSettings(false)} />}
        {showServerSettings && selectedGuildId && (
          <ServerSettings
            guildId={selectedGuildId}
            onClose={() => setShowServerSettings(false)}
          />
        )}
        {channelSettingsId && (
          <ChannelSettings
            channelId={channelSettingsId}
            onClose={() => setChannelSettingsId(null)}
          />
        )}
        {activeModal === 'createGuild' && <CreateGuildModal />}
        {activeModal === 'createChannel' && <CreateChannelModal />}
        {activeModal === 'invite' && (
          <InviteModal
            channelId={String(modalProps.channelId ?? '')}
            serverName={String(modalProps.serverName ?? '')}
            onClose={handleCloseModal}
          />
        )}
        {activeModal === 'joinGuild' && (
          <JoinGuildModal onClose={handleCloseModal} />
        )}
        {activeModal === 'createForumPost' && Boolean(modalProps.channelId) && (
          <CreateForumPost channelId={String(modalProps.channelId)} />
        )}
        {activeModal === 'createGroupDM' && (
          <CreateGroupDMModal onClose={handleCloseModal} />
        )}
        {activeModal === 'notificationSettings' && selectedGuildId && (
          <NotificationSettingsModal
            guildId={selectedGuildId}
            onClose={handleCloseModal}
          />
        )}
        {activeModal === 'createEvent' && selectedGuildId && (
          <CreateEventModal
            guildId={selectedGuildId}
            onClose={handleCloseModal}
          />
        )}
        {activeModal === 'guildEvents' && selectedGuildId && (
          <GuildEventsModal
            guildId={selectedGuildId}
            onClose={handleCloseModal}
          />
        )}
        {activeModal === 'editServerProfile' && selectedGuildId && (
          <EditServerProfileModal
            guildId={selectedGuildId}
            onClose={handleCloseModal}
          />
        )}
        <ImageLightbox />
        <QuickSwitcher />
      </div>
    </>
  );
};
