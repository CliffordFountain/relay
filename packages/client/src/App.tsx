import { useEffect, useRef } from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { store } from './stores/store';
import { useAppSelector, useAppDispatch } from './hooks/useAppDispatch';
import { addGuild } from './stores/guildsSlice';
import { addChannel, setChannels, selectChannel } from './stores/channelsSlice';
import { addMessage, updateMessage, deleteMessage, bulkDeleteMessages, confirmPendingMessage, updateAuthorIdentity, type Message } from './stores/messagesSlice';
import { toggleMute, toggleDeaf, updateVoiceUserIdentity } from './stores/voiceSlice';
import { setUser } from './stores/authSlice';
import { updateMemberUser } from './stores/membersSlice';
import { addUnread, addMention, markRead } from './stores/notificationsSlice';
import { updateDmLastMessage } from './stores/dmSlice';
import { addTypingUser, removeTypingUser } from './stores/typingSlice';
import { addThread, updateThread as updateThreadAction } from './stores/threadsSlice';
import { addRelationship, removeRelationship as removeRelAction, updateRelationship, RelationshipType, type Relationship } from './stores/relationshipsSlice';
import { setPresence, bulkSetPresences, type UserPresence } from './stores/presenceSlice';
import { openQuickSwitcher } from './stores/uiSlice';
import { gateway } from './api/gateway';
import { voiceManager } from './voice/voiceManager';
import { cdnBase } from './utils/cdn';
import { useStartupLoader, saveLastSelection } from './hooks/useStartupLoader';
import { useAutoIdle } from './hooks/useAutoIdle';
import { useTitleUpdater } from './hooks/useTitleUpdater';
import { AppLayout } from './components/layout/AppLayout';
import { WindowControls } from './components/layout/WindowControls';
import { LoadingScreen } from './components/layout/LoadingScreen';
import { LoginPage } from './components/auth/LoginPage';
import { RegisterPage } from './components/auth/RegisterPage';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { VerifyEmailPage } from './components/auth/VerifyEmailPage';
import { InviteAcceptPage } from './components/invite/InviteAcceptPage';
import { TermsOfService } from './components/legal/TermsOfService';
import { PrivacyPolicy } from './components/legal/PrivacyPolicy';
import './styles/global.scss';

/**
 * ChannelsLayout wraps the authenticated app layout.
 * It renders inside /channels/* routes and handles route-to-Redux sync.
 */
const ChannelsLayout = () => {
  return <AppLayout />;
};

/**
 * Normalizes a keydown event into the same "Ctrl+Shift+M" style string that the
 * Keybinds recorder (in UserSettings) and Push-to-Talk recorder produce, so the
 * global shortcut handler below can look a pressed key up in settings.keybinds
 * instead of hardcoding key combinations.
 */
const normalizeEventToKeybind = (e: KeyboardEvent): string => {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  }
  return parts.join('+');
};

/**
 * AuthGate: redirects unauthenticated users to /login,
 * and redirects authenticated users away from auth pages.
 */
