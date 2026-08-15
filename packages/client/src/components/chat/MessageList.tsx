import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { updateMessage, addReaction, removePendingMessage, addPendingMessage, confirmPendingMessage, failPendingMessage, deleteMessage } from '../../stores/messagesSlice';
import { setReplyingToMessageId, setEditingMessageId } from '../../stores/uiSlice';
import type { Message } from '../../stores/messagesSlice';
import { RelationshipType } from '../../stores/relationshipsSlice';
import { setLastReadMessageId } from '../../stores/notificationsSlice';
import { openUserPopover } from '../../stores/uiSlice';
import { useOpenDm } from '../../hooks/useOpenDm';
import { api } from '../../api/rest';
import { ContextMenu, useContextMenu, getMessageContextItems } from '../ui/ContextMenu';
import { MarkdownContent } from '../../markdown';
import { MessageAttachments } from './MessageAttachments';
import { MessageEmbed } from './MessageEmbed';
import { ReactionBar } from './ReactionBar';
import { ConfirmModal } from '../modals/ConfirmModal';
import { EmojiPicker } from '../emoji/EmojiPicker';
import { MessageMoreMenu } from './MessageMoreMenu';
import { Tooltip } from '../ui/Tooltip';
import { ForwardMessageModal } from '../modals/ForwardMessageModal';
import { CreateThreadModal } from '../threads/CreateThreadModal';
import { usePermissions } from '../../hooks/usePermissions';
import { useRoleColor } from '../../hooks/useRoleColor';
import { getQuickReactEmoji, recordEmojiUsage } from '../../utils/frequentEmoji';
import type { PresenceStatusType } from '../../stores/presenceSlice';
import confirmStyles from '../modals/confirmModal.module.scss';
import styles from './messageList.module.scss';

const STATUS_COLORS: Record<PresenceStatusType, string> = {
  online: '#28aa5e',
  idle: '#f5b737',
  dnd: '#f74448',
  offline: '#858993',
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const dateDividerFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const formatDateDivider = (iso: string): string => {
  return dateDividerFormatter.format(new Date(iso));
};

const isDifferentDay = (a: string, b: string): boolean => {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() !== dateB.getFullYear() ||
    dateA.getMonth() !== dateB.getMonth() ||
    dateA.getDate() !== dateB.getDate()
  );
};

/** Message types that render as system messages */
const SYSTEM_MESSAGE_TYPES: ReadonlySet<number> = new Set([
  6,  // CHANNEL_PINNED_MESSAGE
  7,  // USER_JOIN
  18, // THREAD_CREATED
]);

const isSystemMessage = (msg: Message): boolean => {
  return msg.type !== undefined && SYSTEM_MESSAGE_TYPES.has(msg.type);
};

const getSystemMessageSuffix = (msg: Message): string => {
  switch (msg.type) {
    case 6:
      return ' pinned a message to this channel.';
    case 7:
      return ' joined the server.';
    case 18:
      return ` started a thread: ${msg.content}`;
    default:
      return msg.content;
  }
};

const getSystemMessageIcon = (type: number): React.ReactNode => {
  switch (type) {
    case 7: // USER_JOIN - arrow icon
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <path d="M3 9.5L5.5 7V9H12V7L14.5 9.5L12 12V10H5.5V12L3 9.5Z" />
        </svg>
      );
    case 6: // CHANNEL_PINNED_MESSAGE - pin icon
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22 12.41L13.59 4 12 5.59l1.59 1.59-5.89 5.89-1.18-1.18L5.12 13.3l3.54 3.53-4.24 4.24 1.42 1.41 4.24-4.24 3.53 3.54 1.41-1.42-1.18-1.18 5.89-5.89L21.41 14 22 12.41z" />
        </svg>
      );
    case 18: // THREAD_CREATED - thread icon
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3.48 2.01C2.65 2.04 2 2.72 2 3.55V18.24C2 19.08 2.67 19.74 3.5 19.74H6V22.24C6 22.51 6.11 22.77 6.29 22.95C6.68 23.34 7.31 23.34 7.7 22.95L10.96 19.74H14.5C15.33 19.74 16 19.07 16 18.24V15.74H17.5C18.33 15.74 19 15.07 19 14.24V10.74H20.5C21.33 10.74 22 10.07 22 9.24V3.55C22 2.72 21.33 2.05 20.5 2.05L3.48 2.01Z" />
        </svg>
      );
    default:
      return null;
  }
};

/**
 * Returns true when the entire message content is a bare GIF URL (GIPHY or Tenor).
 * The GIF picker sends the media URL as content and it is
 * rendered as an inline image (gifv embed), not as link text.
 */
const GIF_URL_REGEX = /^https:\/\/((?:media\d*|c|i)\.tenor\.com|(?:media\d*|i)\.giphy\.com)\/[^\s]+\.(gif|mp4|webp)(\?[^\s]*)?$/i;
const isBareGifUrl = (content: string): boolean => GIF_URL_REGEX.test(content.trim());

/**
 * Text emoticon -> emoji map used by the "Convert emoticons in your messages to emoji"
 * chat setting. Applied at render time: MessageInput (composing/sending) is out of this
 * fix's file scope, so the setting affects how messages are displayed rather than what
 * is actually sent over the wire.
 */
