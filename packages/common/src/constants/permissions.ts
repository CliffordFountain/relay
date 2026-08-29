/**
 * Permission bitfield flags, matching the gateway protocol.
 * Stored as BIGINT (64-bit) in the database.
 * Using bigint in TypeScript to match.
 */
export const Permission = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  PrioritySpeaker: 1n << 8n,
  Stream: 1n << 9n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  SendTTSMessages: 1n << 12n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  UseExternalEmojis: 1n << 18n,
  ViewGuildInsights: 1n << 19n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  UseVAD: 1n << 25n,
  ChangeNickname: 1n << 26n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n,
  UseApplicationCommands: 1n << 31n,
  RequestToSpeak: 1n << 32n,
  ManageEvents: 1n << 33n,
  ManageThreads: 1n << 34n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
  UseExternalStickers: 1n << 37n,
  SendMessagesInThreads: 1n << 38n,
  UseEmbeddedActivities: 1n << 39n,
  ModerateMembers: 1n << 40n,
  ViewCreatorMonetizationAnalytics: 1n << 41n,
  UseSoundboard: 1n << 42n,
  CreateGuildExpressions: 1n << 43n,
  CreateEvents: 1n << 44n,
  UseExternalSounds: 1n << 45n,
  SendVoiceMessages: 1n << 46n,
  SetVoiceChannelStatus: 1n << 48n,
  SendPolls: 1n << 49n,
  UseExternalApps: 1n << 50n,
  PinMessages: 1n << 51n,
  BypassSlowmode: 1n << 52n,
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

/** All permissions combined. */
export const ALL_PERMISSIONS = Object.values(Permission).reduce((acc, v) => acc | v, 0n);

/**
 * Default permissions for @everyone role on new guilds.
 * Matches the default: ~1071698529857n
 * Includes: CREATE_INSTANT_INVITE, ADD_REACTIONS, STREAM, VIEW_CHANNEL, SEND_MESSAGES,
 * SEND_TTS_MESSAGES, EMBED_LINKS, ATTACH_FILES, READ_MESSAGE_HISTORY, MENTION_EVERYONE,
 * USE_EXTERNAL_EMOJIS, CONNECT, SPEAK, USE_VAD, CHANGE_NICKNAME, USE_APPLICATION_COMMANDS,
 * CREATE_PUBLIC_THREADS, CREATE_PRIVATE_THREADS, USE_EXTERNAL_STICKERS, SEND_MESSAGES_IN_THREADS
 */
export const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.CreateInstantInvite |
  Permission.AddReactions |
  Permission.Stream |
  Permission.ViewChannel |
  Permission.SendMessages |
  Permission.SendTTSMessages |
  Permission.EmbedLinks |
  Permission.AttachFiles |
  Permission.ReadMessageHistory |
  Permission.MentionEveryone |
  Permission.UseExternalEmojis |
  Permission.Connect |
  Permission.Speak |
  Permission.UseVAD |
  Permission.ChangeNickname |
  Permission.UseApplicationCommands |
  Permission.CreatePublicThreads |
  Permission.CreatePrivateThreads |
  Permission.UseExternalStickers |
  Permission.SendMessagesInThreads;
