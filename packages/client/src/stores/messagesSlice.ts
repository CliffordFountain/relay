import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** Emoji shape as the backend serializes reactions. The backend sends an OBJECT for every
 *  reaction: unicode as { name: "👍", id: null }, custom (guild) as { name, id: "<id>" }.
 *  (Optimistic reducers may also store the plain string key, so consumers tolerate a string.) */
export interface ReactionEmoji {
  id: string | null;
  name: string;
  animated?: boolean;
}

export interface Reaction {
  // The backend serializes every reaction emoji as an object — unicode as { name, id: null }
  // and custom as { name, id }. The `id` (not the type) tells them apart. Rendering the
  // object directly crashes React, so consumers must use reactionEmojiKey() / a render
  // helper — never drop `emoji` straight into JSX.
  emoji: string | ReactionEmoji;
  count: number;
  me: boolean;
}

/** Stable string key for a reaction emoji: the raw char for unicode, `name:id` for custom. */
export function reactionEmojiKey(emoji: string | ReactionEmoji): string {
  if (typeof emoji !== 'object' || emoji === null) return emoji;
  // Custom emoji have an id; unicode emoji arrive as { name: "👍", id: null }.
  return emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name;
}

export interface MessageReference {
  message_id: string;
  channel_id?: string;
  guild_id?: string;
}

export interface MessageAuthor {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
  avatar: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url?: string;
  content_type?: string;
  width?: number;
  height?: number;
  description?: string;
}

export interface EmbedFooter {
  text: string;
  icon_url?: string;
}

export interface EmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedImage {
  url: string;
  proxy_url?: string;
  width?: number;
  height?: number;
}

export interface EmbedThumbnail {
  url: string;
  proxy_url?: string;
  width?: number;
  height?: number;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: EmbedFooter;
  author?: EmbedAuthor;
  fields?: EmbedField[];
  image?: EmbedImage;
  thumbnail?: EmbedThumbnail;
  provider?: { name?: string; url?: string };
  type?: string;
}

export interface Message {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: MessageAuthor;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  tts?: boolean;
  mention_everyone?: boolean;
  mentions?: MessageAuthor[];
  mention_roles?: string[];
  attachments?: Attachment[];
  embeds?: Embed[];
  reactions?: Reaction[];
  nonce?: string | null;
  pinned?: boolean;
  message_reference?: MessageReference | null;
  referenced_message?: Message | null;
  type?: number;
  flags?: number;
  webhook_id?: string;
  _pending?: boolean;
  _failed?: boolean;
  _nonce?: string;
}

interface MessagesState {
  messagesByChannel: Record<string, Message[]>;
  hasMoreByChannel: Record<string, boolean>;
  loadingMoreByChannel: Record<string, boolean>;
}

const initialState: MessagesState = {
  messagesByChannel: {},
  hasMoreByChannel: {},
  loadingMoreByChannel: {},
};

