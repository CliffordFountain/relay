import { Fragment, useState, useCallback, useMemo, type ReactNode, type MouseEvent } from 'react';

const EMPTY_ARRAY: never[] = [];
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import { useAppSelector } from '../hooks/useAppDispatch';
import styles from './markdown.module.scss';
import '../styles/codeHighlight.scss';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('sql', sql);

/**
 * A parsed token from the markdown content.
 */
type Token =
  | { type: 'text'; content: string }
  | { type: 'codeBlock'; content: string; language: string }
  | { type: 'inlineCode'; content: string }
  | { type: 'bold'; children: Token[] }
  | { type: 'italic'; children: Token[] }
  | { type: 'underline'; children: Token[] }
  | { type: 'strikethrough'; children: Token[] }
  | { type: 'spoiler'; children: Token[] }
  | { type: 'blockquote'; children: Token[] }
  | { type: 'link'; href: string; children: Token[] }
  | { type: 'autoLink'; href: string }
  | { type: 'heading'; level: 1 | 2 | 3; children: Token[] }
  | { type: 'subtext'; children: Token[] }
  | { type: 'userMention'; userId: string }
  | { type: 'roleMention'; roleId: string }
  | { type: 'channelMention'; channelId: string }
  | { type: 'timestamp'; unix: number; style: string };

/**
 * Parse inline markdown tokens from a string.
 * Processes patterns in priority order to handle nesting correctly.
 */
