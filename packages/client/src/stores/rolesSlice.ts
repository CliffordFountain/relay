import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface Role {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}

interface RolesState {
  rolesByGuild: Record<string, Role[]>;
}

const initialState: RolesState = {
  rolesByGuild: {},
};

export const rolesSlice = createSlice({
  name: 'roles',
  initialState,
  reducers: {
    setRoles: (state, action: PayloadAction<{ guildId: string; roles: Role[] }>) => {
      state.rolesByGuild[action.payload.guildId] = action.payload.roles;
    },
    addRole: (state, action: PayloadAction<{ guildId: string; role: Role }>) => {
      const { guildId, role } = action.payload;
      if (!state.rolesByGuild[guildId]) {
        state.rolesByGuild[guildId] = [];
      }
      state.rolesByGuild[guildId].push(role);
    },
    updateRole: (state, action: PayloadAction<{ guildId: string; roleId: string; changes: Partial<Role> }>) => {
      const { guildId, roleId, changes } = action.payload;
      const roles = state.rolesByGuild[guildId];
      if (roles) {
        const idx = roles.findIndex(r => r.id === roleId);
        const existing = roles[idx];
        if (idx >= 0 && existing) {
          roles[idx] = { ...existing, ...changes };
        }
      }
    },
    removeRole: (state, action: PayloadAction<{ guildId: string; roleId: string }>) => {
      const { guildId, roleId } = action.payload;
      if (state.rolesByGuild[guildId]) {
        state.rolesByGuild[guildId] = state.rolesByGuild[guildId].filter(r => r.id !== roleId);
      }
    },
  },
});

export const { setRoles, addRole, updateRole, removeRole } = rolesSlice.actions;
