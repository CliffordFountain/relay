import { useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from './useAppDispatch';
import { selectGuild, clearSelectedGuild } from '../stores/guildsSlice';
import { selectChannel, clearSelectedChannel } from '../stores/channelsSlice';
import { selectDmChannel } from '../stores/dmSlice';

/**
 * Synchronizes React Router URL params with Redux state.
 *
 * When URL changes (browser back/forward, direct navigation):
 *   - Extracts guildId and channelId from URL params
 *   - Dispatches selectGuild/selectChannel to Redux
 *
 * When Redux state changes (user clicks guild/channel):
 *   - The click handlers use navigate() directly, so no reverse sync needed here
 */
export const useRouteSync = (): void => {
  const dispatch = useAppDispatch();
  const params = useParams<{ guildId?: string; channelId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const selectedChannelId = useAppSelector(s => s.channels.selectedChannelId);
  const channels = useAppSelector(s => s.channels.channels);
  const appLoading = useAppSelector(s => s.ui.appLoading);

  // Track whether we're currently processing a URL change to prevent loops
  const isSyncingFromUrl = useRef(false);

  // Sync URL params -> Redux state
  useEffect(() => {
    if (appLoading) return;

    const isDmRoute = location.pathname.startsWith('/channels/@me');
    const urlGuildId = isDmRoute ? null : (params.guildId ?? null);
    const urlChannelId = params.channelId ?? null;

    isSyncingFromUrl.current = true;

    if (isDmRoute) {
      // DM route: clear guild, set DM channel if provided
      if (selectedGuildId !== null) {
        dispatch(clearSelectedGuild());
      }
      if (urlChannelId) {
        dispatch(selectDmChannel(urlChannelId));
        dispatch(selectChannel(urlChannelId));
      } else {
        dispatch(selectDmChannel(null));
        dispatch(clearSelectedChannel());
      }
    } else if (urlGuildId) {
      // Guild route
      if (selectedGuildId !== urlGuildId) {
        dispatch(selectGuild(urlGuildId));
      }
      if (urlChannelId) {
        if (selectedChannelId !== urlChannelId) {
          dispatch(selectChannel(urlChannelId));
        }
      } else {
        // Guild without channel: auto-select first text channel
        const guildChannels = Object.values(channels)
          .filter(c => c.guild_id === urlGuildId && c.type === 0)
          .sort((a, b) => a.position - b.position);
        const firstChannel = guildChannels[0];
        if (firstChannel) {
          navigate(`/channels/${urlGuildId}/${firstChannel.id}`, { replace: true });
        }
      }
    }

    // Use a microtask to reset the flag after dispatch completes
    queueMicrotask(() => {
      isSyncingFromUrl.current = false;
    });
  }, [
    params.guildId,
    params.channelId,
    location.pathname,
    appLoading,
    dispatch,
    navigate,
    channels,
    selectedGuildId,
    selectedChannelId,
  ]);
};
