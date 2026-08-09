import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface MemberUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bot: boolean;
}

export interface GuildMember {
  user: MemberUser;
  roles: string[];
  nick: string | null;
  joinedAt: string;
}

interface MembersState {
  membersByGuild: Record<string, GuildMember[]>;
  isLoading: boolean;
}

const initialState: MembersState = {
  membersByGuild: {},
  isLoading: false,
};

export const membersSlice = createSlice({
  name: 'members',
  initialState,
  reducers: {
    setMembers: (state, action: PayloadAction<{ guildId: string; members: GuildMember[] }>) => {
      state.membersByGuild[action.payload.guildId] = action.payload.members;
    },
    addMember: (state, action: PayloadAction<{ guildId: string; member: GuildMember }>) => {
      const { guildId, member } = action.payload;
      if (!state.membersByGuild[guildId]) {
        state.membersByGuild[guildId] = [];
      }
      const existing = state.membersByGuild[guildId].findIndex(m => m.user.id === member.user.id);
      if (existing >= 0) {
        state.membersByGuild[guildId][existing] = member;
      } else {
        state.membersByGuild[guildId].push(member);
      }
    },
    removeMember: (state, action: PayloadAction<{ guildId: string; userId: string }>) => {
      const { guildId, userId } = action.payload;
      if (state.membersByGuild[guildId]) {
        state.membersByGuild[guildId] = state.membersByGuild[guildId].filter(
          m => m.user.id !== userId
        );
      }
    },
    updateMember: (state, action: PayloadAction<{ guildId: string; userId: string; changes: Partial<GuildMember> }>) => {
      const { guildId, userId, changes } = action.payload;
      if (state.membersByGuild[guildId]) {
        const idx = state.membersByGuild[guildId].findIndex(m => m.user.id === userId);
        if (idx >= 0) {
          const existing = state.membersByGuild[guildId][idx];
          if (existing) {
            Object.assign(existing, changes);
          }
        }
      }
    },
    setMembersLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    /**
     * Update a user's identity (name/avatar) across EVERY guild's member list after a
     * profile change (USER_UPDATE). Unlike updateMember this is not scoped to one guild
     * and merges into member.user rather than replacing it.
     */
    updateMemberUser: (state, action: PayloadAction<{ userId: string; username?: string; displayName?: string | null; avatar?: string | null }>) => {
      const { userId, username, displayName, avatar } = action.payload;
      for (const list of Object.values(state.membersByGuild)) {
        for (const m of list) {
          if (m.user.id !== userId) continue;
          if (username !== undefined) m.user.username = username;
          if (displayName !== undefined && displayName !== null) m.user.displayName = displayName;
          if (avatar !== undefined) m.user.avatar = avatar;
        }
      }
    },
  },
});

export const { setMembers, addMember, removeMember, updateMember, setMembersLoading, updateMemberUser } = membersSlice.actions;
