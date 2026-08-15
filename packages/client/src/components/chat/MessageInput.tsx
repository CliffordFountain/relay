import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

const EMPTY_ARRAY: never[] = [];
import { useAppDispatch, useAppSelector } from '../../hooks/useAppDispatch';
import { addPendingMessage, confirmPendingMessage, failPendingMessage } from '../../stores/messagesSlice';
import type { Message } from '../../stores/messagesSlice';
import { setReplyingToMessageId, setEditingMessageId } from '../../stores/uiSlice';
import { addMessage } from '../../stores/messagesSlice';
import { store } from '../../stores/store';
import { api } from '../../api/rest';
import { EmojiPicker, EMOJI_CATEGORIES } from '../emoji/EmojiPicker';
import type { EmojiEntry } from '../emoji/EmojiPicker';
import { GifPicker } from './GifPicker';
import { SlashCommandPalette, BUILT_IN_COMMANDS } from './SlashCommandPalette';
import type { SlashCommand } from './SlashCommandPalette';
import { FormattingToolbar } from './FormattingToolbar';
import type { FormatAction } from './FormattingToolbar';
import { StickerPicker } from '../sticker/StickerPicker';
import { Tooltip } from '../ui/Tooltip';
import styles from './messageInput.module.scss';

const TYPING_DEBOUNCE_MS = 10000;

/** Flat list of all built-in emoji for autocomplete */
const ALL_EMOJI: EmojiEntry[] = Object.values(EMOJI_CATEGORIES).flat();

export interface MessageInputProps {
  channelId: string;
  externalFiles?: File[];
  onExternalFilesConsumed?: () => void;
  slowmodeSeconds?: number;
  onSlowmodeCooldownChange?: (seconds: number) => void;
}

type AutocompleteMode = 'mention' | 'emoji' | 'channel' | 'slash' | null;

