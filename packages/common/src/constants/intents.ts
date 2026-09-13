/** Gateway intents. */
export const GatewayIntent = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,           // Privileged
  GuildModeration: 1 << 2,
  GuildExpressions: 1 << 3,       // Renamed from GuildEmojisAndStickers
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,         // Privileged
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,        // Privileged
  GuildScheduledEvents: 1 << 16,
  AutoModerationConfiguration: 1 << 20,
  AutoModerationExecution: 1 << 21,
  GuildMessagePolls: 1 << 24,
  DirectMessagePolls: 1 << 25,
} as const;

/** @deprecated Use GuildExpressions instead */
export const GuildEmojisAndStickers = 1 << 3;

export type GatewayIntentValue = (typeof GatewayIntent)[keyof typeof GatewayIntent];

/** Intents that require explicit approval (privileged). */
export const PRIVILEGED_INTENTS =
  GatewayIntent.GuildMembers |
  GatewayIntent.GuildPresences |
  GatewayIntent.MessageContent;

/** All non-privileged intents combined. */
export const ALL_INTENTS = Object.values(GatewayIntent).reduce((acc, v) => acc | v, 0);