function parseInline(text: string): Token[] {
  const tokens: Token[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliestIndex = remaining.length;
    let matched: { index: number; end: number; token: Token } | null = null;

    // Inline code (highest priority for inline, no nesting)
    const inlineCodeMatch = remaining.match(/`([^`]+)`/);
    if (inlineCodeMatch && inlineCodeMatch.index !== undefined && inlineCodeMatch.index < earliestIndex) {
      earliestIndex = inlineCodeMatch.index;
      matched = {
        index: inlineCodeMatch.index,
        end: inlineCodeMatch.index + inlineCodeMatch[0].length,
        token: { type: 'inlineCode', content: inlineCodeMatch[1] ?? '' },
      };
    }

    // User mention <@USER_ID> or <@!USER_ID> (nickname)
    const userMentionMatch = remaining.match(/<@!?(\w+)>/);
    if (userMentionMatch && userMentionMatch.index !== undefined && userMentionMatch.index < earliestIndex) {
      earliestIndex = userMentionMatch.index;
      matched = {
        index: userMentionMatch.index,
        end: userMentionMatch.index + userMentionMatch[0].length,
        token: { type: 'userMention', userId: userMentionMatch[1] ?? '' },
      };
    }

    // Role mention <@&ROLE_ID>
    const roleMentionMatch = remaining.match(/<@&(\w+)>/);
    if (roleMentionMatch && roleMentionMatch.index !== undefined && roleMentionMatch.index < earliestIndex) {
      earliestIndex = roleMentionMatch.index;
      matched = {
        index: roleMentionMatch.index,
        end: roleMentionMatch.index + roleMentionMatch[0].length,
        token: { type: 'roleMention', roleId: roleMentionMatch[1] ?? '' },
      };
    }

    // Channel mention <#CHANNEL_ID>
    const channelMentionMatch = remaining.match(/<#(\w+)>/);
    if (channelMentionMatch && channelMentionMatch.index !== undefined && channelMentionMatch.index < earliestIndex) {
      earliestIndex = channelMentionMatch.index;
      matched = {
        index: channelMentionMatch.index,
        end: channelMentionMatch.index + channelMentionMatch[0].length,
        token: { type: 'channelMention', channelId: channelMentionMatch[1] ?? '' },
      };
    }

    // Timestamp <t:UNIX> or <t:UNIX:STYLE>
    const timestampMatch = remaining.match(/<t:(\d+)(?::([tTdDfFR]))?>/);
    if (timestampMatch && timestampMatch.index !== undefined && timestampMatch.index < earliestIndex) {
      earliestIndex = timestampMatch.index;
      matched = {
        index: timestampMatch.index,
        end: timestampMatch.index + timestampMatch[0].length,
        token: { type: 'timestamp', unix: parseInt(timestampMatch[1] ?? '', 10), style: timestampMatch[2] ?? 'f' },
      };
    }

    // Bold **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index !== undefined && boldMatch.index < earliestIndex) {
      earliestIndex = boldMatch.index;
      matched = {
        index: boldMatch.index,
        end: boldMatch.index + boldMatch[0].length,
        token: { type: 'bold', children: parseInline(boldMatch[1] ?? '') },
      };
    }

    // Underline __text__
    const underlineMatch = remaining.match(/__(.+?)__/);
    if (underlineMatch && underlineMatch.index !== undefined && underlineMatch.index < earliestIndex) {
      earliestIndex = underlineMatch.index;
      matched = {
        index: underlineMatch.index,
        end: underlineMatch.index + underlineMatch[0].length,
        token: { type: 'underline', children: parseInline(underlineMatch[1] ?? '') },
      };
    }

    // Italic *text* (but not **)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    if (italicMatch && italicMatch.index !== undefined && italicMatch.index < earliestIndex) {
      earliestIndex = italicMatch.index;
      matched = {
        index: italicMatch.index,
        end: italicMatch.index + italicMatch[0].length,
        token: { type: 'italic', children: parseInline(italicMatch[1] ?? '') },
      };
    }

    // Italic _text_ (but not __)
    const italicUnderMatch = remaining.match(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/);
    if (italicUnderMatch && italicUnderMatch.index !== undefined && italicUnderMatch.index < earliestIndex) {
      earliestIndex = italicUnderMatch.index;
      matched = {
        index: italicUnderMatch.index,
        end: italicUnderMatch.index + italicUnderMatch[0].length,
        token: { type: 'italic', children: parseInline(italicUnderMatch[1] ?? '') },
      };
    }

    // Strikethrough ~~text~~
    const strikeMatch = remaining.match(/~~(.+?)~~/);
    if (strikeMatch && strikeMatch.index !== undefined && strikeMatch.index < earliestIndex) {
      earliestIndex = strikeMatch.index;
      matched = {
        index: strikeMatch.index,
        end: strikeMatch.index + strikeMatch[0].length,
        token: { type: 'strikethrough', children: parseInline(strikeMatch[1] ?? '') },
      };
    }

    // Spoiler ||text||
    const spoilerMatch = remaining.match(/\|\|(.+?)\|\|/);
    if (spoilerMatch && spoilerMatch.index !== undefined && spoilerMatch.index < earliestIndex) {
      earliestIndex = spoilerMatch.index;
      matched = {
        index: spoilerMatch.index,
        end: spoilerMatch.index + spoilerMatch[0].length,
        token: { type: 'spoiler', children: parseInline(spoilerMatch[1] ?? '') },
      };
    }

    // Masked link [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined && linkMatch.index < earliestIndex) {
      earliestIndex = linkMatch.index;
      matched = {
        index: linkMatch.index,
        end: linkMatch.index + linkMatch[0].length,
        token: { type: 'link', href: linkMatch[2] ?? '', children: parseInline(linkMatch[1] ?? '') },
      };
    }

    // Auto-link bare URLs (only if not already inside a masked link)
    const autoLinkMatch = remaining.match(/https?:\/\/[^\s<>)\]]+/);
    if (autoLinkMatch && autoLinkMatch.index !== undefined && autoLinkMatch.index < earliestIndex) {
      earliestIndex = autoLinkMatch.index;
      matched = {
        index: autoLinkMatch.index,
        end: autoLinkMatch.index + autoLinkMatch[0].length,
        token: { type: 'autoLink', href: autoLinkMatch[0] },
      };
    }

    if (matched) {
      // Add any text before the match
      if (matched.index > 0) {
        tokens.push({ type: 'text', content: remaining.substring(0, matched.index) });
      }
      tokens.push(matched.token);
      remaining = remaining.substring(matched.end);
    } else {
      // No more matches - rest is plain text
      tokens.push({ type: 'text', content: remaining });
      remaining = '';
    }
  }

  return tokens;
}

/**
 * Parse full markdown content including block-level elements.
 */
function parseMarkdown(content: string): Token[] {
  const tokens: Token[] = [];

  // First extract code blocks (they take highest priority)
  const parts = content.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    const codeBlockMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
      tokens.push({ type: 'codeBlock', language: codeBlockMatch[1] ?? '', content: (codeBlockMatch[2] ?? '').replace(/^\n+|\n+$/g, '') });
      continue;
    }

    // Process line by line for blockquotes, headings, then inline for everything else
    const lines = part.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line === undefined) {
        i++;
        continue;
      }

      // Headings: # text, ## text, ### text (must be at start of line)
      const headingMatch = line.match(/^(#{1,3}) (.+)$/);
      if (headingMatch) {
        const level = (headingMatch[1] ?? '').length as 1 | 2 | 3;
        tokens.push({ type: 'heading', level, children: parseInline(headingMatch[2] ?? '') });
        if (i < lines.length - 1) {
          tokens.push({ type: 'text', content: '\n' });
        }
        i++;
        continue;
      }

      // Subtext: -# text (small greyed text)
      const subtextMatch = line.match(/^-# (.+)$/);
      if (subtextMatch) {
        tokens.push({ type: 'subtext', children: parseInline(subtextMatch[1] ?? '') });
        if (i < lines.length - 1) {
          tokens.push({ type: 'text', content: '\n' });
        }
        i++;
        continue;
      }

      const bqMatch = line.match(/^> (.+)$/);
      if (bqMatch) {
        tokens.push({ type: 'blockquote', children: parseInline(bqMatch[1] ?? '') });
      } else if (line.length > 0) {
        const inlineTokens = parseInline(line);
        tokens.push(...inlineTokens);
      }
      // Add newline between lines (not after last)
      if (i < lines.length - 1) {
        tokens.push({ type: 'text', content: '\n' });
      }
      i++;
    }
  }

  return tokens;
}

/**
 * Spoiler component that reveals on click.
 */
function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  const handleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setRevealed((prev) => !prev);
  }, []);

  return (
    <span
      className={`${styles.spoiler} ${revealed ? styles.revealed : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      {children}
    </span>
  );
}

