import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface User {
  id: string;
  username: string;
  discriminator?: string;
  avatar: string | null;
  email: string;
  global_name?: string | null;
  bio?: string | null;
  banner?: string | null;
  accent_color?: number | null;
  pronouns?: string;
  mfa_enabled?: boolean;
  verified?: boolean;
  locale?: string;
  flags?: number;
  public_flags?: number;
  premium_type?: number;
}

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  status: PresenceStatus;
  customStatus: string | null;
  customStatusEmoji: string | null;
  customStatusClearAt: number | null; // Timestamp (ms) when status should auto-clear
}

const initialState: AuthState = {
  token: localStorage.getItem('token'),
  user: null,
  isAuthenticated: false,
  status: 'online',
  customStatus: null,
  customStatusEmoji: null,
  customStatusClearAt: null,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuth: (state, action: PayloadAction<{ token: string; user: User }>) => {
      state.token = action.payload.token;
      state.user = action.payload.user;
      state.isAuthenticated = true;
      localStorage.setItem('token', action.payload.token);
    },
    logout: (state) => {
      state.token = null;
      state.user = null;
      state.isAuthenticated = false;
      localStorage.removeItem('token');
    },
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
    },
    setPresenceStatus: (state, action: PayloadAction<PresenceStatus>) => {
      state.status = action.payload;
    },
    setCustomStatus: (state, action: PayloadAction<string | null>) => {
      state.customStatus = action.payload;
    },
    setCustomStatusEmoji: (state, action: PayloadAction<string | null>) => {
      state.customStatusEmoji = action.payload;
    },
    setCustomStatusClearAt: (state, action: PayloadAction<number | null>) => {
      state.customStatusClearAt = action.payload;
    },
  },
});

export const { setAuth, logout, setUser, setPresenceStatus, setCustomStatus, setCustomStatusEmoji, setCustomStatusClearAt } = authSlice.actions;