const AuthRedirect = () => {
  const { isAuthenticated } = useAppSelector(s => s.auth);
  const appLoading = useAppSelector(s => s.ui.appLoading);

  if (appLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/channels/@me" replace />;
  return <Navigate to="/login" replace />;
};

const AppInner = () => {
  const dispatch = useAppDispatch();
  const { isAuthenticated, token } = useAppSelector(s => s.auth);
  const appLoading = useAppSelector(s => s.ui.appLoading);
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const selectedChannelId = useAppSelector(s => s.channels.selectedChannelId);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();

  // Apply persisted accessibility settings on startup
  const theme = useAppSelector(s => s.settings.theme);
  const reducedMotion = useAppSelector(s => s.settings.reducedMotion);
  const saturation = useAppSelector(s => s.settings.saturation);
  const highContrast = useAppSelector(s => s.settings.highContrast);
  const fontSize = useAppSelector(s => s.settings.fontSize);
  const enableDesktopNotifications = useAppSelector(s => s.settings.enableDesktopNotifications);
  const keybinds = useAppSelector(s => s.settings.keybinds);

  // Request notification permission on first load
  useEffect(() => {
    if (enableDesktopNotifications && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => { /* user declined */ });
    }
  }, [enableDesktopNotifications]);

  useEffect(() => {
    if (reducedMotion) document.body.classList.add('reduced-motion');
    else document.body.classList.remove('reduced-motion');
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.style.setProperty('--saturation', `${saturation}%`);
  }, [saturation]);

  // Chat font scaling: applied the same way saturation is (a CSS custom property on
  // the document root), so it takes effect immediately and survives reloads.
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-scale', `${fontSize}px`);
  }, [fontSize]);

  useEffect(() => {
    if (highContrast) document.body.classList.add('high-contrast');
    else document.body.classList.remove('high-contrast');
  }, [highContrast]);

  // Apply the active theme to the document root (swaps the CSS custom properties)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Run startup data loading sequence (validates token, fetches guilds/channels)
  useStartupLoader();

  // Auto-idle after 5 minutes of inactivity
  useAutoIdle();

  // Update document.title with unread mention count
  useTitleUpdater();

  // Global keyboard shortcuts. Every action below (other than the Quick Switcher, which
  // isn't a user-configurable keybind) looks its key up in settings.keybinds, so this
  // handler and the Keybinds settings UI can never disagree about what a shortcut does.
  // Push to Talk is deliberately not handled here -- it needs hold-down semantics and is
  // already implemented by the usePushToTalk hook mounted while connected to voice.
  const channels = useAppSelector(s => s.channels.channels);
  useEffect(() => {
    const findKeybind = (action: string): string | undefined =>
      keybinds.find(kb => kb.action === action)?.key || undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K opens Quick Switcher
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        dispatch(openQuickSwitcher());
        return;
      }

      const pressed = normalizeEventToKeybind(e);

      const toggleMuteKey = findKeybind('Toggle Mute');
      if (toggleMuteKey && pressed === toggleMuteKey) {
        e.preventDefault();
        dispatch(toggleMute());
        return;
      }

      const toggleDeafenKey = findKeybind('Toggle Deafen');
      if (toggleDeafenKey && pressed === toggleDeafenKey) {
        e.preventDefault();
        dispatch(toggleDeaf());
        return;
      }

      const searchKey = findKeybind('Search');
      if (searchKey && pressed === searchKey) {
        e.preventDefault();
        // Focus the search input in the title bar if one exists
        const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]');
        if (searchInput) {
          searchInput.focus();
        }
        return;
      }

      const markAsReadKey = findKeybind('Mark as Read');
      if (markAsReadKey && pressed === markAsReadKey) {
        // The default binding is Escape, which is heavily overloaded — it cancels
        // a message edit, closes a modal or context menu, blurs an input, etc.
        // Only treat it as "mark as read" when the user isn't typing in a field and
        // no dialog/menu is open, so those other Escape behaviours keep working.
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true;
        const overlayOpen = document.querySelector('[role="dialog"], [role="menu"]') !== null;
        if (!isEditable && !overlayOpen) {
          const currentChannelId = store.getState().channels.selectedChannelId;
          if (currentChannelId) {
            e.preventDefault();
            dispatch(markRead(currentChannelId));
          }
        }
        return;
      }

      // Navigate Back / Navigate Forward — move to the previous/next text channel
      const navigateBackKey = findKeybind('Navigate Back');
      const navigateForwardKey = findKeybind('Navigate Forward');
      const isNavigateBack = navigateBackKey && pressed === navigateBackKey;
      const isNavigateForward = navigateForwardKey && pressed === navigateForwardKey;
      if (isNavigateBack || isNavigateForward) {
        // Skip if user is typing in an input or textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        e.preventDefault();
        const currentGuildId = store.getState().guilds.selectedGuildId;
        const currentChannelId = store.getState().channels.selectedChannelId;
        if (!currentGuildId) return;

        // Build sorted list of text channels (type 0) for the current guild
        const guildChannels = Object.values(channels)
          .filter(c => c.guild_id === currentGuildId && c.type === 0)
          .sort((a, b) => a.position - b.position);

        if (guildChannels.length === 0) return;

        const currentIndex = guildChannels.findIndex(c => c.id === currentChannelId);
        let nextIndex: number;
        if (isNavigateBack) {
          nextIndex = currentIndex <= 0 ? guildChannels.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex >= guildChannels.length - 1 ? 0 : currentIndex + 1;
        }
        const nextChannel = guildChannels[nextIndex];
        if (nextChannel) {
          dispatch(selectChannel(nextChannel.id));
          navigateRef.current(`/channels/${currentGuildId}/${nextChannel.id}`);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, channels, keybinds]);

  // Persist last-selected guild and channel to localStorage
  useEffect(() => {
    // Only persist after loading is done to avoid clearing saved values
    if (!appLoading) {
      saveLastSelection(selectedGuildId, selectedChannelId);
    }
  }, [selectedGuildId, selectedChannelId, appLoading]);

  // Redirect to login when not authenticated and not on an auth page
  useEffect(() => {
    if (appLoading) return;
    const authPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/verify'];
    // Static informational pages are readable regardless of auth state (e.g. opened
    // from the sign-in footer or registration form, or in a fresh tab) -- never
    // redirect off them.
    const publicPaths = ['/terms', '/privacy'];
    const isAuthPage = authPaths.some(p => location.pathname.startsWith(p));
    const isPublicPage = publicPaths.some(p => location.pathname.startsWith(p));

    if (isPublicPage) return;
    if (!isAuthenticated && !isAuthPage) {
      navigate('/login', { replace: true });
    } else if (isAuthenticated && isAuthPage) {
      navigate('/channels/@me', { replace: true });
    }
  }, [isAuthenticated, appLoading, location.pathname, navigate]);

  // Connect to gateway when authenticated
  useEffect(() => {
    if (isAuthenticated && token) {
      gateway.connect(token, (event, rawData) => {
        // Gateway event data arrives as parsed JSON objects. We narrow per event.
        const data = rawData as Record<string, unknown>;
        switch (event) {
          case 'READY': {
            // NOTE: The READY event only sends partial guild data ({ id, unavailable }).
            // Full guild data (including owner_id) is loaded by the startup loader via REST API.
            // Do NOT call addGuild here — it would overwrite the full data with partial data.
            // Process initial presences from READY payload
            const presences = data.presences as Array<{
              user?: { id?: string };
              user_id?: string;
              status?: string;
              client_status?: Record<string, string>;
              activities?: unknown[];
            }> | undefined;
            if (Array.isArray(presences) && presences.length > 0) {
              const mapped: UserPresence[] = presences
                .filter(p => (p.user?.id ?? p.user_id))
                .map(p => ({
                  userId: (p.user?.id ?? p.user_id) as string,
                  status: (p.status ?? 'offline') as UserPresence['status'],
                  clientStatus: (p.client_status ?? {}) as UserPresence['clientStatus'],
                  activities: (p.activities ?? []) as UserPresence['activities'],
                }));
              dispatch(bulkSetPresences(mapped));
            }

            // Seed self-presence so the member list shows the current user as online.
            // authSlice tracks the user's chosen status; presenceSlice.presences is
            // what the member list reads — they must be kept in sync.
            const selfUser = store.getState().auth.user;
            const selfStatus = store.getState().auth.status;
            if (selfUser?.id) {
              // 'invisible' means the user wants to appear offline to others
              const mappedSelfStatus = selfStatus === 'invisible' ? 'offline' : selfStatus;
              dispatch(setPresence({
                userId: selfUser.id,
                status: mappedSelfStatus as UserPresence['status'],
                clientStatus: selfStatus !== 'invisible'
                  ? { web: selfStatus as 'online' | 'idle' | 'dnd' }
                  : {},
                activities: [],
              }));
            }
            break;
          }
          case 'GUILD_CREATE': {
            dispatch(addGuild(data as unknown as Parameters<typeof addGuild>[0]));
            if (Array.isArray(data.channels)) {
              dispatch(setChannels(data.channels as Parameters<typeof setChannels>[0]));
            }
            // Process online presences bundled with the guild (the gateway sends these so
            // members appear online immediately without waiting for PRESENCE_UPDATE events)
            if (Array.isArray(data.presences) && (data.presences as unknown[]).length > 0) {
              const guildPresences = (data.presences as Array<{
                user?: { id?: string };
                user_id?: string;
                status?: string;
                client_status?: Record<string, string>;
                activities?: unknown[];
              }>)
                .filter(p => (p.user?.id ?? p.user_id))
                .map(p => ({
                  userId: (p.user?.id ?? p.user_id) as string,
                  status: (p.status ?? 'offline') as UserPresence['status'],
                  clientStatus: (p.client_status ?? {}) as UserPresence['clientStatus'],
                  activities: (p.activities ?? []) as UserPresence['activities'],
                }));
              if (guildPresences.length > 0) {
                dispatch(bulkSetPresences(guildPresences));
              }
            }
            break;
          }
          case 'CHANNEL_CREATE':
            dispatch(addChannel(data as unknown as Parameters<typeof addChannel>[0]));
            break;
          case 'TYPING_START': {
            const typingCurrentUserId = store.getState().auth.user?.id;
            const userId = data.user_id as string | undefined;
            const channelId = data.channel_id as string;
            if (userId && userId !== typingCurrentUserId) {
              const member = data.member as { user?: { username?: string } } | undefined;
              dispatch(addTypingUser({
                channelId,
                userId,
                username: member?.user?.username ?? userId,
              }));
              // Auto-remove after 10 seconds
              setTimeout(() => {
                dispatch(removeTypingUser({ channelId, userId }));
              }, 10000);
            }
            break;
          }
          case 'MESSAGE_CREATE': {
            const msg = data as unknown as Message;
            const msgCurrentUserId = store.getState().auth.user?.id;
            const isOwnMessage = msg.author?.id && msg.author.id === msgCurrentUserId;
            const nonce = data._nonce as string | undefined ?? data.nonce as string | undefined;
            if (isOwnMessage && nonce) {
              dispatch(confirmPendingMessage({
                nonce,
                channelId: msg.channel_id,
                confirmedMessage: msg,
              }));
            } else if (isOwnMessage) {
              const existingMsgs = store.getState().messages.messagesByChannel[msg.channel_id];
              const alreadyExists = existingMsgs?.some(
                (m) => m.id === msg.id
              );
              if (!alreadyExists) {
                dispatch(addMessage(msg));
              }
            } else {
              dispatch(addMessage(msg));
            }
            if (msg.author?.id) {
              dispatch(removeTypingUser({
                channelId: msg.channel_id,
                userId: msg.author.id,
              }));
            }
            const currentState = store.getState();
            const currentChannelId = currentState.channels.selectedChannelId;
            const currentUserId = currentState.auth.user?.id;
            if (msg.channel_id !== currentChannelId) {
              dispatch(addUnread(msg.channel_id));
              if (currentUserId && Array.isArray(data.mentions)) {
                const mentions = data.mentions as Array<{ id: string }>;
                const mentioned = mentions.some(
                  (m) => m.id === currentUserId
                );
                if (mentioned || data.mention_everyone) {
                  dispatch(addMention(msg.channel_id));
                }
              }
            }
            // Desktop notification when window not focused
            if (
              !isOwnMessage &&
              !document.hasFocus() &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              const notifSettings = store.getState().settings;
              // A message in a guild channel respects the Server Notifications toggle;
              // a DM respects the Message Notifications toggle.
              const isGuildMessage = Boolean(msg.guild_id);
              const notificationTypeEnabled = isGuildMessage
                ? notifSettings.enableServerNotifications
                : notifSettings.enableMessageNotifications;
              if (notifSettings.enableDesktopNotifications && notificationTypeEnabled) {
                const channelInfo = currentState.channels.channels[msg.channel_id];
                const guildInfo = msg.guild_id ? currentState.guilds.guilds[msg.guild_id] : null;
                const channelName = channelInfo?.name ?? 'Direct Message';
                const serverName = guildInfo?.name;
                const authorName = msg.author?.username ?? 'Unknown';
                const preview = msg.content?.length > 100
                  ? msg.content.slice(0, 100) + '...'
                  : (msg.content || '[Attachment]');
                const title = serverName
                  ? `${authorName} in #${channelName} (${serverName})`
                  : `${authorName}`;
                const iconUrl = guildInfo?.icon
                  ? `${cdnBase()}/icons/${guildInfo.id}/${guildInfo.icon}.png?size=64`
                  : undefined;

                const notification = new Notification(title, {
                  body: preview,
                  icon: iconUrl,
                  tag: `msg-${msg.channel_id}`,
                  silent: !notifSettings.enableSounds,
                });
                notification.onclick = () => {
                  window.focus();
                  const targetPath = msg.guild_id
                    ? `/channels/${msg.guild_id}/${msg.channel_id}`
                    : `/channels/@me/${msg.channel_id}`;
                  navigateRef.current(targetPath);
                  notification.close();
                };
              }
            }

            if (msg.channel_id) {
              dispatch(updateDmLastMessage({
                channelId: msg.channel_id,
                messageId: msg.id,
              }));
            }
            break;
          }
          case 'MESSAGE_UPDATE':
            dispatch(updateMessage(data as unknown as Message));
            break;
          case 'MESSAGE_DELETE':
            dispatch(deleteMessage({
              channelId: data.channel_id as string,
              messageId: data.id as string,
            }));
            break;
          case 'MESSAGE_DELETE_BULK':
            dispatch(bulkDeleteMessages({
              channelId: data.channel_id as string,
              messageIds: data.ids as string[],
            }));
            break;
          case 'VOICE_SERVER_UPDATE': {
            // The gateway sends this after we join a voice channel (op 4). It carries
            // the SFU endpoint; establish the real media session now. The channel is
            // whatever we just joined (voice.channelId, set by the join dispatch).
            const endpoint = (data.endpoint as string | undefined) ?? '';
            const guildId = (data.guild_id as string | undefined) ?? '';
            const voiceChannelId = store.getState().voice.channelId;
            if (endpoint && guildId && voiceChannelId) {
              voiceManager.connect({ endpoint, guildId, channelId: voiceChannelId });
            }
            break;
          }
          case 'THREAD_CREATE':
            dispatch(addThread(data as unknown as Parameters<typeof addThread>[0]));
            break;
          case 'THREAD_UPDATE':
            dispatch(updateThreadAction({
              id: data.id as string,
              changes: data as unknown as Parameters<typeof updateThreadAction>[0]['changes'],
            }));
            break;
          case 'THREAD_DELETE':
            // Thread deletion is handled as a channel removal
            break;
          case 'RELATIONSHIP_ADD': {
            const rel = data as unknown as Relationship;
            if (rel.user?.id) {
              dispatch(addRelationship(rel));

              // Desktop notification for an incoming friend request, gated by the
              // Friend Request Notifications toggle (previously nothing ever read it).
              if (
                rel.type === RelationshipType.INCOMING_REQUEST &&
                !document.hasFocus() &&
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                const notifSettings = store.getState().settings;
                if (notifSettings.enableDesktopNotifications && notifSettings.enableFriendRequestNotifications) {
                  const notification = new Notification(`${rel.user.username} sent you a friend request`, {
                    silent: !notifSettings.enableSounds,
                  });
                  notification.onclick = () => {
                    window.focus();
                    notification.close();
                  };
                }
              }
            }
            break;
          }
          case 'RELATIONSHIP_UPDATE': {
            const relUpdate = data as unknown as Relationship;
            if (relUpdate.user?.id) {
              dispatch(updateRelationship(relUpdate));
            }
            break;
          }
          case 'RELATIONSHIP_REMOVE': {
            const relId = data.id as string | undefined;
            if (relId) {
              dispatch(removeRelAction(relId));
            }
            break;
          }
          case 'PRESENCE_UPDATE': {
            const presUserId = (data.user as { id?: string } | undefined)?.id ?? (data.user_id as string | undefined);
            // Our OWN presence is owned locally (seeded online on READY, changed by the
            // status selector). Ignore inbound presence for ourselves — otherwise a server
            // "offline" echo deletes our entry and the member list shows us offline while
            // the user panel (auth.status) still shows online.
            const selfPresId = store.getState().auth.user?.id;
            if (presUserId && presUserId !== selfPresId) {
              dispatch(setPresence({
                userId: presUserId,
                status: (data.status as UserPresence['status']) ?? 'offline',
                clientStatus: (data.client_status as UserPresence['clientStatus']) ?? {},
                activities: (data.activities as UserPresence['activities']) ?? [],
              }));
            }
            break;
          }
          case 'USER_UPDATE': {
            // A user changed their profile. Names are denormalized into several caches
            // (message authors, voice roster, member lists), so fan the new identity out
            // to each — otherwise the old name lingers until reload.
            const u = ((data.user as Record<string, unknown> | undefined) ?? data) as {
              id?: string; username?: string; global_name?: string | null; avatar?: string | null;
            };
            const uid = u.id;
            if (uid) {
              const selfUser = store.getState().auth.user;
              if (selfUser && selfUser.id === uid) {
                dispatch(setUser({
                  ...selfUser,
                  username: u.username ?? selfUser.username,
                  global_name: u.global_name ?? selfUser.global_name,
                  avatar: u.avatar ?? selfUser.avatar,
                }));
              }
              dispatch(updateAuthorIdentity({ userId: uid, username: u.username, global_name: u.global_name, avatar: u.avatar }));
              dispatch(updateVoiceUserIdentity({ userId: uid, username: u.username, avatar: u.avatar }));
              dispatch(updateMemberUser({ userId: uid, username: u.username, displayName: u.global_name, avatar: u.avatar }));
            }
            break;
          }
          case 'GATEWAY_CLOSE':
            // Non-recoverable gateway close -- could trigger re-auth flow
            break;
        }
      });
      return () => gateway.disconnect();
    }
  }, [isAuthenticated, token, dispatch]);

  // Standalone window controls for the frameless Electron window on the auth
  // screens (which don't render the app TitleBar). Hidden inside the app shell,
  // which draws its own; renders nothing in a browser.
  const inAppShell = isAuthenticated && location.pathname.startsWith('/channels');

  // Show loading screen while restoring session
  if (appLoading) return (<><WindowControls /><LoadingScreen /></>);

  return (
    <>
      {!inAppShell && <WindowControls />}
      <Routes>
      <Route path="/login" element={
        isAuthenticated ? <Navigate to="/channels/@me" replace /> : <LoginPage onNavigateToRegister={() => navigate('/register')} onNavigateToForgotPassword={() => navigate('/forgot-password')} />
      } />
      <Route path="/register" element={
        isAuthenticated ? <Navigate to="/channels/@me" replace /> : <RegisterPage onNavigateToLogin={() => navigate('/login')} />
      } />
      <Route path="/forgot-password" element={
        <ForgotPasswordPage onNavigateToLogin={() => navigate('/login')} />
      } />
      <Route path="/reset-password/:token" element={
        <ResetPasswordRouteWrapper />
      } />
      <Route path="/verify/:token" element={
        <VerifyEmailRouteWrapper />
      } />
      <Route path="/channels/@me/:channelId" element={
        isAuthenticated ? <ChannelsLayout /> : <Navigate to="/login" replace />
      } />
      <Route path="/channels/@me" element={
        isAuthenticated ? <ChannelsLayout /> : <Navigate to="/login" replace />
      } />
      <Route path="/channels/:guildId/:channelId" element={
        isAuthenticated ? <ChannelsLayout /> : <Navigate to="/login" replace />
      } />
      <Route path="/channels/:guildId" element={
        isAuthenticated ? <ChannelsLayout /> : <Navigate to="/login" replace />
      } />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/invite/:code" element={<InviteAcceptPage />} />
      <Route path="/:code" element={<InviteAcceptPage />} />
      <Route path="/" element={<AuthRedirect />} />
      {/* Unknown multi-segment paths fall back to the auth-aware root redirect. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
};

/** Wrapper to extract route params for ResetPasswordPage */
const ResetPasswordRouteWrapper = () => {
  const navigate = useNavigate();
  // Use window.location to get the token since useParams is within Routes
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1] ?? '';
  return <ResetPasswordPage token={token} onNavigateToLogin={() => navigate('/login')} />;
};

/** Wrapper to extract route params for VerifyEmailPage */
const VerifyEmailRouteWrapper = () => {
  const navigate = useNavigate();
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1] ?? '';
  return <VerifyEmailPage token={token} onNavigateToLogin={() => navigate('/login')} />;
};

export const App = () => (
  <Provider store={store}>
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  </Provider>
);
