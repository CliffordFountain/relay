import { configureStore } from '@reduxjs/toolkit';
import { authSlice } from './authSlice';
import { guildsSlice } from './guildsSlice';
import { channelsSlice } from './channelsSlice';
import { messagesSlice } from './messagesSlice';
import { voiceSlice } from './voiceSlice';
import { membersSlice } from './membersSlice';
import { uiSlice } from './uiSlice';
import { dmSlice } from './dmSlice';
import { notificationsSlice } from './notificationsSlice';
import { searchSlice } from './searchSlice';
import { settingsSlice } from './settingsSlice';
import { rolesSlice } from './rolesSlice';
import { typingSlice } from './typingSlice';
import { stageInstancesSlice } from './stageInstancesSlice';
import { threadsSlice } from './threadsSlice';
import { forumSlice } from './forumSlice';
import { relationshipsSlice } from './relationshipsSlice';
import { presenceSlice } from './presenceSlice';
import { automodSlice } from './automodSlice';

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    guilds: guildsSlice.reducer,
    channels: channelsSlice.reducer,
    messages: messagesSlice.reducer,
    voice: voiceSlice.reducer,
    members: membersSlice.reducer,
    ui: uiSlice.reducer,
    dm: dmSlice.reducer,
    notifications: notificationsSlice.reducer,
    search: searchSlice.reducer,
    settings: settingsSlice.reducer,
    roles: rolesSlice.reducer,
    typing: typingSlice.reducer,
    stageInstances: stageInstancesSlice.reducer,
    threads: threadsSlice.reducer,
    forum: forumSlice.reducer,
    relationships: relationshipsSlice.reducer,
    presence: presenceSlice.reducer,
    automod: automodSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
