import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** The single UI theme. */
export type ThemeName = 'relay';

/** Normalise any stored/legacy theme value to a valid ThemeName (legacy 'dark'/'light' → default). */
export function normalizeTheme(_value: unknown): ThemeName {
  return 'relay';
}

/** Apply the active theme to the document root so the CSS custom properties swap. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
}

interface Keybind {
  action: string;
  key: string;
}

interface SettingsState {
  theme: ThemeName;
  fontSize: number;
  messageDisplayMode: 'cozy' | 'compact';
  enableDesktopNotifications: boolean;
  enableSounds: boolean;
  enableMessageNotifications: boolean;
  enableFriendRequestNotifications: boolean;
  enableServerNotifications: boolean;
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  inputMode: 'voiceActivity' | 'pushToTalk';
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  voiceSensitivity: number;
  videoDevice: string;
  keybinds: Keybind[];
  // Accessibility
  reducedMotion: boolean;
  saturation: number;
  showRoleColors: boolean;
  showLinkPreviews: boolean;
  enableTTS: boolean;
  highContrast: boolean;
  // Chat (Text & Images)
  autoPlayGifs: boolean;
  showEmbeds: boolean;
  showEmojiReactions: boolean;
  convertEmoticons: boolean;
  // Developer mode
  developerMode: boolean;
  // Per-guild: hide muted channels
  hideMutedChannelsByGuild: Record<string, boolean>;
  // Language
  locale: string;
  // Streamer mode
  streamerMode: boolean;
  autoEnableStreamerMode: boolean;
  hidePersonalInfo: boolean;
  hideInviteLinks: boolean;
  disableSoundsStreamer: boolean;
  disableNotificationsStreamer: boolean;
  // Privacy & Safety
  safeDMs: boolean;
  allowDMsFromServerMembers: boolean;
  friendRequestSource: 'everyone' | 'friendsOfFriends' | 'serverMembers';
  messageRequests: boolean;
}

const DEFAULT_KEYBINDS: Keybind[] = [
  { action: 'Toggle Mute', key: 'Ctrl+Shift+M' },
  { action: 'Toggle Deafen', key: 'Ctrl+Shift+D' },
  { action: 'Push to Talk', key: '' },
  { action: 'Navigate Back', key: 'Alt+ArrowLeft' },
  { action: 'Navigate Forward', key: 'Alt+ArrowRight' },
  { action: 'Mark as Read', key: 'Escape' },
  { action: 'Search', key: 'Ctrl+F' },
];

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const initialState: SettingsState = {
  theme: normalizeTheme(loadSetting<string>('settings_theme', 'relay')),
  fontSize: loadSetting<number>('settings_fontSize', 16),
  messageDisplayMode: loadSetting<'cozy' | 'compact'>('settings_messageDisplayMode', 'cozy'),
  enableDesktopNotifications: loadSetting<boolean>('settings_enableDesktopNotifications', true),
  enableSounds: loadSetting<boolean>('settings_enableSounds', true),
  enableMessageNotifications: loadSetting<boolean>('settings_enableMessageNotifications', true),
  enableFriendRequestNotifications: loadSetting<boolean>('settings_enableFriendRequestNotifications', true),
  enableServerNotifications: loadSetting<boolean>('settings_enableServerNotifications', true),
  inputDevice: loadSetting<string>('settings_inputDevice', 'default'),
  outputDevice: loadSetting<string>('settings_outputDevice', 'default'),
  inputVolume: loadSetting<number>('settings_inputVolume', 100),
  outputVolume: loadSetting<number>('settings_outputVolume', 100),
  inputMode: loadSetting<'voiceActivity' | 'pushToTalk'>('settings_inputMode', 'voiceActivity'),
  echoCancellation: loadSetting<boolean>('settings_echoCancellation', true),
  noiseSuppression: loadSetting<boolean>('settings_noiseSuppression', true),
  autoGainControl: loadSetting<boolean>('settings_autoGainControl', true),
  voiceSensitivity: loadSetting<number>('settings_voiceSensitivity', 25),
  videoDevice: loadSetting<string>('settings_videoDevice', 'default'),
  keybinds: loadSetting<Keybind[]>('settings_keybinds', DEFAULT_KEYBINDS),
  // Accessibility
  reducedMotion: loadSetting<boolean>('settings_reducedMotion', false),
  saturation: loadSetting<number>('settings_saturation', 100),
  showRoleColors: loadSetting<boolean>('settings_showRoleColors', true),
  showLinkPreviews: loadSetting<boolean>('settings_showLinkPreviews', true),
  enableTTS: loadSetting<boolean>('settings_enableTTS', false),
  highContrast: loadSetting<boolean>('settings_highContrast', false),
  // Chat (Text & Images)
  autoPlayGifs: loadSetting<boolean>('settings_autoPlayGifs', true),
  showEmbeds: loadSetting<boolean>('settings_showEmbeds', true),
  showEmojiReactions: loadSetting<boolean>('settings_showEmojiReactions', true),
  convertEmoticons: loadSetting<boolean>('settings_convertEmoticons', true),
  developerMode: loadSetting<boolean>('settings_developerMode', false),
  hideMutedChannelsByGuild: loadSetting<Record<string, boolean>>('settings_hideMutedChannelsByGuild', {}),
  // Language
  locale: loadSetting<string>('settings_locale', 'en-US'),
  // Streamer mode
  streamerMode: loadSetting<boolean>('settings_streamerMode', false),
  autoEnableStreamerMode: loadSetting<boolean>('settings_autoEnableStreamerMode', false),
  hidePersonalInfo: loadSetting<boolean>('settings_hidePersonalInfo', true),
  hideInviteLinks: loadSetting<boolean>('settings_hideInviteLinks', true),
  disableSoundsStreamer: loadSetting<boolean>('settings_disableSoundsStreamer', true),
  disableNotificationsStreamer: loadSetting<boolean>('settings_disableNotificationsStreamer', true),
  // Privacy & Safety
  safeDMs: loadSetting<boolean>('settings_safeDMs', true),
  allowDMsFromServerMembers: loadSetting<boolean>('settings_allowDMsFromServerMembers', true),
  friendRequestSource: loadSetting<'everyone' | 'friendsOfFriends' | 'serverMembers'>('settings_friendRequestSource', 'everyone'),
  messageRequests: loadSetting<boolean>('settings_messageRequests', true),
};

function persist(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<ThemeName>) => {
      state.theme = action.payload;
      persist('settings_theme', action.payload);
      applyTheme(action.payload);
    },
    setFontSize: (state, action: PayloadAction<number>) => {
      state.fontSize = action.payload;
      persist('settings_fontSize', action.payload);
      document.documentElement.style.setProperty('--chat-font-scale', `${action.payload}px`);
    },
    setMessageDisplayMode: (state, action: PayloadAction<'cozy' | 'compact'>) => {
      state.messageDisplayMode = action.payload;
      persist('settings_messageDisplayMode', action.payload);
    },
    setEnableDesktopNotifications: (state, action: PayloadAction<boolean>) => {
      state.enableDesktopNotifications = action.payload;
      persist('settings_enableDesktopNotifications', action.payload);
    },
    setEnableSounds: (state, action: PayloadAction<boolean>) => {
      state.enableSounds = action.payload;
      persist('settings_enableSounds', action.payload);
    },
    setEnableMessageNotifications: (state, action: PayloadAction<boolean>) => {
      state.enableMessageNotifications = action.payload;
      persist('settings_enableMessageNotifications', action.payload);
    },
    setEnableFriendRequestNotifications: (state, action: PayloadAction<boolean>) => {
      state.enableFriendRequestNotifications = action.payload;
      persist('settings_enableFriendRequestNotifications', action.payload);
    },
    setEnableServerNotifications: (state, action: PayloadAction<boolean>) => {
      state.enableServerNotifications = action.payload;
      persist('settings_enableServerNotifications', action.payload);
    },
    setInputDevice: (state, action: PayloadAction<string>) => {
      state.inputDevice = action.payload;
      persist('settings_inputDevice', action.payload);
    },
    setOutputDevice: (state, action: PayloadAction<string>) => {
      state.outputDevice = action.payload;
      persist('settings_outputDevice', action.payload);
    },
    setInputVolume: (state, action: PayloadAction<number>) => {
      state.inputVolume = action.payload;
      persist('settings_inputVolume', action.payload);
    },
    setOutputVolume: (state, action: PayloadAction<number>) => {
      state.outputVolume = action.payload;
      persist('settings_outputVolume', action.payload);
    },
    setInputMode: (state, action: PayloadAction<'voiceActivity' | 'pushToTalk'>) => {
      state.inputMode = action.payload;
      persist('settings_inputMode', action.payload);
    },
    setEchoCancellation: (state, action: PayloadAction<boolean>) => {
      state.echoCancellation = action.payload;
      persist('settings_echoCancellation', action.payload);
    },
    setNoiseSuppression: (state, action: PayloadAction<boolean>) => {
      state.noiseSuppression = action.payload;
      persist('settings_noiseSuppression', action.payload);
    },
    setAutoGainControl: (state, action: PayloadAction<boolean>) => {
      state.autoGainControl = action.payload;
      persist('settings_autoGainControl', action.payload);
    },
    setVoiceSensitivity: (state, action: PayloadAction<number>) => {
      state.voiceSensitivity = action.payload;
      persist('settings_voiceSensitivity', action.payload);
    },
    setVideoDevice: (state, action: PayloadAction<string>) => {
      state.videoDevice = action.payload;
      persist('settings_videoDevice', action.payload);
    },
    setKeybind: (state, action: PayloadAction<{ index: number; key: string }>) => {
      const { index, key } = action.payload;
      if (state.keybinds[index]) {
        state.keybinds[index].key = key;
        persist('settings_keybinds', state.keybinds);
      }
    },
    resetKeybinds: (state) => {
      state.keybinds = DEFAULT_KEYBINDS;
      persist('settings_keybinds', DEFAULT_KEYBINDS);
    },
    // Accessibility reducers
    setReducedMotion: (state, action: PayloadAction<boolean>) => {
      state.reducedMotion = action.payload;
      persist('settings_reducedMotion', action.payload);
      if (action.payload) {
        document.body.classList.add('reduced-motion');
      } else {
        document.body.classList.remove('reduced-motion');
      }
    },
    setSaturation: (state, action: PayloadAction<number>) => {
      state.saturation = action.payload;
      persist('settings_saturation', action.payload);
      document.documentElement.style.setProperty('--saturation', `${action.payload}%`);
    },
    setShowRoleColors: (state, action: PayloadAction<boolean>) => {
      state.showRoleColors = action.payload;
      persist('settings_showRoleColors', action.payload);
    },
    setShowLinkPreviews: (state, action: PayloadAction<boolean>) => {
      state.showLinkPreviews = action.payload;
      persist('settings_showLinkPreviews', action.payload);
    },
    setEnableTTS: (state, action: PayloadAction<boolean>) => {
      state.enableTTS = action.payload;
      persist('settings_enableTTS', action.payload);
    },
    setAutoPlayGifs: (state, action: PayloadAction<boolean>) => {
      state.autoPlayGifs = action.payload;
      persist('settings_autoPlayGifs', action.payload);
    },
    setShowEmbeds: (state, action: PayloadAction<boolean>) => {
      state.showEmbeds = action.payload;
      persist('settings_showEmbeds', action.payload);
    },
    setShowEmojiReactions: (state, action: PayloadAction<boolean>) => {
      state.showEmojiReactions = action.payload;
      persist('settings_showEmojiReactions', action.payload);
    },
    setConvertEmoticons: (state, action: PayloadAction<boolean>) => {
      state.convertEmoticons = action.payload;
      persist('settings_convertEmoticons', action.payload);
    },
    toggleHideMutedChannels: (state, action: PayloadAction<string>) => {
      const guildId = action.payload;
      const current = state.hideMutedChannelsByGuild[guildId] ?? false;
      state.hideMutedChannelsByGuild[guildId] = !current;
      persist('settings_hideMutedChannelsByGuild', state.hideMutedChannelsByGuild);
    },
    setDeveloperMode: (state, action: PayloadAction<boolean>) => {
      state.developerMode = action.payload;
      persist('settings_developerMode', action.payload);
    },
    setHighContrast: (state, action: PayloadAction<boolean>) => {
      state.highContrast = action.payload;
      persist('settings_highContrast', action.payload);
      if (action.payload) {
        document.body.classList.add('high-contrast');
      } else {
        document.body.classList.remove('high-contrast');
      }
    },
    // Language
    setLocale: (state, action: PayloadAction<string>) => {
      state.locale = action.payload;
      persist('settings_locale', action.payload);
    },
    // Streamer mode
    setStreamerMode: (state, action: PayloadAction<boolean>) => {
      state.streamerMode = action.payload;
      persist('settings_streamerMode', action.payload);
    },
    setAutoEnableStreamerMode: (state, action: PayloadAction<boolean>) => {
      state.autoEnableStreamerMode = action.payload;
      persist('settings_autoEnableStreamerMode', action.payload);
    },
    setHidePersonalInfo: (state, action: PayloadAction<boolean>) => {
      state.hidePersonalInfo = action.payload;
      persist('settings_hidePersonalInfo', action.payload);
    },
    setHideInviteLinks: (state, action: PayloadAction<boolean>) => {
      state.hideInviteLinks = action.payload;
      persist('settings_hideInviteLinks', action.payload);
    },
    setDisableSoundsStreamer: (state, action: PayloadAction<boolean>) => {
      state.disableSoundsStreamer = action.payload;
      persist('settings_disableSoundsStreamer', action.payload);
    },
    setDisableNotificationsStreamer: (state, action: PayloadAction<boolean>) => {
      state.disableNotificationsStreamer = action.payload;
      persist('settings_disableNotificationsStreamer', action.payload);
    },
    // Privacy & Safety
    setSafeDMs: (state, action: PayloadAction<boolean>) => {
      state.safeDMs = action.payload;
      persist('settings_safeDMs', action.payload);
    },
    setAllowDMsFromServerMembers: (state, action: PayloadAction<boolean>) => {
      state.allowDMsFromServerMembers = action.payload;
      persist('settings_allowDMsFromServerMembers', action.payload);
    },
    setFriendRequestSource: (state, action: PayloadAction<'everyone' | 'friendsOfFriends' | 'serverMembers'>) => {
      state.friendRequestSource = action.payload;
      persist('settings_friendRequestSource', action.payload);
    },
    setMessageRequests: (state, action: PayloadAction<boolean>) => {
      state.messageRequests = action.payload;
      persist('settings_messageRequests', action.payload);
    },
  },
});

export const {
  setTheme,
  setFontSize,
  setMessageDisplayMode,
  setEnableDesktopNotifications,
  setEnableSounds,
  setEnableMessageNotifications,
  setEnableFriendRequestNotifications,
  setEnableServerNotifications,
  setInputDevice,
  setOutputDevice,
  setInputVolume,
  setOutputVolume,
  setInputMode,
  setEchoCancellation,
  setNoiseSuppression,
  setAutoGainControl,
  setVoiceSensitivity,
  setVideoDevice,
  setKeybind,
  resetKeybinds,
  setReducedMotion,
  setSaturation,
  setShowRoleColors,
  setShowLinkPreviews,
  setEnableTTS,
  setAutoPlayGifs,
  setShowEmbeds,
  setShowEmojiReactions,
  setConvertEmoticons,
  setDeveloperMode,
  setHighContrast,
  toggleHideMutedChannels,
  setLocale,
  setStreamerMode,
  setAutoEnableStreamerMode,
  setHidePersonalInfo,
  setHideInviteLinks,
  setDisableSoundsStreamer,
  setDisableNotificationsStreamer,
  setSafeDMs,
  setAllowDMsFromServerMembers,
  setFriendRequestSource,
  setMessageRequests,
} = settingsSlice.actions;
