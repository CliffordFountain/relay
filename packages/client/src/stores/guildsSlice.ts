import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  banner?: string | null;
  splash?: string | null;
  owner_id: string;
  member_count: number;
  description?: string | null;
  region?: string;
  premium_tier?: number;
  premium_subscription_count?: number;
}

export interface GuildFolder {
  id: string;
  guildIds: string[];
  name: string | null;
  color: number | null;
  expanded: boolean;
}

interface GuildsState {
  guilds: Record<string, Guild>;
  selectedGuildId: string | null;
  folders: GuildFolder[];
}

const initialState: GuildsState = { guilds: {}, selectedGuildId: null, folders: [] };

export const guildsSlice = createSlice({
  name: 'guilds',
  initialState,
  reducers: {
    addGuild: (state, action: PayloadAction<Guild>) => {
      state.guilds[action.payload.id] = action.payload;
    },
    setGuilds: (state, action: PayloadAction<Guild[]>) => {
      action.payload.forEach(g => { state.guilds[g.id] = g; });
    },
    removeGuild: (state, action: PayloadAction<string>) => {
      delete state.guilds[action.payload];
      if (state.selectedGuildId === action.payload) state.selectedGuildId = null;
    },
    selectGuild: (state, action: PayloadAction<string>) => {
      state.selectedGuildId = action.payload;
    },
    clearSelectedGuild: (state) => {
      state.selectedGuildId = null;
    },
    updateGuild: (state, action: PayloadAction<{ id: string; changes: Partial<Guild> }>) => {
      const guild = state.guilds[action.payload.id];
      if (guild) {
        Object.assign(guild, action.payload.changes);
      }
    },
    // === FOLDER ACTIONS ===
    createFolder: (state, action: PayloadAction<{ id: string; guildIds: string[]; name?: string; color?: number }>) => {
      const { id, guildIds, name, color } = action.payload;
      state.folders.push({
        id,
        guildIds,
        name: name ?? null,
        color: color ?? null,
        expanded: false,
      });
    },
    removeFolder: (state, action: PayloadAction<string>) => {
      state.folders = state.folders.filter(f => f.id !== action.payload);
    },
    toggleFolderExpanded: (state, action: PayloadAction<string>) => {
      const folder = state.folders.find(f => f.id === action.payload);
      if (folder) {
        folder.expanded = !folder.expanded;
      }
    },
    updateFolder: (state, action: PayloadAction<{ id: string; name?: string | null; color?: number | null }>) => {
      const folder = state.folders.find(f => f.id === action.payload.id);
      if (folder) {
        if (action.payload.name !== undefined) folder.name = action.payload.name;
        if (action.payload.color !== undefined) folder.color = action.payload.color;
      }
    },
    addGuildToFolder: (state, action: PayloadAction<{ folderId: string; guildId: string }>) => {
      const folder = state.folders.find(f => f.id === action.payload.folderId);
      if (folder && !folder.guildIds.includes(action.payload.guildId)) {
        folder.guildIds.push(action.payload.guildId);
      }
    },
    removeGuildFromFolder: (state, action: PayloadAction<{ folderId: string; guildId: string }>) => {
      const folder = state.folders.find(f => f.id === action.payload.folderId);
      if (folder) {
        folder.guildIds = folder.guildIds.filter(id => id !== action.payload.guildId);
        // Auto-remove empty folders
        if (folder.guildIds.length === 0) {
          state.folders = state.folders.filter(f => f.id !== action.payload.folderId);
        }
      }
    },
  },
});

export const {
  addGuild,
  setGuilds,
  removeGuild,
  selectGuild,
  clearSelectedGuild,
  updateGuild,
  createFolder,
  removeFolder,
  toggleFolderExpanded,
  updateFolder,
  addGuildToFolder,
  removeGuildFromFolder,
} = guildsSlice.actions;
