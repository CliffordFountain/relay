const STORAGE_KEY = 'relay_frequent_emoji';
const MAX_TRACKED = 50;
const DEFAULT_QUICK_REACT = ['\u{1F44D}', '\u{1F525}', '\u2764\uFE0F'];

interface EmojiUsage {
  emoji: string;
  count: number;
  lastUsed: number;
}

function loadUsage(): EmojiUsage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as EmojiUsage[];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

function saveUsage(usage: EmojiUsage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Record that an emoji was used (e.g., as a reaction).
 */
export function recordEmojiUsage(emoji: string): void {
  const usage = loadUsage();
  const existing = usage.find(u => u.emoji === emoji);
  if (existing) {
    existing.count++;
    existing.lastUsed = Date.now();
  } else {
    usage.push({ emoji, count: 1, lastUsed: Date.now() });
  }

  // Sort by count descending, keep only top MAX_TRACKED
  usage.sort((a, b) => b.count - a.count);
  saveUsage(usage.slice(0, MAX_TRACKED));
}

/**
 * Get the top N most frequently used emoji for quick-react.
 * Falls back to defaults if not enough data.
 */
export function getQuickReactEmoji(count = 3): string[] {
  const usage = loadUsage();
  const top = usage.slice(0, count).map(u => u.emoji);

  // Fill with defaults if not enough
  if (top.length < count) {
    for (const def of DEFAULT_QUICK_REACT) {
      if (top.length >= count) break;
      if (!top.includes(def)) {
        top.push(def);
      }
    }
  }

  return top.slice(0, count);
}
