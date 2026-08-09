import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface PermissionOverwrite {
  id: string;
  type: number; // 0 = role, 1 = member
  allow: string; // bigint as string
  deny: string;  // bigint as string
}

export interface Channel {
  id: string;
  guild_id: string | null;
  type: number;
  name: string | null;
  topic: string | null;
  position: number;
  parent_id: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  bitrate?: number;
  user_limit?: number;
  rtc_region?: string | null;
  video_quality_mode?: number;
  default_sort_order?: number | null;
  default_forum_layout?: number | null;
  available_tags?: Array<{ id: string; name: string; emoji_name?: string; emoji_id?: string }> | null;
  permission_overwrites?: PermissionOverwrite[];
}

interface ChannelsState {
  channels: Record<string, Channel>;
  selectedChannelId: string | null;
}

const initialState: ChannelsState = { channels: {}, selectedChannelId: null };

export const channelsSlice = createSlice({
  name: 'channels',
  initialState,
  reducers: {
    setChannels: (state, action: PayloadAction<Channel[]>) => {
      action.payload.forEach(c => { state.channels[c.id] = c; });
    },
    addChannel: (state, action: PayloadAction<Channel>) => {
      state.channels[action.payload.id] = action.payload;
    },
    updateChannel: (state, action: PayloadAction<{ id: string; changes: Partial<Omit<Channel, 'id'>> }>) => {
      const channel = state.channels[action.payload.id];
      if (channel) {
        Object.assign(channel, action.payload.changes);
      }
    },
    removeChannel: (state, action: PayloadAction<string>) => {
      delete state.channels[action.payload];
      if (state.selectedChannelId === action.payload) state.selectedChannelId = null;
    },
    selectChannel: (state, action: PayloadAction<string>) => {
      state.selectedChannelId = action.payload;
    },
    clearSelectedChannel: (state) => {
      state.selectedChannelId = null;
    },
  },
});

export const { setChannels, addChannel, updateChannel, removeChannel, selectChannel, clearSelectedChannel } = channelsSlice.actions;
