import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '../api/rest';

// ─── Types ───

export interface AutoModAction {
  type: 1 | 2 | 3; // 1 = Block Message, 2 = Send Alert, 3 = Timeout
  metadata?: {
    channel_id?: string;
    duration_seconds?: number;
  };
}

export interface AutoModTriggerMetadata {
  keyword_filter?: string[];
  mention_total_limit?: number;
}

export interface AutoModRule {
  id: string;
  guild_id: string;
  name: string;
  event_type: number; // 1 = MESSAGE_SEND
  trigger_type: number; // 1 = KEYWORD, 3 = SPAM, 5 = MENTION_SPAM
  trigger_metadata: AutoModTriggerMetadata;
  actions: AutoModAction[];
  enabled: boolean;
  exempt_roles: string[];
  exempt_channels: string[];
}

interface AutoModState {
  rulesByGuild: Record<string, AutoModRule[]>;
  isLoading: boolean;
  error: string | null;
}

const initialState: AutoModState = {
  rulesByGuild: {},
  isLoading: false,
  error: null,
};

// ─── Thunks ───

export const fetchAutoModRules = createAsyncThunk(
  'automod/fetchRules',
  async (guildId: string) => {
    // The REST client types `actions[].type` as a bare `number`; the API contract
    // guarantees it is always 1 (Block), 2 (Alert) or 3 (Timeout), matching AutoModAction.
    const rules = await api.getAutoModRules(guildId);
    return { guildId, rules: rules as AutoModRule[] };
  }
);

export const createAutoModRule = createAsyncThunk(
  'automod/createRule',
  async ({ guildId, rule }: { guildId: string; rule: Omit<AutoModRule, 'id' | 'guild_id'> }) => {
    const created = await api.createAutoModRule(guildId, rule);
    return { guildId, rule: created as AutoModRule };
  }
);

export const updateAutoModRule = createAsyncThunk(
  'automod/updateRule',
  async ({ guildId, ruleId, data }: { guildId: string; ruleId: string; data: Partial<AutoModRule> }) => {
    const updated = await api.updateAutoModRule(guildId, ruleId, data);
    return { guildId, rule: updated as AutoModRule };
  }
);

export const deleteAutoModRule = createAsyncThunk(
  'automod/deleteRule',
  async ({ guildId, ruleId }: { guildId: string; ruleId: string }) => {
    await api.deleteAutoModRule(guildId, ruleId);
    return { guildId, ruleId };
  }
);

// ─── Slice ───

export const automodSlice = createSlice({
  name: 'automod',
  initialState,
  reducers: {
    setAutoModRules: (state, action: PayloadAction<{ guildId: string; rules: AutoModRule[] }>) => {
      state.rulesByGuild[action.payload.guildId] = action.payload.rules;
    },
    clearAutoModError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAutoModRules.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchAutoModRules.fulfilled, (state, action) => {
        state.isLoading = false;
        state.rulesByGuild[action.payload.guildId] = action.payload.rules;
      })
      .addCase(fetchAutoModRules.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message ?? 'Failed to load AutoMod rules';
      })
      .addCase(createAutoModRule.fulfilled, (state, action) => {
        const { guildId, rule } = action.payload;
        if (!state.rulesByGuild[guildId]) {
          state.rulesByGuild[guildId] = [];
        }
        state.rulesByGuild[guildId].push(rule);
      })
      .addCase(updateAutoModRule.fulfilled, (state, action) => {
        const { guildId, rule } = action.payload;
        const rules = state.rulesByGuild[guildId];
        if (rules) {
          const idx = rules.findIndex(r => r.id === rule.id);
          if (idx !== -1) {
            rules[idx] = rule;
          }
        }
      })
      .addCase(deleteAutoModRule.fulfilled, (state, action) => {
        const { guildId, ruleId } = action.payload;
        const rules = state.rulesByGuild[guildId];
        if (rules) {
          state.rulesByGuild[guildId] = rules.filter(r => r.id !== ruleId);
        }
      });
  },
});

export const { setAutoModRules, clearAutoModError } = automodSlice.actions;