export const messagesSlice = createSlice({
  name: 'messages',
  initialState,
  reducers: {
    setMessages: (state, action: PayloadAction<{ channelId: string; messages: Message[] }>) => {
      state.messagesByChannel[action.payload.channelId] = action.payload.messages;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
      const msgs = state.messagesByChannel[action.payload.channel_id] || [];
      // Avoid duplicates
      if (!msgs.find(m => m.id === action.payload.id)) {
        msgs.push(action.payload);
        state.messagesByChannel[action.payload.channel_id] = msgs;
      }
    },
    updateMessage: (state, action: PayloadAction<Partial<Message> & { id: string; channel_id: string }>) => {
      const msgs = state.messagesByChannel[action.payload.channel_id];
      if (msgs) {
        const idx = msgs.findIndex(m => m.id === action.payload.id);
        if (idx !== -1) {
          // Merge partial update with existing message (the gateway protocol sends partial MESSAGE_UPDATE)
          const existing = msgs[idx];
          if (existing) {
            Object.assign(existing, action.payload);
          }
        }
      }
    },
    deleteMessage: (state, action: PayloadAction<{ channelId: string; messageId: string }>) => {
      const msgs = state.messagesByChannel[action.payload.channelId];
      if (msgs) {
        state.messagesByChannel[action.payload.channelId] = msgs.filter(m => m.id !== action.payload.messageId);
      }
    },
    bulkDeleteMessages: (state, action: PayloadAction<{ channelId: string; messageIds: string[] }>) => {
      const msgs = state.messagesByChannel[action.payload.channelId];
      if (msgs) {
        const idsToRemove = new Set(action.payload.messageIds);
        state.messagesByChannel[action.payload.channelId] = msgs.filter(m => !idsToRemove.has(m.id));
      }
    },
    addReaction: (state, action: PayloadAction<{
      channelId: string;
      messageId: string;
      emoji: string;
      me: boolean;
    }>) => {
      const { channelId, messageId, emoji, me } = action.payload;
      const msgs = state.messagesByChannel[channelId];
      if (!msgs) return;
      const msg = msgs.find(m => m.id === messageId);
      if (!msg) return;

      if (!msg.reactions) {
        msg.reactions = [];
      }

      const existing = msg.reactions.find(r => reactionEmojiKey(r.emoji) === emoji);
      if (existing) {
        existing.count += 1;
        if (me) existing.me = true;
      } else {
        msg.reactions.push({ emoji, count: 1, me });
      }
    },
    removeReaction: (state, action: PayloadAction<{
      channelId: string;
      messageId: string;
      emoji: string;
      me: boolean;
    }>) => {
      const { channelId, messageId, emoji, me } = action.payload;
      const msgs = state.messagesByChannel[channelId];
      if (!msgs) return;
      const msg = msgs.find(m => m.id === messageId);
      if (!msg || !msg.reactions) return;

      const existing = msg.reactions.find(r => reactionEmojiKey(r.emoji) === emoji);
      if (existing) {
        existing.count -= 1;
        if (me) existing.me = false;
        if (existing.count <= 0) {
          msg.reactions = msg.reactions.filter(r => reactionEmojiKey(r.emoji) !== emoji);
        }
      }
    },
    prependMessages: (state, action: PayloadAction<{ channelId: string; messages: Message[] }>) => {
      const existing = state.messagesByChannel[action.payload.channelId] || [];
      const existingIds = new Set(existing.map(m => m.id));
      const newMsgs = action.payload.messages.filter(m => !existingIds.has(m.id));
      state.messagesByChannel[action.payload.channelId] = [...newMsgs, ...existing];
    },
    setHasMore: (state, action: PayloadAction<{ channelId: string; hasMore: boolean }>) => {
      state.hasMoreByChannel[action.payload.channelId] = action.payload.hasMore;
    },
    setLoadingMore: (state, action: PayloadAction<{ channelId: string; loading: boolean }>) => {
      state.loadingMoreByChannel[action.payload.channelId] = action.payload.loading;
    },
    addPendingMessage: (state, action: PayloadAction<Message>) => {
      const msgs = state.messagesByChannel[action.payload.channel_id] || [];
      msgs.push({ ...action.payload, _pending: true });
      state.messagesByChannel[action.payload.channel_id] = msgs;
    },
    confirmPendingMessage: (state, action: PayloadAction<{
      nonce: string;
      channelId: string;
      confirmedMessage: Message;
    }>) => {
      const { nonce, channelId, confirmedMessage } = action.payload;
      const msgs = state.messagesByChannel[channelId];
      if (!msgs) return;
      const idx = msgs.findIndex(m => m._nonce === nonce);
      if (idx !== -1) {
        msgs[idx] = confirmedMessage;
      } else {
        // Already replaced by gateway event -- check for duplicate
        if (!msgs.find(m => m.id === confirmedMessage.id)) {
          msgs.push(confirmedMessage);
        }
      }
    },
    failPendingMessage: (state, action: PayloadAction<{
      nonce: string;
      channelId: string;
    }>) => {
      const { nonce, channelId } = action.payload;
      const msgs = state.messagesByChannel[channelId];
      if (!msgs) return;
      const idx = msgs.findIndex(m => m._nonce === nonce);
      if (idx !== -1) {
        const target = msgs[idx];
        if (target) {
          target._pending = false;
          target._failed = true;
        }
      }
    },
    removePendingMessage: (state, action: PayloadAction<{
      nonce: string;
      channelId: string;
    }>) => {
      const { nonce, channelId } = action.payload;
      const msgs = state.messagesByChannel[channelId];
      if (msgs) {
        state.messagesByChannel[channelId] = msgs.filter(m => m._nonce !== nonce);
      }
    },
    /**
     * Rewrite the embedded author identity across ALL loaded messages when a user
     * changes their profile (USER_UPDATE). Message authors are denormalized per-message,
     * so there's no single record to update — we scan every channel and patch matching
     * author.id (including the referenced-message author shown on replies).
     */
    updateAuthorIdentity: (state, action: PayloadAction<{ userId: string; username?: string; global_name?: string | null; avatar?: string | null }>) => {
      const { userId, username, global_name, avatar } = action.payload;
      const patch = (author?: MessageAuthor) => {
        if (!author || author.id !== userId) return;
        if (username !== undefined) author.username = username;
        if (global_name !== undefined) author.global_name = global_name;
        if (avatar !== undefined) author.avatar = avatar;
      };
      for (const msgs of Object.values(state.messagesByChannel)) {
        for (const m of msgs) {
          patch(m.author);
          patch(m.referenced_message?.author);
        }
      }
    },
  },
});

export const {
  setMessages,
  addMessage,
  prependMessages,
  updateMessage,
  deleteMessage,
  bulkDeleteMessages,
  addReaction,
  removeReaction,
  setHasMore,
  setLoadingMore,
  addPendingMessage,
  confirmPendingMessage,
  failPendingMessage,
  removePendingMessage,
  updateAuthorIdentity,
} = messagesSlice.actions;
