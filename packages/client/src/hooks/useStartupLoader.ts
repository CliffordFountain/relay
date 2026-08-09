import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from './useAppDispatch';
import { setAuth, logout } from '../stores/authSlice';
import { setGuilds, selectGuild } from '../stores/guildsSlice';
import { setChannels, selectChannel } from '../stores/channelsSlice';
import { setAppLoading } from '../stores/uiSlice';
import { api } from '../api/rest';

const LAST_GUILD_KEY = 'lastSelectedGuildId';
const LAST_CHANNEL_KEY = 'lastSelectedChannelId';

/**
 * Persists the last-selected guild and channel IDs to localStorage
 * so they can be restored on next page load.
 */
export const saveLastSelection = (guildId: string | null, channelId: string | null): void => {
  if (guildId) {
    localStorage.setItem(LAST_GUILD_KEY, guildId);
  } else {
    localStorage.removeItem(LAST_GUILD_KEY);
  }
  if (channelId) {
    localStorage.setItem(LAST_CHANNEL_KEY, channelId);
  } else {
    localStorage.removeItem(LAST_CHANNEL_KEY);
  }
};

export const getLastSelection = (): { guildId: string | null; channelId: string | null } => ({
  guildId: localStorage.getItem(LAST_GUILD_KEY),
  channelId: localStorage.getItem(LAST_CHANNEL_KEY),
});

/**
 * Parse guild and channel IDs from a /channels/:guildId/:channelId URL path.
 * Returns null values for non-channel paths or @me paths.
 */
function parseChannelPath(pathname: string): { guildId: string | null; channelId: string | null } {
  const match = pathname.match(/^\/channels\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return { guildId: null, channelId: null };
  const guildIdOrMe = match[1] ?? null;
  const channelId = match[2] ?? null;
  if (guildIdOrMe === '@me') return { guildId: null, channelId };
  return { guildId: guildIdOrMe, channelId };
}

/**
 * Hook that runs the startup data loading sequence:
 * 1. Check localStorage for auth token
 * 2. Validate token by fetching GET /users/@me
 * 3. Fetch all guilds via GET /users/@me/guilds
 * 4. Fetch channels for each guild
 * 5. Restore selection from URL, localStorage, or auto-select first
 * 6. Navigate to the correct URL
 * 7. Set appLoading = false when done
 */
export const useStartupLoader = (): void => {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const hasRun = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (hasRun.current) return;

    const savedToken = localStorage.getItem('token');
    if (!savedToken) {
      dispatch(setAppLoading(false));
      return;
    }

    hasRun.current = true;
    api.setToken(savedToken);

    const loadStartupData = async (): Promise<void> => {
      try {
        // Step 1+2: Validate token and fetch guilds in parallel
        const [user, guildsRaw] = await Promise.all([api.getMe(), api.getMyGuilds()]);
        dispatch(setAuth({ token: savedToken, user }));
        // /users/@me/guilds returns `owner: bool` (as expected).
        // Derive `owner_id` so permission checks work for the current user.
        const guilds = (guildsRaw as Array<Record<string, unknown>>).map(g => ({
          id: String(g.id ?? ''),
          name: String(g.name ?? ''),
          icon: (g.icon as string | null) ?? null,
          owner_id: g.owner_id ? String(g.owner_id) : (g.owner === true ? user.id : ''),
          member_count: Number(g.member_count ?? g.approximate_member_count ?? 0),
        }));
        dispatch(setGuilds(guilds));

        // Step 3: Fetch channels for all guilds in parallel
        const channelResults = await Promise.allSettled(
          guilds.map(g => api.getGuildChannels(g.id))
        );

        const allChannels: Array<{
          id: string;
          guild_id: string | null;
          type: number;
          name: string | null;
          topic: string | null;
          position: number;
          parent_id: string | null;
        }> = [];
        for (const result of channelResults) {
          if (result.status === 'fulfilled') {
            allChannels.push(...result.value);
          }
        }
        if (allChannels.length > 0) {
          dispatch(setChannels(allChannels));
        }

        // Step 4: Determine where to navigate
        // Skip navigation if on a special page (invite accept, etc.)
        // Matches /invite/CODE and /CODE (short invite links like relay.gg/CODE)
        const isInvitePath = location.pathname.startsWith('/invite/') ||
          (location.pathname.match(/^\/[a-zA-Z0-9]{6,12}$/) !== null);
        if (isInvitePath) {
          dispatch(setAppLoading(false));
          return;
        }
        // Priority: URL path > localStorage > auto-select first
        const urlSelection = parseChannelPath(location.pathname);
        const { guildId: lastGuildId, channelId: lastChannelId } = getLastSelection();

        // Check if the current URL already specifies a guild/channel
        if (urlSelection.guildId && guilds.some(g => g.id === urlSelection.guildId)) {
          const guildId = urlSelection.guildId;
          dispatch(selectGuild(guildId));

          const guildChannels = allChannels
            .filter(c => c.guild_id === guildId && c.type === 0)
            .sort((a, b) => a.position - b.position);

          if (urlSelection.channelId && allChannels.some(c => c.id === urlSelection.channelId)) {
            dispatch(selectChannel(urlSelection.channelId));
            // URL is already correct, no navigation needed
          } else {
            // Guild in URL but no valid channel - auto-select first
            const firstChannel = guildChannels[0];
            if (firstChannel) {
              dispatch(selectChannel(firstChannel.id));
              navigate(`/channels/${guildId}/${firstChannel.id}`, { replace: true });
            }
          }
        } else if (lastGuildId && guilds.some(g => g.id === lastGuildId)) {
          // Restore from localStorage
          dispatch(selectGuild(lastGuildId));

          const guildChannels = allChannels
            .filter(c => c.guild_id === lastGuildId && c.type === 0)
            .sort((a, b) => a.position - b.position);

          if (lastChannelId && guildChannels.some(c => c.id === lastChannelId)) {
            dispatch(selectChannel(lastChannelId));
            navigate(`/channels/${lastGuildId}/${lastChannelId}`, { replace: true });
          } else {
            const firstChannel = guildChannels[0];
            if (firstChannel) {
              dispatch(selectChannel(firstChannel.id));
              navigate(`/channels/${lastGuildId}/${firstChannel.id}`, { replace: true });
            } else {
              navigate(`/channels/${lastGuildId}`, { replace: true });
            }
          }
        } else if (guilds.length > 0) {
          // No saved selection, auto-select first guild
          const firstGuild = guilds[0];
          if (firstGuild) {
            dispatch(selectGuild(firstGuild.id));
            const guildChannels = allChannels
              .filter(c => c.guild_id === firstGuild.id && c.type === 0)
              .sort((a, b) => a.position - b.position);
            const firstChannel = guildChannels[0];
            if (firstChannel) {
              dispatch(selectChannel(firstChannel.id));
              navigate(`/channels/${firstGuild.id}/${firstChannel.id}`, { replace: true });
            } else {
              navigate(`/channels/${firstGuild.id}`, { replace: true });
            }
          }
        } else {
          // No guilds at all - go to DM view
          navigate('/channels/@me', { replace: true });
        }
      } catch {
        // Token is invalid or API is down - clear auth
        localStorage.removeItem('token');
        api.clearToken();
        dispatch(logout());
      } finally {
        dispatch(setAppLoading(false));
      }
    };

    void loadStartupData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, isAuthenticated]);
};
