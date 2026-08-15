import { useMemo } from 'react';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { cdnBase } from '../../utils/cdn';
import styles from './channelNameRenderer.module.scss';

export interface ChannelNameRendererProps {
  name: string;
  guildId?: string | null;
}

interface NameSegment {
  type: 'text' | 'customEmoji';
  value: string;
  emojiId?: string;
  animated?: boolean;
}

interface EmojiInfo {
  id: string;
  name: string;
  animated?: boolean;
}

const EMPTY_EMOJIS: EmojiInfo[] = [];

/**
 * Renders a channel name with emoji support.
 * - Unicode emoji render natively via the system emoji font.
 * - Custom emoji in the format <:name:id> or <a:name:id>
 *   are rendered as images from the CDN.
 * - Shortcode format :emoji_name: is resolved against guild custom emojis
 *   when available.
 */
export const ChannelNameRenderer = ({ name, guildId: _guildId }: ChannelNameRendererProps) => {
  // Custom emojis are typically stored per-guild. Since the dedicated emojis
  // slice may not exist yet, we return an empty array. Custom emoji shortcode
  // resolution will work once the emojis data source is added.
  const customEmojis = useAppSelector((): EmojiInfo[] => {
    return EMPTY_EMOJIS;
  });

  const segments = useMemo((): NameSegment[] => {
    if (!name) return [];

    const result: NameSegment[] = [];

    // Match shortcode format: :emoji_name:
    const shortcodeRegex = /:(\w+):/g;

    // First check for full custom emoji format <:name:id> or <a:name:id>
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const fullFormatRegex = /<(a?):(\w+):(\d+)>/g;
    match = fullFormatRegex.exec(name);

    if (match) {
      // Has full-format custom emojis
      fullFormatRegex.lastIndex = 0;
      while ((match = fullFormatRegex.exec(name)) !== null) {
        if (match.index > lastIndex) {
          result.push({ type: 'text', value: name.slice(lastIndex, match.index) });
        }
        const emojiName = match[2] ?? '';
        const emojiId = match[3] ?? '';
        result.push({
          type: 'customEmoji',
          value: emojiName,
          emojiId,
          animated: match[1] === 'a',
        });
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < name.length) {
        result.push({ type: 'text', value: name.slice(lastIndex) });
      }
      return result;
    }

    // Try shortcode format :emoji_name:
    lastIndex = 0;
    shortcodeRegex.lastIndex = 0;
    let hasShortcode = false;

    while ((match = shortcodeRegex.exec(name)) !== null) {
      const emojiName = match[1] ?? '';
      // Look up in guild custom emojis
      const customEmoji = customEmojis.find(
        (e) => e.name === emojiName
      );

      if (customEmoji) {
        hasShortcode = true;
        if (match.index > lastIndex) {
          result.push({ type: 'text', value: name.slice(lastIndex, match.index) });
        }
        result.push({
          type: 'customEmoji',
          value: customEmoji.name,
          emojiId: customEmoji.id,
          animated: customEmoji.animated ?? false,
        });
        lastIndex = match.index + match[0].length;
      }
    }

    if (hasShortcode) {
      if (lastIndex < name.length) {
        result.push({ type: 'text', value: name.slice(lastIndex) });
      }
      return result;
    }

    // No custom emojis found - render as plain text (Unicode emoji render natively)
    return [{ type: 'text', value: name }];
  }, [name, customEmojis]);

  const cdnUrl = cdnBase();

  return (
    <span className={styles.channelName}>
      {segments.map((segment, i) => {
        if (segment.type === 'customEmoji' && segment.emojiId) {
          const ext = segment.animated ? 'gif' : 'png';
          return (
            <img
              key={`${segment.emojiId}-${String(i)}`}
              className={styles.customEmoji}
              src={`${cdnUrl}/emojis/${segment.emojiId}.${ext}`}
              alt={`:${segment.value}:`}
              loading="lazy"
              draggable={false}
            />
          );
        }
        return <span key={String(i)}>{segment.value}</span>;
      })}
    </span>
  );
};