/**
 * Format a reference timestamp based on the given style.
 *
 * Styles:
 * t = short time (e.g. 4:20 PM)
 * T = long time (e.g. 4:20:30 PM)
 * d = short date (e.g. 03/23/2026)
 * D = long date (e.g. March 23, 2026)
 * f = short datetime (default) (e.g. March 23, 2026 4:20 PM)
 * F = long datetime (e.g. Tuesday, March 23, 2026 4:20 PM)
 * R = relative (e.g. 2 hours ago)
 */
function formatTimestamp(unix: number, style: string): string {
  const date = new Date(unix * 1000);

  switch (style) {
    case 't':
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    case 'T':
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    case 'd':
      return date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
    case 'D':
      return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    case 'f':
      return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) +
        ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    case 'F':
      return date.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) +
        ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    case 'R': {
      const now = Date.now();
      const diffMs = now - date.getTime();
      const absDiff = Math.abs(diffMs);
      const seconds = Math.floor(absDiff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      const past = diffMs >= 0;
      if (seconds < 60) return past ? 'just now' : 'in a few seconds';
      if (minutes < 60) return past ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
      if (hours < 24) return past ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `in ${hours} hour${hours === 1 ? '' : 's'}`;
      return past ? `${days} day${days === 1 ? '' : 's'} ago` : `in ${days} day${days === 1 ? '' : 's'}`;
    }
    default:
      return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) +
        ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

/**
 * User mention pill component that looks up the user's display name.
 */
function UserMentionPill({ userId }: { userId: string }) {
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const members = useAppSelector(s => {
    if (!selectedGuildId) return EMPTY_ARRAY;
    return s.members.membersByGuild[selectedGuildId] ?? EMPTY_ARRAY;
  });

  const member = members.find(m => m.user.id === userId);
  const displayName = member?.nick ?? member?.user.displayName ?? member?.user.username ?? 'Unknown User';

  return (
    <span className={styles.mention} role="button" tabIndex={0} aria-label={`@${displayName}`}>
      @{displayName}
    </span>
  );
}

/**
 * Role mention pill component that looks up the role name and color.
 */
function RoleMentionPill({ roleId }: { roleId: string }) {
  const selectedGuildId = useAppSelector(s => s.guilds.selectedGuildId);
  const roles = useAppSelector(s => {
    if (!selectedGuildId) return EMPTY_ARRAY;
    return s.roles.rolesByGuild[selectedGuildId] ?? EMPTY_ARRAY;
  });

  const role = roles.find(r => r.id === roleId);
  const roleName = role?.name ?? 'Unknown Role';
  const roleColor = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined;

  return (
    <span
      className={styles.roleMention}
      role="button"
      tabIndex={0}
      aria-label={`@${roleName}`}
      style={roleColor && roleColor !== '#000000' ? {
        color: roleColor,
        backgroundColor: `${roleColor}1a`,
      } : undefined}
    >
      @{roleName}
    </span>
  );
}

/**
 * Channel mention pill component that looks up the channel name.
 */