export const MessageInput = ({ channelId, externalFiles, onExternalFilesConsumed, slowmodeSeconds = 0, onSlowmodeCooldownChange }: MessageInputProps) => {
  const [content, setContent] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [mentionOnReply, setMentionOnReply] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [slowmodeActive, setSlowmodeActive] = useState(false);
  const [slowmodeCooldownDisplay, setSlowmodeCooldownDisplay] = useState(0);
  const slowmodeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowmodeCooldownRef = useRef(0);
  const dispatch = useAppDispatch();
  const channel = useAppSelector(s => s.channels.channels[channelId]);
  const replyingToMessageId = useAppSelector(s => s.ui.replyingToMessageId);
  const replyingToMessage = useAppSelector(s => {
    if (!replyingToMessageId) return null;
    const msgs = s.messages.messagesByChannel[channelId];
    if (!msgs) return null;
    return msgs.find(m => m.id === replyingToMessageId) ?? null;
  });
  const guildId = channel?.guild_id ?? null;
  const dmChannels = useAppSelector(s => s.dm.dmChannels);

  /** Compute the placeholder text: "Message #channel" for guild channels, "Message @user" for DMs */
  const placeholderText = useMemo(() => {
    if (slowmodeActive) return 'Slowmode is enabled';
    // DM channel: type 1 (DM) or type 3 (group DM), or no guild_id
    const isDm = !guildId || channel?.type === 1 || channel?.type === 3;
    if (isDm) {
      const dmChannel = dmChannels.find(dc => dc.id === channelId);
      if (dmChannel && dmChannel.recipients.length > 0) {
        if (dmChannel.type === 3) {
          // Group DM: show all recipient names
          const names = dmChannel.recipients.map(r => r.username).join(', ');
          return `Message ${names}`;
        }
        const firstRecipient = dmChannel.recipients[0];
        return `Message @${firstRecipient?.username ?? 'user'}`;
      }
      return `Message @${channel?.name || 'user'}`;
    }
    return `Message #${channel?.name || 'channel'}`;
  }, [slowmodeActive, guildId, channel?.type, channel?.name, dmChannels, channelId]);

  const members = useAppSelector(s => {
    if (!guildId) return EMPTY_ARRAY;
    return s.members.membersByGuild[guildId] ?? EMPTY_ARRAY;
  });
  const allChannels = useAppSelector(s => s.channels.channels);

  const currentUser = useAppSelector(s => s.auth.user);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nonceCounterRef = useRef(0);

  // Unified autocomplete state
  const [autocompleteMode, setAutocompleteMode] = useState<AutocompleteMode>(null);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Slash command state
  const [slashQuery, setSlashQuery] = useState('');

  // Formatting toolbar state
  const [formattingToolbar, setFormattingToolbar] = useState<{ top: number; left: number } | null>(null);

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current > TYPING_DEBOUNCE_MS) {
      lastTypingSentRef.current = now;
      void api.sendTyping(channelId);
    }
  }, [channelId]);

  // Reset typing timer when channel changes
  useEffect(() => {
    lastTypingSentRef.current = 0;
  }, [channelId]);

  // Clear slowmode timer when channel changes or component unmounts
  useEffect(() => {
    setSlowmodeActive(false);
    slowmodeCooldownRef.current = 0;
    onSlowmodeCooldownChange?.(0);
    if (slowmodeTimerRef.current) {
      clearInterval(slowmodeTimerRef.current);
      slowmodeTimerRef.current = null;
    }
    return () => {
      if (slowmodeTimerRef.current) {
        clearInterval(slowmodeTimerRef.current);
      }
    };
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSlowmodeCooldown = useCallback(() => {
    if (slowmodeSeconds <= 0) return;
    setSlowmodeActive(true);
    slowmodeCooldownRef.current = slowmodeSeconds;
    setSlowmodeCooldownDisplay(slowmodeSeconds);
    onSlowmodeCooldownChange?.(slowmodeSeconds);

    if (slowmodeTimerRef.current) {
      clearInterval(slowmodeTimerRef.current);
    }

    slowmodeTimerRef.current = setInterval(() => {
      slowmodeCooldownRef.current -= 1;
      setSlowmodeCooldownDisplay(slowmodeCooldownRef.current);
      onSlowmodeCooldownChange?.(slowmodeCooldownRef.current);
      if (slowmodeCooldownRef.current <= 0) {
        setSlowmodeActive(false);
        setSlowmodeCooldownDisplay(0);
        if (slowmodeTimerRef.current) {
          clearInterval(slowmodeTimerRef.current);
          slowmodeTimerRef.current = null;
        }
      }
    }, 1000);
  }, [slowmodeSeconds, onSlowmodeCooldownChange]);

  // Guild channels for #channel autocomplete
  const guildChannels = useMemo(() => {
    if (!guildId) return [];
    return Object.values(allChannels).filter(
      c => c.guild_id === guildId && (c.type === 0 || c.type === 5) && c.name
    );
  }, [allChannels, guildId]);

  // Filtered mention results (includes @everyone / @here)
  const filteredMentions = useMemo(() => {
    if (autocompleteMode !== 'mention') return [];
    const q = autocompleteQuery.toLowerCase();

    // Special entries: @everyone, @here
    const specials: Array<{ type: 'special'; label: string; insert: string }> = [];
    if ('everyone'.startsWith(q) || q === '') {
      specials.push({ type: 'special', label: '@everyone', insert: '@everyone' });
    }
    if ('here'.startsWith(q) || q === '') {
      specials.push({ type: 'special', label: '@here', insert: '@here' });
    }

    const memberResults = members.filter(m => {
      return m.user.username.toLowerCase().includes(q) ||
             (m.nick && m.nick.toLowerCase().includes(q)) ||
             m.user.displayName.toLowerCase().includes(q);
    }).slice(0, 8).map(m => ({
      type: 'member' as const,
      member: m,
    }));

    return [...specials, ...memberResults];
  }, [autocompleteMode, autocompleteQuery, members]);

  // Filtered emoji results
  const filteredEmoji = useMemo(() => {
    if (autocompleteMode !== 'emoji') return [];
    if (autocompleteQuery.length < 2) return [];
    const q = autocompleteQuery.toLowerCase();
    return ALL_EMOJI.filter(e =>
      e.name.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [autocompleteMode, autocompleteQuery]);

  // Filtered channel results
  const filteredChannels = useMemo(() => {
    if (autocompleteMode !== 'channel') return [];
    const q = autocompleteQuery.toLowerCase();
    return guildChannels.filter(c =>
      c.name?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [autocompleteMode, autocompleteQuery, guildChannels]);

  // Filtered slash commands
  const filteredSlashCommands = useMemo(() => {
    if (autocompleteMode !== 'slash') return [];
    const q = slashQuery.toLowerCase();
    return BUILT_IN_COMMANDS.filter(cmd => cmd.name.startsWith(q));
  }, [autocompleteMode, slashQuery]);

  // Total items for the active autocomplete
  const autocompleteItems = autocompleteMode === 'mention' ? filteredMentions
    : autocompleteMode === 'emoji' ? filteredEmoji
    : autocompleteMode === 'channel' ? filteredChannels
    : autocompleteMode === 'slash' ? filteredSlashCommands
    : [];

  const handleSend = useCallback(async () => {
    let trimmed = content.trim();
    const hasPendingFiles = pendingFiles.length > 0;
    if (!trimmed && !hasPendingFiles) return;
    if (slowmodeActive) return;

    // Process slash commands before sending
    const spoilerMatch = /^\/spoiler\s+(.+)$/s.exec(trimmed);
    if (spoilerMatch) {
      trimmed = `||${spoilerMatch[1]}||`;
    }

    const meMatch = /^\/me\s+(.+)$/s.exec(trimmed);
    if (meMatch) {
      trimmed = `*${meMatch[1]}*`;
    }

    const giphyMatch = /^\/giphy\s+(.+)$/s.exec(trimmed);
    if (giphyMatch) {
      // For now, send as a text message with the giphy query indicator
      trimmed = `[GIF Search: ${giphyMatch[1]}]`;
    }

    const shrugMatch = /^\/shrug(?:\s+(.*))?$/s.exec(trimmed);
    if (shrugMatch) {
      const base = shrugMatch[1]?.trim() ?? '';
      trimmed = base ? `${base} \u00AF\\_(\u30C4)_/\u00AF` : '\u00AF\\_(\u30C4)_/\u00AF';
    }

    const tableflipMatch = /^\/tableflip(?:\s+(.*))?$/s.exec(trimmed);
    if (tableflipMatch) {
      const base = tableflipMatch[1]?.trim() ?? '';
      trimmed = base ? `${base} (\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B` : '(\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B';
    }

    const unflipMatch = /^\/unflip(?:\s+(.*))?$/s.exec(trimmed);
    if (unflipMatch) {
      const base = unflipMatch[1]?.trim() ?? '';
      trimmed = base ? `${base} \u252C\u2500\u252C \u30CE( \u309C-\u309C\u30CE)` : '\u252C\u2500\u252C \u30CE( \u309C-\u309C\u30CE)';
    }

    const filesToSend = [...pendingFiles];
    setContent('');
    setPendingFiles([]);
    setUploadError(null);

    if (replyingToMessageId) {
      dispatch(setReplyingToMessageId(null));
      setMentionOnReply(true);
    }

    // If we have files, use the multipart upload path
    if (filesToSend.length > 0) {
      const firstFileName = filesToSend[0]?.name ?? 'file';
      const displayName = filesToSend.length > 1
        ? `${firstFileName} and ${filesToSend.length - 1} more`
        : firstFileName;
      setIsUploading(true);
      setUploadFileName(displayName);
      try {
        const msg = await api.sendMessageWithAttachments(channelId, trimmed, filesToSend);
        dispatch(addMessage(msg as unknown as Message));
        startSlowmodeCooldown();
      } catch {
        setUploadError('Failed to upload file(s). Please try again.');
      } finally {
        setIsUploading(false);
        setUploadFileName(null);
      }
      return;
    }

    // Text-only message with optimistic update
    const nonce = `pending_${Date.now()}_${nonceCounterRef.current++}`;

    const payload: {
      content: string;
      nonce?: string;
      message_reference?: { message_id: string };
      allowed_mentions?: { replied_user: boolean };
    } = {
      content: trimmed,
      nonce,
    };

    if (replyingToMessageId) {
      payload.message_reference = { message_id: replyingToMessageId };
      if (!mentionOnReply) {
        payload.allowed_mentions = { replied_user: false };
      }
    }

    const pendingMsg: Message = {
      id: nonce,
      channel_id: channelId,
      author: {
        id: currentUser?.id ?? '',
        username: currentUser?.username ?? '',
        avatar: currentUser?.avatar ?? null,
      },
      content: trimmed,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      message_reference: payload.message_reference ? { message_id: payload.message_reference.message_id } : null,
      _pending: true,
      _nonce: nonce,
    };
    dispatch(addPendingMessage(pendingMsg));

    try {
      const msg = await api.sendMessage(channelId, payload);
      dispatch(confirmPendingMessage({
        nonce,
        channelId,
        confirmedMessage: msg as unknown as Message,
      }));
      startSlowmodeCooldown();
    } catch {
      dispatch(failPendingMessage({ nonce, channelId }));
    }
  }, [content, channelId, replyingToMessageId, mentionOnReply, dispatch, currentUser, pendingFiles, slowmodeActive, startSlowmodeCooldown]);

  // Detect autocomplete triggers from text near cursor
  const detectAutocomplete = useCallback((text: string, curPos: number) => {
    const before = text.slice(0, curPos);

    // Check for /slash command: "/" at the very start of the text
    const slashMatch = /^\/(\w*)$/.exec(text.slice(0, curPos));
    if (slashMatch && text.startsWith('/')) {
      setAutocompleteMode('slash');
      setSlashQuery(slashMatch[1] ?? '');
      setAutocompleteIndex(0);
      return;
    }

    // Check for @mention: @ followed by optional word chars
    const mentionMatch = /@(\w*)$/.exec(before);
    if (mentionMatch) {
      setAutocompleteMode('mention');
      setAutocompleteQuery(mentionMatch[1] ?? '');
      setAutocompleteIndex(0);
      return;
    }

    // Check for :emoji: autocomplete: : followed by 2+ word chars (not preceded by another :)
    const emojiMatch = /(?:^|[^:]):(\w{2,})$/.exec(before);
    if (emojiMatch) {
      setAutocompleteMode('emoji');
      setAutocompleteQuery(emojiMatch[1] ?? '');
      setAutocompleteIndex(0);
      return;
    }

    // Check for #channel: # followed by optional word chars (but only after whitespace or start of line)
    const channelMatch = /(?:^|\s)#(\w*)$/.exec(before);
    if (channelMatch) {
      setAutocompleteMode('channel');
      setAutocompleteQuery(channelMatch[1] ?? '');
      setAutocompleteIndex(0);
      return;
    }

    setAutocompleteMode(null);
  }, []);

  const insertAutocomplete = useCallback((insertText: string, triggerChar: string) => {
    const before = content.slice(0, cursorPosition);
    const after = content.slice(cursorPosition);

    // Find the trigger position and replace
    let triggerPattern: RegExp;
    if (triggerChar === '@') {
      triggerPattern = /@(\w*)$/;
    } else if (triggerChar === ':') {
      triggerPattern = /:(\w{2,})$/;
    } else {
      triggerPattern = /#(\w*)$/;
    }

    const match = triggerPattern.exec(before);
    if (match) {
      const newBefore = before.slice(0, match.index) + insertText + ' ';
      setContent(newBefore + after);
      // Move cursor to after the insert
      const newPos = newBefore.length;
      setCursorPosition(newPos);
      // Set cursor in the textarea
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = newPos;
          inputRef.current.selectionEnd = newPos;
        }
      }, 0);
    }
    setAutocompleteMode(null);
    inputRef.current?.focus();
  }, [content, cursorPosition]);

  // Handle slash command selection (must be defined before handleAutocompleteSelect)
  const handleSlashCommandSelect = useCallback((cmd: SlashCommand) => {
    setAutocompleteMode(null);
    setSlashQuery('');

    // Execute the command
    switch (cmd.name) {
      case 'shrug':
        setContent(prev => {
          const base = prev.replace(/^\/shrug\s*/, '').trim();
          return base ? `${base} \u00AF\\_(\u30C4)_/\u00AF` : '\u00AF\\_(\u30C4)_/\u00AF';
        });
        break;
      case 'tableflip':
        setContent(prev => {
          const base = prev.replace(/^\/tableflip\s*/, '').trim();
          return base ? `${base} (\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B` : '(\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B';
        });
        break;
      case 'unflip':
        setContent(prev => {
          const base = prev.replace(/^\/unflip\s*/, '').trim();
          return base ? `${base} \u252C\u2500\u252C \u30CE( \u309C-\u309C\u30CE)` : '\u252C\u2500\u252C \u30CE( \u309C-\u309C\u30CE)';
        });
        break;
      case 'spoiler':
        // Replace /spoiler with placeholder, user fills in text
        setContent('/spoiler ');
        break;
      case 'me':
        // Replace /me with placeholder, user fills in action text
        setContent('/me ');
        break;
      case 'giphy':
        // Replace /giphy with placeholder, user fills in search query
        setContent('/giphy ');
        break;
      default:
        setContent('');
        break;
    }
    inputRef.current?.focus();
  }, []);

  const handleAutocompleteSelect = useCallback((index: number) => {
    if (autocompleteMode === 'mention') {
      const item = filteredMentions[index];
      if (!item) return;
      if (item.type === 'special') {
        insertAutocomplete(item.insert, '@');
      } else {
        insertAutocomplete(`<@${item.member.user.id}>`, '@');
      }
    } else if (autocompleteMode === 'emoji') {
      const emoji = filteredEmoji[index];
      if (!emoji) return;
      insertAutocomplete(emoji.char, ':');
    } else if (autocompleteMode === 'channel') {
      const chan = filteredChannels[index];
      if (!chan) return;
      insertAutocomplete(`<#${chan.id}>`, '#');
    } else if (autocompleteMode === 'slash') {
      const cmd = filteredSlashCommands[index];
      if (!cmd) return;
      handleSlashCommandSelect(cmd);
    }
  }, [autocompleteMode, filteredMentions, filteredEmoji, filteredChannels, filteredSlashCommands, insertAutocomplete, handleSlashCommandSelect]);

  // Handle formatting toolbar actions
  const handleFormat = useCallback((action: FormatAction) => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return; // No selection

    const selected = content.slice(start, end);
    let wrapped: string;
    switch (action) {
      case 'bold':
        wrapped = `**${selected}**`;
        break;
      case 'italic':
        wrapped = `*${selected}*`;
        break;
      case 'underline':
        wrapped = `__${selected}__`;
        break;
      case 'strikethrough':
        wrapped = `~~${selected}~~`;
        break;
      case 'code':
        wrapped = `\`${selected}\``;
        break;
      case 'spoiler':
        wrapped = `||${selected}||`;
        break;
    }

    const newContent = content.slice(0, start) + wrapped + content.slice(end);
    setContent(newContent);
    setFormattingToolbar(null);

    // Restore cursor after the wrapped text
    const newCursorPos = start + wrapped.length;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.selectionStart = newCursorPos;
        inputRef.current.selectionEnd = newCursorPos;
        inputRef.current.focus();
      }
    }, 0);
  }, [content]);

  // Detect text selection for formatting toolbar
  const handleSelect = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end || start === undefined || end === undefined) {
      setFormattingToolbar(null);
      return;
    }

    // Position the toolbar above the textarea
    const rect = textarea.getBoundingClientRect();
    // Approximate: center toolbar horizontally over textarea, above it
    setFormattingToolbar({
      top: rect.top,
      left: rect.left + rect.width / 2,
    });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Keyboard shortcuts for formatting
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const textarea = inputRef.current;
      if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
        switch (e.key.toLowerCase()) {
          case 'b':
            e.preventDefault();
            handleFormat('bold');
            return;
          case 'i':
            e.preventDefault();
            handleFormat('italic');
            return;
          case 'u':
            e.preventDefault();
            handleFormat('underline');
            return;
        }
      }
    }

    // Autocomplete navigation
    if (autocompleteMode !== null && autocompleteItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIndex(prev => (prev + 1) % autocompleteItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIndex(prev => (prev - 1 + autocompleteItems.length) % autocompleteItems.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        handleAutocompleteSelect(autocompleteIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocompleteMode(null);
        return;
      }
    }

    // Up arrow to edit last own message when input is empty
    if (e.key === 'ArrowUp' && content.trim() === '') {
      const channelMessages = store.getState().messages.messagesByChannel[channelId];
      if (channelMessages) {
        for (let i = channelMessages.length - 1; i >= 0; i--) {
          const msg = channelMessages[i];
          if (msg && msg.author.id === currentUser?.id && !msg._pending && !msg._failed) {
            e.preventDefault();
            dispatch(setEditingMessageId(msg.id));
            break;
          }
        }
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && replyingToMessageId) {
      dispatch(setReplyingToMessageId(null));
    }
  }, [handleSend, replyingToMessageId, dispatch, autocompleteMode, autocompleteItems.length, autocompleteIndex, handleAutocompleteSelect, content, channelId, currentUser, handleFormat]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    const curPos = e.target.selectionStart ?? newContent.length;
    setCursorPosition(curPos);
    detectAutocomplete(newContent, curPos);

    if (newContent.trim().length > 0) {
      sendTyping();
    }
  }, [detectAutocomplete, sendTyping]);

  const handleCancelReply = useCallback(() => {
    dispatch(setReplyingToMessageId(null));
  }, [dispatch]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setContent(prev => prev + emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  }, []);

  const handleGifSelect = useCallback(async (gifUrl: string) => {
    setShowGifPicker(false);

    // Send GIF as a message with the URL as content (the behavior)
    const nonce = `pending_${Date.now()}_${nonceCounterRef.current++}`;

    const payload: {
      content: string;
      nonce?: string;
      message_reference?: { message_id: string };
      allowed_mentions?: { replied_user: boolean };
    } = {
      content: gifUrl,
      nonce,
    };

    if (replyingToMessageId) {
      payload.message_reference = { message_id: replyingToMessageId };
      if (!mentionOnReply) {
        payload.allowed_mentions = { replied_user: false };
      }
      dispatch(setReplyingToMessageId(null));
      setMentionOnReply(true);
    }

    const pendingMsg: Message = {
      id: nonce,
      channel_id: channelId,
      author: {
        id: currentUser?.id ?? '',
        username: currentUser?.username ?? '',
        avatar: currentUser?.avatar ?? null,
      },
      content: gifUrl,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      message_reference: payload.message_reference ? { message_id: payload.message_reference.message_id } : null,
      _pending: true,
      _nonce: nonce,
    };
    dispatch(addPendingMessage(pendingMsg));

    try {
      const msg = await api.sendMessage(channelId, payload);
      dispatch(confirmPendingMessage({
        nonce,
        channelId,
        confirmedMessage: msg as unknown as Message,
      }));
      startSlowmodeCooldown();
    } catch {
      dispatch(failPendingMessage({ nonce, channelId }));
    }
  }, [channelId, replyingToMessageId, mentionOnReply, dispatch, currentUser, startSlowmodeCooldown]);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const addPendingFiles = useCallback((fileList: File[]) => {
    setPendingFiles(prev => [...prev, ...fileList]);
    setUploadError(null);
    inputRef.current?.focus();
  }, []);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    addPendingFiles(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addPendingFiles]);

  // Handle files dropped from ChatArea drag-and-drop
  useEffect(() => {
    if (externalFiles && externalFiles.length > 0) {
      addPendingFiles(externalFiles);
      onExternalFilesConsumed?.();
    }
  }, [externalFiles, addPendingFiles, onExternalFilesConsumed]);

  // Handle paste-to-upload
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = e.clipboardData.files;
    if (clipboardFiles.length > 0) {
      e.preventDefault();
      addPendingFiles(Array.from(clipboardFiles));
    }
  }, [addPendingFiles]);

  return (
    <div className={styles.container}>
      {replyingToMessage && (
        <div className={styles.replyBar} role="status" aria-label={`Replying to ${replyingToMessage.author.username}`}>
          <div className={styles.replyInfo}>
            <svg width="20" height="20" viewBox="0 0 24 24" className={styles.replyIcon}>
              <path
                fill="currentColor"
                d="M10 8.26667V4L3 11.4667L10 18.9333V14.56C15 14.56 18.5 16.2667 21 20C20 14.6667 17 9.33333 10 8.26667Z"
              />
            </svg>
            <span className={styles.replyLabel}>
              Replying to <strong>{replyingToMessage.author.username}</strong>
            </span>
          </div>
          <div className={styles.replyActions}>
            <button
              className={`${styles.mentionToggle} ${mentionOnReply ? styles.mentionToggleActive : ''}`}
              onClick={() => setMentionOnReply(prev => !prev)}
              aria-label={mentionOnReply ? 'Mention on: click to disable' : 'Mention off: click to enable'}
              title={mentionOnReply ? 'Click to disable mention' : 'Click to enable mention'}
              type="button"
            >
              @
            </button>
            <button
              className={styles.replyCancelButton}
              onClick={handleCancelReply}
              aria-label="Cancel reply"
              title="Cancel reply"
              type="button"
            >
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
              />
            </svg>
          </button>
          </div>
        </div>
      )}
      {uploadError && (
        <div className={styles.uploadError} role="alert">
          <span>{uploadError}</span>
          <button
            className={styles.uploadErrorDismiss}
            onClick={() => setUploadError(null)}
            type="button"
            aria-label="Dismiss error"
          >
            <svg width="14" height="14" viewBox="0 0 24 24">
              <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className={styles.pendingFiles} role="list" aria-label="Files to upload">
          {pendingFiles.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className={styles.pendingFileItem} role="listitem">
              <div className={styles.pendingFilePreview}>
                {file.type.startsWith('image/') ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className={styles.pendingFileThumb}
                  />
                ) : (
                  <div className={styles.pendingFileIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M6 2C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2H6ZM13 9V3.5L18.5 9H13Z" />
                    </svg>
                  </div>
                )}
              </div>
              <span className={styles.pendingFileName}>{file.name}</span>
              <span className={styles.pendingFileSize}>
                {file.size < 1024
                  ? `${file.size} B`
                  : file.size < 1024 * 1024
                    ? `${(file.size / 1024).toFixed(1)} KB`
                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
              </span>
              <button
                className={styles.pendingFileRemove}
                onClick={() => removePendingFile(idx)}
                type="button"
                aria-label={`Remove ${file.name}`}
                title="Remove file"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {isUploading && (
        <div className={styles.uploadProgress} role="status" aria-label="Uploading file">
          <div className={styles.uploadProgressBar} />
          <span className={styles.uploadProgressText}>
            Uploading {uploadFileName}...
          </span>
        </div>
      )}
      <form className={`${styles.inputWrapper} ${replyingToMessage ? styles.hasReply : ''} ${isUploading || pendingFiles.length > 0 ? styles.hasUpload : ''}`} onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
        <Tooltip text="Attach" position="top">
          <button
            className={styles.attachBtn}
            onClick={handleAttachClick}
            aria-label="More message options"
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <path
                fill="currentColor"
                d="M13 7H11V11H7V13H11V17H13V13H17V11H13V7Z"
              />
            </svg>
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          className={styles.fileInput}
          onChange={handleFileChange}
          multiple
          aria-hidden="true"
          tabIndex={-1}
        />
        <div className={styles.inputArea}>
          {/* Unified autocomplete popup */}
          {autocompleteMode === 'mention' && filteredMentions.length > 0 && (
            <div className={styles.autocompletePopup} role="listbox" aria-label="Mention suggestions">
              {filteredMentions.map((item, i) => (
                <button
                  key={item.type === 'special' ? item.label : item.member.user.id}
                  className={`${styles.autocompleteItem} ${i === autocompleteIndex ? styles.autocompleteItemActive : ''}`}
                  onClick={() => handleAutocompleteSelect(i)}
                  onMouseEnter={() => setAutocompleteIndex(i)}
                  role="option"
                  aria-selected={i === autocompleteIndex}
                  type="button"
                >
                  {item.type === 'special' ? (
                    <>
                      <div className={styles.mentionAvatar}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.794 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006ZM20 20.006H22V19.006C22 16.165 19.834 14.144 16.97 13.256C18.835 14.446 20 16.329 20 18.006V20.006Z" />
                        </svg>
                      </div>
                      <span className={styles.mentionName}>{item.label}</span>
                    </>
                  ) : (
                    <>
                      <div className={styles.mentionAvatar}>
                        {item.member.user.username.charAt(0).toUpperCase()}
                      </div>
                      <span className={styles.mentionName}>{item.member.nick ?? item.member.user.displayName}</span>
                      <span className={styles.mentionUsername}>{item.member.user.username}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}

          {autocompleteMode === 'emoji' && filteredEmoji.length > 0 && (
            <div className={styles.autocompletePopup} role="listbox" aria-label="Emoji suggestions">
              {filteredEmoji.map((emoji, i) => (
                <button
                  key={`${emoji.char}-${emoji.name}`}
                  className={`${styles.autocompleteItem} ${i === autocompleteIndex ? styles.autocompleteItemActive : ''}`}
                  onClick={() => handleAutocompleteSelect(i)}
                  onMouseEnter={() => setAutocompleteIndex(i)}
                  role="option"
                  aria-selected={i === autocompleteIndex}
                  type="button"
                >
                  <span className={styles.emojiPreview}>{emoji.char}</span>
                  <span className={styles.emojiName}>{emoji.name}</span>
                </button>
              ))}
            </div>
          )}

          {autocompleteMode === 'channel' && filteredChannels.length > 0 && (
            <div className={styles.autocompletePopup} role="listbox" aria-label="Channel suggestions">
              {filteredChannels.map((chan, i) => (
                <button
                  key={chan.id}
                  className={`${styles.autocompleteItem} ${i === autocompleteIndex ? styles.autocompleteItemActive : ''}`}
                  onClick={() => handleAutocompleteSelect(i)}
                  onMouseEnter={() => setAutocompleteIndex(i)}
                  role="option"
                  aria-selected={i === autocompleteIndex}
                  type="button"
                >
                  <span className={styles.channelHash}>#</span>
                  <span className={styles.channelName}>{chan.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Slash command palette */}
          {autocompleteMode === 'slash' && filteredSlashCommands.length > 0 && (
            <SlashCommandPalette
              query={slashQuery}
              selectedIndex={autocompleteIndex}
              onSelect={handleSlashCommandSelect}
              onHover={setAutocompleteIndex}
            />
          )}

          {/* Formatting toolbar */}
          {formattingToolbar && (
            <FormattingToolbar
              position={formattingToolbar}
              onFormat={handleFormat}
            />
          )}

          <textarea
            ref={inputRef}
            className={`${styles.input} ${slowmodeActive ? styles.inputDisabled : ''}`}
            placeholder={placeholderText}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onSelect={handleSelect}
            onBlur={() => {
              // Delay hiding so toolbar button clicks can fire
              setTimeout(() => setFormattingToolbar(null), 200);
            }}
            rows={1}
            aria-label={`Message #${channel?.name || 'channel'}`}
            disabled={slowmodeActive}
          />
          {slowmodeActive && (
            <div className={styles.slowmodeCooldownOverlay} role="status" aria-label={`Slowmode: ${slowmodeCooldownDisplay} seconds remaining`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm1-13h-2v6l5.25 3.15.75-1.23-4-2.42V7z" />
              </svg>
              <span>{slowmodeCooldownDisplay}s</span>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <div className={styles.toolbarBtnWrapper}>
            <Tooltip text="GIF" position="top">
              <button
                className={styles.toolbarBtn}
                onClick={() => { setShowGifPicker(prev => !prev); setShowStickerPicker(false); setShowEmojiPicker(false); }}
                aria-label="Open GIF picker"
                type="button"
              >
                <span className={styles.gifLabel} aria-hidden="true">GIF</span>
              </button>
            </Tooltip>
            {showGifPicker && (
              <GifPicker
                onSelect={(url) => void handleGifSelect(url)}
                onClose={() => setShowGifPicker(false)}
              />
            )}
          </div>
          <div className={styles.toolbarBtnWrapper}>
            <Tooltip text="Sticker" position="top">
              <button
                className={styles.toolbarBtn}
                onClick={() => { setShowStickerPicker(prev => !prev); setShowGifPicker(false); setShowEmojiPicker(false); }}
                aria-label="Open sticker picker"
                type="button"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" clipRule="evenodd" d="M5 2h14a3 3 0 0 1 3 3v8.5a2 2 0 0 1-.59 1.41l-5.5 5.5A2 2 0 0 1 13.5 21H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm3.75 7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm6.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm-6.9 5.05a.75.75 0 0 0-1.2.9 5 5 0 0 0 8 0 .75.75 0 1 0-1.2-.9 3.5 3.5 0 0 1-5.6 0ZM14 20.6V16a1.5 1.5 0 0 1 1.5-1.5h4.6a.5.5 0 0 1-.1.16l-5.44 5.44a.5.5 0 0 1-.16.1.5.5 0 0 1-.4.4Z" />
                </svg>
              </button>
            </Tooltip>
            {showStickerPicker && (
              <StickerPicker
                onSelect={(sticker) => {
                  setContent(prev => prev + sticker);
                  setShowStickerPicker(false);
                  inputRef.current?.focus();
                }}
                onClose={() => setShowStickerPicker(false)}
              />
            )}
          </div>
          <Tooltip text="Emoji" position="top">
            <button
              className={styles.emojiBtn}
              onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowGifPicker(false); setShowStickerPicker(false); }}
              aria-label="Add Emoji"
              type="button"
            >
              <svg width="24" height="24" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8zm3.5-9c.828 0 1.5-.672 1.5-1.5S16.328 8 15.5 8 14 8.672 14 9.5s.672 1.5 1.5 1.5zm-7 0c.828 0 1.5-.672 1.5-1.5S9.328 8 8.5 8 7 8.672 7 9.5 7.672 11 8.5 11zm3.5 6.5c2.33 0 4.32-1.45 5.116-3.5H6.884A5.508 5.508 0 0 0 12 17.5z"
                />
              </svg>
            </button>
          </Tooltip>
          {showEmojiPicker && (
            <EmojiPicker
              onSelect={handleEmojiSelect}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}
        </div>
      </form>
    </div>
  );
};