const EMOTICON_TO_EMOJI: ReadonlyArray<readonly [string, string]> = [
  [':-)', '\u{1F642}'],
  [':)', '\u{1F642}'],
  [':-D', '\u{1F600}'],
  [':D', '\u{1F600}'],
  [':-(', '\u{1F641}'],
  [':(', '\u{1F641}'],
  [';-)', '\u{1F609}'],
  [';)', '\u{1F609}'],
  [':-P', '\u{1F61B}'],
  [':P', '\u{1F61B}'],
  [':-p', '\u{1F61B}'],
  [':p', '\u{1F61B}'],
  [':-O', '\u{1F62E}'],
  [':O', '\u{1F62E}'],
  [':-o', '\u{1F62E}'],
  [':o', '\u{1F62E}'],
  ['<3', '\u{2764}\u{FE0F}'],
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EMOTICON_RE = new RegExp(
  `(^|\\s)(${EMOTICON_TO_EMOJI.map(([token]) => escapeRegExp(token)).join('|')})(?=\\s|$)`,
  'g',
);

/** Replaces recognized text emoticons in `content` with their emoji equivalent. */
const emojifyEmoticons = (content: string): string =>
  content.replace(EMOTICON_RE, (_match, lead: string, token: string) => {
    const emoji = EMOTICON_TO_EMOJI.find(([k]) => k === token)?.[1];
    return `${lead}${emoji ?? token}`;
  });

/**
 * Unicode emoji regex: matches common emoji sequences including skin tones,
 * ZWJ sequences, keycap sequences, flags, etc.
 */
const UNICODE_EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;

/** Custom emoji pattern: <:name:id> or <a:name:id> */
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;

/**
 * Checks if a message consists only of emoji (unicode and/or custom emoji).
 * Returns whether it is emoji-only and the count of emoji found.
 * Only counts as emoji-only when count is 1-3 and there is no other text.
 */
const isEmojiOnly = (content: string): { emojiOnly: boolean; count: number } => {
  if (!content || content.length === 0) return { emojiOnly: false, count: 0 };

  // Remove all unicode emoji
  let stripped = content.replace(UNICODE_EMOJI_RE, '\u0000');
  // Remove all custom emoji
  stripped = stripped.replace(CUSTOM_EMOJI_RE, '\u0000');
  // Remove placeholder markers and whitespace
  stripped = stripped.replace(/\u0000/g, '').trim();

  // If anything remains, it's not emoji-only
  if (stripped.length > 0) return { emojiOnly: false, count: 0 };

  // Count emoji
  const unicodeMatches = content.match(UNICODE_EMOJI_RE) ?? [];
  const customMatches = content.match(CUSTOM_EMOJI_RE) ?? [];
  const count = unicodeMatches.length + customMatches.length;

  return { emojiOnly: count >= 1 && count <= 3, count };
};

// Check if messages should be grouped (same author within 7 minutes)
const shouldGroup = (prev: Message | undefined, curr: Message) => {
  if (!prev) return false;
  if (prev.author.id !== curr.author.id) return false;
  // Don't group replies
  if (curr.message_reference) return false;
  // Don't group system messages
  if (isSystemMessage(curr) || isSystemMessage(prev)) return false;
  return new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime() < 420000;
};

export interface MessageListProps {
  messages: Message[];
  channelId: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  /** When true, shows Publish button on each message (announcement channels type 5) */
  isAnnouncement?: boolean;
  /** When set, scrolls to this message ID */
  jumpToMessageId?: string | null;
  /** Called after the jump scroll completes */
  onJumpComplete?: () => void;
}

/** Message flags bitmask */
const MESSAGE_FLAG_CROSSPOSTED = 1;

const FOLLOW_OUTPUT_THRESHOLD = 150;

export const MessageList = ({
  messages,
  channelId,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  isAnnouncement = false,
  jumpToMessageId = null,
  onJumpComplete,
}: MessageListProps) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const dispatch = useAppDispatch();
  const openDm = useOpenDm();
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const editingMessageId = useAppSelector(s => s.ui.editingMessageId);
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const selectedChannel = useAppSelector(s => s.channels.channels[channelId]);
  const guildPermissions = usePermissions(selectedGuildId);
  const getRoleColor = useRoleColor(selectedGuildId);
  const lastReadMessageId = useAppSelector(s => s.notifications.lastReadMessageIdByChannel[channelId]);
  // Accessibility + Chat settings that gate what actually renders in the message list.
  const showLinkPreviews = useAppSelector(s => s.settings.showLinkPreviews);
  const showEmbeds = useAppSelector(s => s.settings.showEmbeds);
  // Two settings currently control embed/link-preview rendering (an accessibility toggle
  // and a Chat-tab toggle); since there is only one embed render path, both must be on.
  const embedsEnabled = showLinkPreviews && showEmbeds;
  const showEmojiReactions = useAppSelector(s => s.settings.showEmojiReactions);
  const autoPlayGifs = useAppSelector(s => s.settings.autoPlayGifs);
  const convertEmoticons = useAppSelector(s => s.settings.convertEmoticons);
  const enableTTS = useAppSelector(s => s.settings.enableTTS);
  const messageDisplayMode = useAppSelector(s => s.settings.messageDisplayMode);
  const presences = useAppSelector(s => s.presence.presences);
  const relationships = useAppSelector(s => s.relationships.relationships);
  const blockedUserIds = useCallback((userId: string): boolean => {
    const rel = relationships[userId];
    return rel?.type === RelationshipType.BLOCKED;
  }, [relationships]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);

  // Pin confirmation state
  const [pinTarget, setPinTarget] = useState<Message | null>(null);

  // Thread creation state
  const [createThreadTarget, setCreateThreadTarget] = useState<Message | null>(null);

  // Forward message modal state
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);

  // Blocked messages: set of message IDs temporarily revealed
  const [revealedBlockedIds, setRevealedBlockedIds] = useState<Set<string>>(new Set());

  // GIF autoplay: when the setting is off, a bare-GIF message starts paused and this
  // tracks which ones the user has manually started playing.
  const [playingGifIds, setPlayingGifIds] = useState<Set<string>>(new Set());
  const handlePlayGif = useCallback((messageId: string) => {
    setPlayingGifIds(prev => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  }, []);

  // Reaction emoji picker state
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [reactionPickerPos, setReactionPickerPos] = useState<{ top: number; left: number } | null>(null);

  // When entering edit mode, populate the textarea. Seed ONLY when editingMessageId
  // changes -- not on every `messages` update -- otherwise an incoming message/reaction
  // while the user is mid-edit would overwrite their in-progress text with the server
  // value (and, with the no-op guard in handleSaveEdit, silently discard the edit).
  useEffect(() => {
    if (editingMessageId) {
      const msg = messages.find(m => m.id === editingMessageId);
      if (msg) {
        setEditContent(msg.content);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMessageId]);

  // Jump to a specific message when jumpToMessageId changes
  useEffect(() => {
    if (jumpToMessageId && virtuosoRef.current) {
      const msgIndex = messages.findIndex(m => m.id === jumpToMessageId);
      if (msgIndex !== -1) {
        virtuosoRef.current.scrollToIndex({
          index: msgIndex,
          align: 'center',
          behavior: 'smooth',
        });
      }
      onJumpComplete?.();
    }
  }, [jumpToMessageId, messages, onJumpComplete]);

  const handleReply = useCallback((msg: Message) => {
    dispatch(setReplyingToMessageId(msg.id));
  }, [dispatch]);

  const handleEdit = useCallback((msg: Message) => {
    dispatch(setEditingMessageId(msg.id));
  }, [dispatch]);

  const handleCancelEdit = useCallback(() => {
    dispatch(setEditingMessageId(null));
    setEditContent('');
  }, [dispatch]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingMessageId) return;
    const trimmed = editContent.trim();
    if (!trimmed) return;

    // If the content is unchanged, don't call the API at all: an edit request would
    // stamp edited_timestamp on the server and (incorrectly) mark the message "(edited)"
    // even though nothing changed. Just close the editor.
    const original = messages.find(m => m.id === editingMessageId);
    if (original && trimmed === original.content.trim()) {
      dispatch(setEditingMessageId(null));
      setEditContent('');
      return;
    }

    try {
      const updated = await api.editMessage(channelId, editingMessageId, { content: trimmed });
      dispatch(updateMessage(updated as unknown as Message));
      dispatch(setEditingMessageId(null));
      setEditContent('');
    } catch {
      // Keep editing on failure
    }
  }, [editingMessageId, editContent, channelId, dispatch, messages]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEdit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSaveEdit();
    }
  }, [handleCancelEdit, handleSaveEdit]);

  // Delete with confirmation
  const handleDeleteRequest = useCallback((msg: Message) => {
    setDeleteTarget(msg);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      dispatch(deleteMessage({ channelId, messageId: deleteTarget.id }));
      void api.deleteMessage(channelId, deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, channelId, dispatch]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  // Pin with confirmation
  const handlePinRequest = useCallback((msg: Message) => {
    setPinTarget(msg);
  }, []);

  const handlePinConfirm = useCallback(() => {
    if (pinTarget) {
      void api.pinMessage(channelId, pinTarget.id);
      setPinTarget(null);
    }
  }, [pinTarget, channelId]);

  const handlePinCancel = useCallback(() => {
    setPinTarget(null);
  }, []);

  // Add reaction via emoji picker. `anchor` is either the element that triggered it
  // (its rect positions the popover) or explicit click coordinates -- the context menu
  // passes coordinates because it has no persistent anchor element, which is why opening
  // "Add Reaction" from the right-click menu used to drop the picker at the message's
  // hover bar instead of where the user clicked. The picker is portaled to <body> and
  // positioned in viewport-fixed coordinates, so it opens next to the trigger and is
  // never clipped by the virtualized message list.
  const handleOpenReactionPicker = useCallback((msgId: string, anchor: HTMLElement | { x: number; y: number } | null) => {
    if (reactionPickerMessageId === msgId) {
      setReactionPickerMessageId(null);
      return;
    }
    const PICKER_W = 420; // matches emojiPicker.module.scss .picker
    const PICKER_H = 400;
    let top: number;
    let left: number;
    if (anchor && 'getBoundingClientRect' in anchor) {
      const rect = anchor.getBoundingClientRect();
      top = rect.bottom + 4;
      left = rect.right - PICKER_W;
    } else if (anchor) {
      top = anchor.y;
      left = anchor.x;
    } else {
      top = window.innerHeight / 2 - PICKER_H / 2;
      left = window.innerWidth / 2 - PICKER_W / 2;
    }
    // Clamp within the viewport (8px margin) so the picker never opens off-screen.
    left = Math.max(8, Math.min(left, window.innerWidth - PICKER_W - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - PICKER_H - 8));
    setReactionPickerPos({ top, left });
    setReactionPickerMessageId(msgId);
  }, [reactionPickerMessageId]);

  const handleReactionEmojiSelect = useCallback((emoji: string) => {
    if (reactionPickerMessageId) {
      dispatch(addReaction({ channelId, messageId: reactionPickerMessageId, emoji, me: true }));
      void api.addReaction(channelId, reactionPickerMessageId, emoji).catch(() => {
        // Silently fail -- the optimistic update stays
      });
      recordEmojiUsage(emoji);
    }
    setReactionPickerMessageId(null);
  }, [reactionPickerMessageId, channelId, dispatch]);

  // Quick-react: add a reaction immediately with a frequently used emoji
  const handleQuickReact = useCallback((msgId: string, emoji: string) => {
    dispatch(addReaction({ channelId, messageId: msgId, emoji, me: true }));
    void api.addReaction(channelId, msgId, emoji).catch(() => {
      // Silently fail
    });
    recordEmojiUsage(emoji);
  }, [channelId, dispatch]);

  // Get top 3 frequently used emoji for quick-react bar
  const quickReactEmoji = getQuickReactEmoji(3);

  const handleCloseReactionPicker = useCallback(() => {
    setReactionPickerMessageId(null);
  }, []);

  // Announcement channel: crosspost/publish handling
  const [publishingMessageIds, setPublishingMessageIds] = useState<Set<string>>(new Set());

  const handlePublish = useCallback((msgId: string) => {
    setPublishingMessageIds(prev => {
      const next = new Set(prev);
      next.add(msgId);
      return next;
    });
    api.crosspostMessage(channelId, msgId)
      .then((result) => {
        const updated = result as unknown as Message;
        dispatch(updateMessage(updated));
      })
      .catch(() => {
        // Silently handle failure
      })
      .finally(() => {
        setPublishingMessageIds(prev => {
          const next = new Set(prev);
          next.delete(msgId);
          return next;
        });
      });
  }, [channelId, dispatch]);

  // Retry a failed message
  const nonceCounterRef = useRef(0);
  const handleRetry = useCallback(async (msg: Message) => {
    if (!msg._nonce) return;

    // Remove the failed message
    dispatch(removePendingMessage({ nonce: msg._nonce, channelId }));

    // Create a new pending message with fresh nonce
    const newNonce = `pending_${Date.now()}_${nonceCounterRef.current++}`;
    const pendingMsg: Message = {
      id: newNonce,
      channel_id: channelId,
      author: msg.author,
      content: msg.content,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      _pending: true,
      _nonce: newNonce,
    };
    dispatch(addPendingMessage(pendingMsg));

    try {
      const result = await api.sendMessage(channelId, {
        content: msg.content,
        nonce: newNonce,
      });
      dispatch(confirmPendingMessage({
        nonce: newNonce,
        channelId,
        confirmedMessage: result as unknown as Message,
      }));
    } catch {
      dispatch(failPendingMessage({ nonce: newNonce, channelId }));
    }
  }, [channelId, dispatch]);

  const handleForwardRequest = useCallback((msg: Message) => {
    setForwardTarget(msg);
  }, []);

  const developerMode = useAppSelector(s => s.settings.developerMode);

  const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
    const msgIndex = messages.findIndex(m => m.id === msg.id);
    const items = getMessageContextItems(msg, currentUserId, {
      onAddReaction: () => handleOpenReactionPicker(msg.id, { x: e.clientX, y: e.clientY }),
      onReply: () => handleReply(msg),
      onEdit: () => handleEdit(msg),
      onDelete: () => handleDeleteRequest(msg),
      onCopyText: () => {
        void navigator.clipboard.writeText(msg.content);
      },
      onCopyMessageLink: () => {
        const guildPart = selectedGuildId ?? '@me';
        const link = `${window.location.origin}/channels/${guildPart}/${channelId}/${msg.id}`;
        void navigator.clipboard.writeText(link);
      },
      onPin: () => handlePinRequest(msg),
      onForward: () => handleForwardRequest(msg),
      onMarkUnread: () => {
        // Set the last read message to the message before the right-clicked one
        const prevMsg = msgIndex > 0 ? messages[msgIndex - 1] : undefined;
        if (prevMsg) {
          dispatch(setLastReadMessageId({ channelId, messageId: prevMsg.id }));
        }
      },
      // Only offer Speak Message when Text-to-Speech is enabled in Accessibility settings.
      onSpeakMessage: enableTTS
        ? () => {
            if ('speechSynthesis' in window) {
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(msg.content);
              window.speechSynthesis.speak(utterance);
            }
          }
        : undefined,
    }, { canManageMessages: guildPermissions.canManageMessages }, { developerMode });

    // Build quick react row header
    const QUICK_REACT_EMOJI = ['\u{1F44D}', '\u{1F525}', '\u{2764}\u{FE0F}', '\u{1F602}'];
    const quickReactHeader = (
      <div className={styles.contextQuickReactRow}>
        {QUICK_REACT_EMOJI.map((emoji) => (
          <button
            key={emoji}
            className={styles.contextQuickReactBtn}
            type="button"
            onClick={() => {
              handleQuickReact(msg.id, emoji);
              closeContextMenu();
            }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    );

    openContextMenu(e, items, quickReactHeader);
  }, [currentUserId, channelId, selectedGuildId, messages, guildPermissions.canManageMessages, developerMode, enableTTS, dispatch, handleReply, handleEdit, handleDeleteRequest, handlePinRequest, handleForwardRequest, handleOpenReactionPicker, handleQuickReact, openContextMenu, closeContextMenu]);

  const handleUserContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    e.stopPropagation();
    const userId = msg.author.id;
    const username = msg.author.username;
    const items: Parameters<typeof openContextMenu>[1] = [];

    items.push({
      id: 'profile',
      label: 'Profile',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 1c4.963 0 9 4.037 9 9s-4.037 9-9 9-9-4.037-9-9 4.037-9 9-9zm0 4a3 3 0 100 6 3 3 0 000-6zm-5.5 10.5c1.5-1.5 3.5-2.5 5.5-2.5s4 1 5.5 2.5" />
        </svg>
      ),
      onClick: () => {
        dispatch(openUserPopover({
          userId,
          position: { top: e.clientY, left: e.clientX },
          guildId: selectedGuildId,
        }));
      },
    });

    items.push({
      id: 'message',
      label: 'Message',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.79805 3C3.80445 3 2.99805 3.8055 2.99805 4.8V15.6C2.99805 16.5936 3.80445 17.4 4.79805 17.4H7.49805V21L11.098 17.4H19.198C20.1925 17.4 20.998 16.5936 20.998 15.6V4.8C20.998 3.8055 20.1925 3 19.198 3H4.79805Z" />
        </svg>
      ),
      onClick: () => {
        openDm(userId);
      },
    });

    items.push({
      id: 'mention',
      label: 'Mention',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10c1.573 0 3.073-.364 4.413-1.05l-.826-1.54A8.042 8.042 0 0112 20c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8v1c0 .826-.674 1.5-1.5 1.5S17 13.826 17 13v-1c0-2.757-2.243-5-5-5s-5 2.243-5 5 2.243 5 5 5c1.531 0 2.898-.695 3.812-1.782.512.776 1.366 1.282 2.338 1.282 1.654 0 3-1.346 3-3v-1c0-5.514-4.486-10-10-10zm0 13c-1.654 0-3-1.346-3-3s1.346-3 3-3 3 1.346 3 3-1.346 3-3 3z" />
        </svg>
      ),
      onClick: () => {
        // Insert @mention into input - dispatch to a known pattern
        const inputEl = document.querySelector('textarea[aria-label^="Message"]') as HTMLTextAreaElement | null;
        if (inputEl) {
          const event = new Event('input', { bubbles: true });
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          nativeInputValueSetter?.call(inputEl, inputEl.value + `@${username} `);
          inputEl.dispatchEvent(event);
          inputEl.focus();
        }
      },
    });

    // Kick and Ban - only if user has permissions and in a guild
    if (selectedGuildId && userId !== currentUserId) {
      items.push({ id: 'sep-mod', separator: true as const });

      if (guildPermissions.canKickMembers) {
        items.push({
          id: 'kick',
          label: `Kick ${username}`,
          danger: true,
          onClick: () => {
            void api.kickMember(selectedGuildId, userId);
          },
        });
      }

      if (guildPermissions.canBanMembers) {
        items.push({
          id: 'ban',
          label: `Ban ${username}`,
          danger: true,
          onClick: () => {
            void api.createBan(selectedGuildId, userId);
          },
        });
      }
    }

    openContextMenu(e, items);
  }, [currentUserId, selectedGuildId, guildPermissions.canKickMembers, guildPermissions.canBanMembers, openContextMenu, dispatch, openDm]);

  const handleJumpToMessage = useCallback((targetMessageId: string) => {
    const msgIndex = messages.findIndex(m => m.id === targetMessageId);
    if (msgIndex !== -1 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: msgIndex,
        align: 'center',
        behavior: 'smooth',
      });
    }
  }, [messages]);

  const handleStartReached = useCallback(() => {
    if (hasMore && !isLoadingMore && onLoadMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  const followOutput = useCallback((isAtBottomNow: boolean) => {
    if (isAtBottomNow) {
      return 'smooth' as const;
    }
    return false as const;
  }, []);

  const renderMessage = useCallback((index: number) => {
    const msg = messages[index];
    if (!msg) return null;
    const prev = index > 0 ? messages[index - 1] : undefined;
    const grouped = shouldGroup(prev, msg);
    const isEditing = editingMessageId === msg.id;
    const isOwnMessage = currentUserId === msg.author.id;
    const isHovered = hoveredMessageId === msg.id;
    const hasReply = msg.message_reference && msg.referenced_message;
    const isPending = msg._pending === true;
    const isFailed = msg._failed === true;
    const authorRoleColor = getRoleColor(msg.author.id);
    const replyAuthorRoleColor = msg.referenced_message ? getRoleColor(msg.referenced_message.author.id) : undefined;

    // Date divider: show between messages from different days
    const showDateDivider = prev ? isDifferentDay(prev.timestamp, msg.timestamp) : false;

    // Show "NEW" separator before the first unread message
    const showUnreadSeparator = lastReadMessageId && prev && prev.id === lastReadMessageId && msg.id !== lastReadMessageId;

    // Mention highlight: if message mentions the current user, @everyone, or @here
    const isMentioned = (() => {
      if (!currentUserId) return false;
      if (msg.mention_everyone) return true;
      if (msg.mentions?.some(m => m.id === currentUserId)) return true;
      return false;
    })();

    // Blocked user check
    const isBlocked = blockedUserIds(msg.author.id);

    // System messages (join, pin, thread created)
    if (isSystemMessage(msg)) {
      return (
        <div>
          {showDateDivider && (
            <div className={styles.dateDivider} role="separator" aria-label={formatDateDivider(msg.timestamp)}>
              <span className={styles.dateDividerText}>{formatDateDivider(msg.timestamp)}</span>
            </div>
          )}
          {showUnreadSeparator && (
            <div className={styles.newMessagesSeparator} role="separator" aria-label="New messages">
              <span className={styles.newMessagesText}>NEW</span>
            </div>
          )}
          <div
            className={styles.systemMessage}
            onMouseEnter={() => setHoveredMessageId(msg.id)}
            onMouseLeave={() => setHoveredMessageId(null)}
            data-testid="system-message"
          >
            <span className={styles.systemIcon} aria-hidden="true">
              {getSystemMessageIcon(msg.type ?? 0)}
            </span>
            <span className={styles.systemText}>
              <span
                className={styles.systemUsername}
                style={authorRoleColor ? { color: authorRoleColor } : undefined}
              >
                {msg.author.username}
              </span>
              {getSystemMessageSuffix(msg)}
            </span>
            <span className={styles.systemTimestamp}>{formatTime(msg.timestamp)}</span>
          </div>
        </div>
      );
    }

    // Blocked message placeholder: count consecutive blocked messages starting at this index
    if (isBlocked && !revealedBlockedIds.has(msg.id)) {
      // Check if previous message was also a blocked (non-revealed) message -- if so, skip this one
      // (the first blocked message in a group renders the placeholder for all)
      if (prev && blockedUserIds(prev.author.id) && !revealedBlockedIds.has(prev.id)) {
        return null;
      }

      // Count consecutive blocked messages starting from this index
      let blockedCount = 1;
      for (let j = index + 1; j < messages.length; j++) {
        const nextMsg = messages[j];
        if (nextMsg && blockedUserIds(nextMsg.author.id) && !revealedBlockedIds.has(nextMsg.id)) {
          blockedCount++;
        } else {
          break;
        }
      }

      // Collect the IDs for reveal
      const blockedIds: string[] = [msg.id];
      for (let j = index + 1; j < index + blockedCount; j++) {
        const nextMsg = messages[j];
        if (nextMsg) blockedIds.push(nextMsg.id);
      }

      return (
        <div>
          {showDateDivider && (
            <div className={styles.dateDivider} role="separator" aria-label={formatDateDivider(msg.timestamp)}>
              <span className={styles.dateDividerText}>{formatDateDivider(msg.timestamp)}</span>
            </div>
          )}
          {showUnreadSeparator && (
            <div className={styles.newMessagesSeparator} role="separator" aria-label="New messages">
              <span className={styles.newMessagesText}>NEW</span>
            </div>
          )}
          <div className={styles.blockedPlaceholder} data-testid="blocked-messages">
            <span className={styles.blockedText}>
              {blockedCount === 1 ? '1 blocked message' : `${blockedCount} blocked messages`}
              {' \u2014 '}
            </span>
            <button
              className={styles.blockedShowButton}
              type="button"
              onClick={() => {
                setRevealedBlockedIds(prev => {
                  const next = new Set(prev);
                  for (const id of blockedIds) next.add(id);
                  return next;
                });
              }}
            >
              Show
            </button>
          </div>
        </div>
      );
    }

    return (
      <div>
        {showDateDivider && (
          <div className={styles.dateDivider} role="separator" aria-label={formatDateDivider(msg.timestamp)}>
            <span className={styles.dateDividerText}>{formatDateDivider(msg.timestamp)}</span>
          </div>
        )}
        {showUnreadSeparator && (
          <div className={styles.newMessagesSeparator} role="separator" aria-label="New messages">
            <span className={styles.newMessagesText}>NEW</span>
          </div>
        )}
        <div
          className={`${styles.message} ${grouped && !hasReply ? styles.grouped : ''} ${isEditing ? styles.editing : ''} ${isPending ? styles.pendingMessage : ''} ${isFailed ? styles.failedMessage : ''} ${isMentioned ? styles.mentioned : ''}`}
          onContextMenu={(e) => handleContextMenu(e, msg)}
          onMouseEnter={() => setHoveredMessageId(msg.id)}
          onMouseLeave={() => setHoveredMessageId(null)}
        >
        {/* Reply preview */}
        {hasReply && msg.referenced_message && (
          <div
            className={styles.replyPreview}
            onClick={() => {
              if (msg.message_reference?.message_id) {
                handleJumpToMessage(msg.message_reference.message_id);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && msg.message_reference?.message_id) {
                handleJumpToMessage(msg.message_reference.message_id);
              }
            }}
            aria-label={`Jump to replied message from ${msg.referenced_message.author.username}`}
          >
            <div className={styles.replyLine} />
            <div className={styles.replyContent}>
              <div className={styles.replyAvatar}>
                {msg.referenced_message.author.username.charAt(0).toUpperCase()}
              </div>
              <span
                className={styles.replyUsername}
                style={replyAuthorRoleColor ? { color: replyAuthorRoleColor } : undefined}
              >
                {msg.referenced_message.author.username}
              </span>
              <span className={styles.replyText}>
                {msg.referenced_message.content.length > 100
                  ? msg.referenced_message.content.slice(0, 100) + '...'
                  : msg.referenced_message.content}
              </span>
            </div>
          </div>
        )}

        <div className={styles.messageBody}>
          {!grouped || hasReply ? (
            <div className={styles.avatarWrapper}>
              {msg.author.avatar ? (
                <img
                  className={styles.avatar}
                  src={msg.author.avatar}
                  alt=""
                  style={{ objectFit: 'cover' }}
                  loading="lazy"
                />
              ) : (
                <div className={styles.avatar}>
                  {msg.author.username.charAt(0).toUpperCase()}
                </div>
              )}
              {(() => {
                const authorStatus = presences[msg.author.id]?.status;
                if (authorStatus && authorStatus !== 'offline') {
                  return (
                    <div
                      className={styles.avatarStatusDot}
                      style={{ backgroundColor: STATUS_COLORS[authorStatus] }}
                      aria-label={authorStatus}
                    />
                  );
                }
                return null;
              })()}
            </div>
          ) : null}
          <div className={grouped && !hasReply ? styles.contentGrouped : styles.content}>
            {(!grouped || hasReply) && (
              <div className={styles.messageHeader}>
                <span
                  className={styles.username}
                  onContextMenu={(e) => handleUserContextMenu(e, msg)}
                  role="button"
                  tabIndex={0}
                  style={authorRoleColor ? { color: authorRoleColor } : undefined}
                >
                  {msg.author.username}
                </span>
                <span className={styles.timestamp} title={new Date(msg.timestamp).toLocaleString()}>{formatTime(msg.timestamp)}</span>
                {isAnnouncement && msg.flags !== undefined && (msg.flags & MESSAGE_FLAG_CROSSPOSTED) !== 0 && (
                  <span className={styles.publishedBadge} data-testid="published-badge">Published</span>
                )}
              </div>
            )}

            {isEditing ? (
              <div className={styles.editContainer}>
                <textarea
                  className={styles.editTextarea}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  autoFocus
                  rows={1}
                />
                <div className={styles.editActions}>
                  <span className={styles.editHint}>
                    escape to{' '}
                    <button
                      className={styles.editLink}
                      onClick={handleCancelEdit}
                      type="button"
                    >
                      cancel
                    </button>
                    {' '}&bull; enter to{' '}
                    <button
                      className={styles.editLink}
                      onClick={() => { void handleSaveEdit(); }}
                      type="button"
                    >
                      save
                    </button>
                  </span>
                </div>
              </div>
            ) : (
              <div className={`${styles.text}${isEmojiOnly(msg.content ?? '').emojiOnly ? ` ${styles.emojiOnly}` : ''}`}>
                {isBareGifUrl(msg.content ?? '') ? (
                  /* Render bare GIF URL as inline image, matching gifv behavior */
                  autoPlayGifs || playingGifIds.has(msg.id) ? (
                    <div className={styles.gifEmbed}>
                      <img
                        src={msg.content.trim()}
                        alt="GIF"
                        className={styles.gifEmbedImage}
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.gifEmbedPaused}
                      onClick={() => handlePlayGif(msg.id)}
                      aria-label="Play GIF"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      GIF
                    </button>
                  )
                ) : (
                  <MarkdownContent content={convertEmoticons ? emojifyEmoticons(msg.content) : msg.content} />
                )}
                {msg.edited_timestamp && (
                  <span
                    className={styles.edited}
                    title={new Date(msg.edited_timestamp).toLocaleString([], {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  >
                    (edited)
                  </span>
                )}
                {isFailed && msg._nonce && (
                  <span className={styles.failedIndicator}>
                    <svg className={styles.failedIcon} viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 0C4.486 0 0 4.486 0 10s4.486 10 10 10 10-4.486 10-10S15.514 0 10 0zm1 15H9v-2h2v2zm0-4H9V5h2v6z" />
                    </svg>
                    Failed to send —{' '}
                    <button
                      className={styles.retryButton}
                      onClick={() => { void handleRetry(msg); }}
                      type="button"
                      aria-label="Retry sending message"
                    >
                      retry
                    </button>
                    {' '}or{' '}
                    <button
                      className={styles.dismissButton}
                      onClick={() => dispatch(removePendingMessage({ nonce: msg._nonce as string, channelId }))}
                      type="button"
                      aria-label="Dismiss failed message"
                    >
                      dismiss
                    </button>
                  </span>
                )}
              </div>
            )}

            {/* Attachments */}
            {msg.attachments && msg.attachments.length > 0 && (
              <MessageAttachments attachments={msg.attachments} />
            )}

            {/* Embeds */}
            {msg.embeds && msg.embeds.length > 0 && embedsEnabled && (
              <div className={styles.embedsList}>
                {msg.embeds.map((embed, embedIdx) => (
                  <MessageEmbed key={embedIdx} embed={embed} />
                ))}
              </div>
            )}

            {/* Reactions */}
            {msg.reactions && msg.reactions.length > 0 && showEmojiReactions && (
              <ReactionBar
                channelId={channelId}
                messageId={msg.id}
                reactions={msg.reactions}
                onAddReaction={(e) => handleOpenReactionPicker(msg.id, (e?.currentTarget as HTMLElement) ?? null)}
              />
            )}
          </div>

          {/* Action bar on hover */}
          {isHovered && !isEditing && !isPending && !isFailed && (
            <div className={styles.actionBar} role="toolbar" aria-label="Message actions">
              {quickReactEmoji.map((qe) => (
                <button
                  key={qe}
                  className={styles.quickReactButton}
                  title={`React with ${qe}`}
                  aria-label={`React with ${qe}`}
                  type="button"
                  onClick={() => handleQuickReact(msg.id, qe)}
                >
                  {qe}
                </button>
              ))}
              <div className={styles.actionButtonWrapper}>
                <Tooltip text="Add Reaction">
                  <button
                    className={styles.actionButton}
                    aria-label="Add Reaction"
                    type="button"
                    onClick={(e) => {
                      handleOpenReactionPicker(msg.id, e.currentTarget);
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M12.001 2C6.478 2 2.001 6.477 2.001 12s4.477 10 10 10 10-4.477 10-10-4.477-10-10-10zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm5.5-9c.828 0 1.5-.672 1.5-1.5S18.329 8 17.501 8s-1.5.672-1.5 1.5.672 1.5 1.5 1.5zm-7 0c.828 0 1.5-.672 1.5-1.5S11.329 8 10.501 8s-1.5.672-1.5 1.5.672 1.5 1.5 1.5zM12 17.5c2.33 0 4.32-1.45 5.116-3.5H6.884A5.508 5.508 0 0 0 12 17.5z"
                      />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              <Tooltip text="Reply">
                <button
                  className={styles.actionButton}
                  aria-label="Reply"
                  onClick={() => handleReply(msg)}
                  type="button"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M10 8.26667V4L3 11.4667L10 18.9333V14.56C15 14.56 18.5 16.2667 21 20C20 14.6667 17 9.33333 10 8.26667Z"
                    />
                  </svg>
                </button>
              </Tooltip>
              {selectedGuildId && (
                <Tooltip text="Create Thread">
                  <button
                    className={styles.actionButton}
                    aria-label="Create Thread"
                    onClick={() => setCreateThreadTarget(msg)}
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M5.43309 21C5.35842 21 5.30189 20.9325 5.31494 20.859L5.99991 17H2.14274C2.06819 17 2.01168 16.9327 2.02458 16.8593L2.33333 15.1927C2.34369 15.133 2.39614 15.0893 2.45149 15.0893H6.34991L7.40991 9H3.55274C3.47819 9 3.42168 8.93274 3.43458 8.85931L3.74333 7.19264C3.75369 7.13296 3.80614 7.08931 3.86149 7.08931H7.75991L8.45234 3.141C8.46263 3.08132 8.51506 3.0377 8.57042 3.0377H10.3215C10.3962 3.0377 10.4527 3.10517 10.4397 3.17862L9.75991 7.08931H15.7599L16.4523 3.141C16.4626 3.08132 16.5151 3.0377 16.5704 3.0377H18.3215C18.3962 3.0377 18.4527 3.10517 18.4397 3.17862L17.7599 7.08931H21.6171C21.6916 7.08931 21.7481 7.15658 21.7352 7.23L21.4265 8.89667C21.4161 8.95635 21.3637 8.99998 21.3083 8.99998H17.4099L16.3499 15.0893H20.2071C20.2816 15.0893 20.3381 15.1566 20.3252 15.23L20.0165 16.8967C20.0061 16.9563 19.9537 17 19.8983 17H15.9999L15.3075 20.859C15.2972 20.9187 15.2447 20.9623 15.1894 20.9623H13.4383C13.3636 20.9623 13.3071 20.8948 13.3201 20.8214L13.9999 17H7.99991L7.30749 20.859C7.2972 20.9187 7.24475 20.9623 7.18939 20.9623H5.43309ZM9.40991 9L8.34991 15.0893H14.3499L15.4099 9H9.40991Z"
                      />
                    </svg>
                  </button>
                </Tooltip>
              )}
              <Tooltip text="Forward">
                <button
                  className={styles.actionButton}
                  aria-label="Forward"
                  onClick={() => handleForwardRequest(msg)}
                  type="button"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M14 8.26667V4L21 11.4667L14 18.9333V14.56C9 14.56 5.5 16.2667 3 20C4 14.6667 7 9.33333 14 8.26667Z"
                    />
                  </svg>
                </button>
              </Tooltip>
              {isAnnouncement && !(msg.flags !== undefined && (msg.flags & MESSAGE_FLAG_CROSSPOSTED) !== 0) && (
                <button
                  className={styles.actionButton}
                  title="Publish"
                  aria-label="Publish message"
                  type="button"
                  data-testid="publish-btn"
                  disabled={publishingMessageIds.has(msg.id)}
                  onClick={() => handlePublish(msg.id)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M3.9 8.26H2V15.2941H3.9V8.26ZM19.1 4V18.4708L16.5 16.8011L13.9 15.1314L11.3 13.4618V4.97877L13.9 3.30907L16.5 1.63938L19.1 0V4ZM14 7.09V10.4L20 7.22V3.33L14 7.09ZM14 12.14V15.45L20 18.63V14.74L14 12.14ZM6 8V14.5H10.5V8H6ZM10.5 15.5H6V22H7.98V18H10.5V15.5Z"
                    />
                  </svg>
                </button>
              )}
              <MessageMoreMenu
                msg={msg}
                isOwnMessage={isOwnMessage}
                canManageMessages={guildPermissions.canManageMessages}
                channelId={channelId}
                selectedGuildId={selectedGuildId}
                onEdit={handleEdit}
                onDelete={handleDeleteRequest}
                onPin={handlePinRequest}
                onForward={handleForwardRequest}
                onCreateThread={selectedGuildId ? (m) => setCreateThreadTarget(m) : undefined}
                onCopyText={(m) => {
                  void navigator.clipboard.writeText(m.content);
                }}
                onCopyMessageLink={(m) => {
                  const guildPart = selectedGuildId ?? '@me';
                  const link = `${window.location.origin}/channels/${guildPart}/${channelId}/${m.id}`;
                  void navigator.clipboard.writeText(link);
                }}
              />
            </div>
          )}
        </div>

        </div>
      </div>
    );
  }, [messages, editingMessageId, currentUserId, hoveredMessageId, editContent, reactionPickerMessageId, lastReadMessageId, presences, handleContextMenu, handleReply, handleEdit, handleDeleteRequest, handleCancelEdit, handleSaveEdit, handleEditKeyDown, handleOpenReactionPicker, handleReactionEmojiSelect, handleCloseReactionPicker, handleJumpToMessage, handleRetry, handleQuickReact, handlePinRequest, handleForwardRequest, handlePublish, publishingMessageIds, isAnnouncement, quickReactEmoji, channelId, selectedGuildId, guildPermissions.canManageMessages, dispatch, getRoleColor, blockedUserIds, revealedBlockedIds, embedsEnabled, showEmojiReactions, autoPlayGifs, playingGifIds, handlePlayGif, convertEmoticons]);

  const Header = useCallback(() => {
    if (isLoadingMore) {
      return (
        <div className={styles.loadingMore} role="status" aria-label="Loading older messages">
          Loading...
        </div>
      );
    }
    if (!hasMore) {
      const channelName = selectedChannel?.name ?? 'channel';
      return (
        <div className={styles.beginning}>
          <div className={styles.welcomeIcon} aria-hidden="true">
            <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41001 9L8.35001 15H14.35L15.41 9H9.41001Z" />
            </svg>
          </div>
          <h1 className={styles.welcomeTitle}>Welcome to #{channelName}!</h1>
          <p className={styles.welcomeDescription}>
            This is where the #{channelName} channel begins.
          </p>
          <div className={styles.welcomeDivider} role="separator" />
        </div>
      );
    }
    return null;
  }, [isLoadingMore, hasMore, selectedChannel?.name]);

  const channelName = selectedChannel?.name ?? 'channel';

  const VirtuosoList = useCallback(
    React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>((props, ref) => (
      <ol {...props} ref={ref} role="list" aria-label={`Messages in ${channelName}`} />
    )),
    [channelName]
  );

  const VirtuosoItem = useCallback(
    (props: React.HTMLAttributes<HTMLLIElement> & { 'data-index': number; 'data-item-index': number; 'data-known-size'?: number }) => (
      <li {...props} />
    ),
    []
  );

  return (
    <main
      className={`${styles.list} ${messageDisplayMode === 'compact' ? styles.compact : ''}`}
      aria-label={`${channelName} (channel)`}
    >
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        totalCount={messages.length}
        itemContent={renderMessage}
        followOutput={followOutput}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={FOLLOW_OUTPUT_THRESHOLD}
        startReached={handleStartReached}
        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
        components={{
          Header,
          List: VirtuosoList as never,
          Item: VirtuosoItem as never,
        }}
        increaseViewportBy={{ top: 400, bottom: 200 }}
        className={styles.virtuosoContainer}
      />
      {!atBottom && messages.length > 0 && (
        <button
          className={styles.jumpToBottom}
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({
              index: messages.length - 1,
              behavior: 'smooth',
            });
          }}
          aria-label="Jump to present"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12L2 6h12L8 12z" />
          </svg>
        </button>
      )}
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          header={contextMenu.header}
        />
      )}
      {/* Reaction emoji picker: portaled to <body> and positioned at the trigger so it
          opens where the user clicked and escapes the virtualized message list. */}
      {reactionPickerMessageId && reactionPickerPos && createPortal(
        <div
          className={styles.reactionPickerContainer}
          style={{ top: reactionPickerPos.top, left: reactionPickerPos.left }}
          data-testid="reaction-picker"
        >
          <EmojiPicker
            onSelect={handleReactionEmojiSelect}
            onClose={handleCloseReactionPicker}
          />
        </div>,
        document.body,
      )}
      {/* Delete confirmation modal (rendered outside message loop to survive Virtuoso re-renders) */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Message"
          description="Are you sure you want to delete this message?"
          confirmLabel="Delete"
          confirmDanger
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        >
          <div className={confirmStyles.messagePreview}>
            <span className={confirmStyles.previewAuthor}>{deleteTarget.author.username}</span>
            <span className={confirmStyles.previewTimestamp}>{formatTime(deleteTarget.timestamp)}</span>
            <div className={confirmStyles.previewContent}>{deleteTarget.content}</div>
          </div>
        </ConfirmModal>
      )}
      {/* Pin confirmation modal (rendered outside message loop) */}
      {pinTarget && (
        <ConfirmModal
          title="Pin Message"
          description={`Pin this message to #${selectedChannel?.name ?? 'channel'}? It will be visible to everyone in this channel.`}
          confirmLabel="Oh yeah. Pin it."
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
        >
          <div className={confirmStyles.messagePreview}>
            <span className={confirmStyles.previewAuthor}>{pinTarget.author.username}</span>
            <span className={confirmStyles.previewTimestamp}>{formatTime(pinTarget.timestamp)}</span>
            <div className={confirmStyles.previewContent}>{pinTarget.content}</div>
          </div>
        </ConfirmModal>
      )}
      {/* Create thread modal */}
      {createThreadTarget && (
        <CreateThreadModal
          channelId={channelId}
          messageId={createThreadTarget.id}
          onClose={() => setCreateThreadTarget(null)}
        />
      )}
      {/* Forward message modal */}
      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
        />
      )}
    </main>
  );
};