function ChannelMentionPill({ channelId }: { channelId: string }) {
  const channel = useAppSelector(s => s.channels.channels[channelId]);
  const channelName = channel?.name ?? 'unknown-channel';

  const handleClick = useCallback(() => {
    // Navigate to the channel
    const guildId = channel?.guild_id;
    if (guildId) {
      window.location.hash = `/channels/${guildId}/${channelId}`;
    }
  }, [channel?.guild_id, channelId]);

  return (
    <span
      className={styles.channelMention}
      role="link"
      tabIndex={0}
      aria-label={`#${channelName}`}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" className={styles.channelMentionIcon}>
        <path fill="currentColor" d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 9L8.35045 15H14.3504L15.4104 9H9.41045Z" />
      </svg>
      {channelName}
    </span>
  );
}

/**
 * Timestamp component that formats a reference timestamp token.
 */
function TimestampDisplay({ unix, style }: { unix: number; style: string }) {
  const date = new Date(unix * 1000);
  const formatted = formatTimestamp(unix, style);
  const fullDateTime = date.toLocaleString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <span className={styles.timestamp} title={fullDateTime} aria-label={fullDateTime}>
      {formatted}
    </span>
  );
}

/**
 * Syntax-highlighted code block component.
 * Uses highlight.js when a recognized language is specified, otherwise renders plain text.
 */
function HighlightedCodeBlock({ language, content }: { language: string; content: string }) {
  const highlighted = useMemo(() => {
    if (language && hljs.getLanguage(language)) {
      try {
        const result = hljs.highlight(content, { language });
        return result.value;
      } catch {
        return null;
      }
    }
    return null;
  }, [language, content]);

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <pre className={styles.codeBlock} data-language={language || undefined}>
      {language && (
        <div className={styles.codeBlockHeader}>
          <span className={styles.codeBlockLanguage}>{language}</span>
          <button
            className={styles.copyButton}
            onClick={handleCopy}
            type="button"
            aria-label="Copy code"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {highlighted ? (
        <code
          className={`hljs language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <code>{content}</code>
      )}
    </pre>
  );
}

/**
 * Render a list of tokens into React elements.
 */
function renderTokens(tokens: Token[], keyPrefix = ''): ReactNode[] {
  return tokens.map((token, i) => {
    const key = `${keyPrefix}${i}`;
    switch (token.type) {
      case 'text':
        if (token.content === '\n') return <br key={key} />;
        return <Fragment key={key}>{token.content}</Fragment>;
      case 'codeBlock':
        return <HighlightedCodeBlock key={key} language={token.language} content={token.content} />;
      case 'inlineCode':
        return <code key={key} className={styles.inlineCode}>{token.content}</code>;
      case 'bold':
        return <strong key={key}>{renderTokens(token.children, `${key}-`)}</strong>;
      case 'italic':
        return <em key={key}>{renderTokens(token.children, `${key}-`)}</em>;
      case 'underline':
        return <u key={key}>{renderTokens(token.children, `${key}-`)}</u>;
      case 'strikethrough':
        return <del key={key}>{renderTokens(token.children, `${key}-`)}</del>;
      case 'spoiler':
        return <Spoiler key={key}>{renderTokens(token.children, `${key}-`)}</Spoiler>;
      case 'blockquote':
        return <blockquote key={key} className={styles.blockquote}>{renderTokens(token.children, `${key}-`)}</blockquote>;
      case 'link':
        return (
          <a key={key} href={token.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
            {renderTokens(token.children, `${key}-`)}
          </a>
        );
      case 'autoLink':
        return (
          <a key={key} href={token.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
            {token.href}
          </a>
        );
      case 'heading': {
        const Tag = `h${token.level}` as const;
        return <Tag key={key} className={styles[`heading${token.level}`]}>{renderTokens(token.children, `${key}-`)}</Tag>;
      }
      case 'subtext':
        return <small key={key} className={styles.subtext}>{renderTokens(token.children, `${key}-`)}</small>;
      case 'userMention':
        return <UserMentionPill key={key} userId={token.userId} />;
      case 'roleMention':
        return <RoleMentionPill key={key} roleId={token.roleId} />;
      case 'channelMention':
        return <ChannelMentionPill key={key} channelId={token.channelId} />;
      case 'timestamp':
        return <TimestampDisplay key={key} unix={token.unix} style={token.style} />;
      default:
        return null;
    }
  });
}

/**
 * React component that renders the Relay markdown subset.
 * Uses a token-based parser with DOM elements (no dangerouslySetInnerHTML).
 */
export function MarkdownContent({ content }: { content: string }) {
  const tokens = parseMarkdown(content);
  return <span className={styles.markdown}>{renderTokens(tokens)}</span>;
}

// Export for testing
export { parseInline as _parseInline, parseMarkdown as _parseMarkdown, formatTimestamp as _formatTimestamp };
