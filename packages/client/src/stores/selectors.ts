import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';

/**
 * Memoized selector for guild list as an array.
 * Avoids creating a new array reference on every render from Object.values().
 */
export const selectGuildList = createSelector(
  (state: RootState) => state.guilds.guilds,
  (guilds) => Object.values(guilds)
);

/**
 * Memoized selector for channels filtered by the selected guild.
 */
export const selectChannelsForSelectedGuild = createSelector(
  (state: RootState) => state.channels.channels,
  (state: RootState) => state.guilds.selectedGuildId,
  (channels, selectedGuildId) =>
    Object.values(channels).filter(c => c.guild_id === selectedGuildId)
);

/**
 * Memoized selector for messages by channel ID.
 * Returns a stable empty array when there are no messages.
 */
const EMPTY_MESSAGES: never[] = [];

export const selectMessagesByChannel = createSelector(
  (state: RootState) => state.messages.messagesByChannel,
  (_state: RootState, channelId: string | null) => channelId,
  (messagesByChannel, channelId) =>
    channelId ? messagesByChannel[channelId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
);

/**
 * Memoized selector for typing users by channel ID.
 * Returns a stable empty array when nobody is typing.
 */
const EMPTY_TYPING: never[] = [];

export const selectTypingUsersByChannel = createSelector(
  (state: RootState) => state.typing.typingByChannel,
  (_state: RootState, channelId: string) => channelId,
  (typingByChannel, channelId) =>
    typingByChannel[channelId] ?? EMPTY_TYPING
);

/**
 * Memoized selector for roles by guild ID.
 * Returns a stable empty array when there are no roles.
 */
const EMPTY_ROLES: never[] = [];

export const selectRolesByGuild = createSelector(
  (state: RootState) => state.roles.rolesByGuild,
  (_state: RootState, guildId: string | null) => guildId,
  (rolesByGuild, guildId) =>
    guildId ? rolesByGuild[guildId] ?? EMPTY_ROLES : EMPTY_ROLES
);

/**
 * Memoized selector for members by guild ID.
 * Returns a stable empty array when there are no members.
 */
const EMPTY_MEMBERS: never[] = [];

export const selectMembersByGuild = createSelector(
  (state: RootState) => state.members.membersByGuild,
  (_state: RootState, guildId: string | null) => guildId,
  (membersByGuild, guildId) =>
    guildId ? membersByGuild[guildId] ?? EMPTY_MEMBERS : EMPTY_MEMBERS
);

/**
 * Select presence for a single user by ID.
 * Returns undefined if the user has no presence entry (treat as offline).
 */
export const selectPresenceByUserId = (state: RootState, userId: string) =>
  state.presence.presences[userId];

/**
 * Select the entire presences map (useful when components need bulk access).
 */
export const selectPresences = (state: RootState) => state.presence.presences;

/**
 * Select the user's own self-set status (includes 'invisible').
 */
export const selectSelfStatus = (state: RootState) => state.presence.selfStatus;
