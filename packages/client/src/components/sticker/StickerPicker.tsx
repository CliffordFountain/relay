import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './stickerPicker.module.scss';

export interface StickerPickerProps {
  onSelect: (sticker: string) => void;
  onClose: () => void;
}

interface StickerCategory {
  name: string;
  icon: string;
  stickers: StickerEntry[];
}

interface StickerEntry {
  id: string;
  emoji: string;
  name: string;
}

const STICKER_CATEGORIES: StickerCategory[] = [
  {
    name: 'Relay Originals',
    icon: '\u{1F438}',
    stickers: [
      { id: 'w1', emoji: '\u{1F44B}', name: 'Wave' },
      { id: 'w2', emoji: '\u{1F389}', name: 'Party' },
      { id: 'w3', emoji: '\u{2764}\u{FE0F}', name: 'Heart' },
      { id: 'w4', emoji: '\u{1F602}', name: 'Tears of Joy' },
      { id: 'w5', emoji: '\u{1F60E}', name: 'Cool' },
      { id: 'w6', emoji: '\u{1F914}', name: 'Thinking' },
      { id: 'w7', emoji: '\u{1F44D}', name: 'Thumbs Up' },
      { id: 'w8', emoji: '\u{1F525}', name: 'Fire' },
      { id: 'w9', emoji: '\u{1F4AF}', name: 'Hundred' },
      { id: 'w10', emoji: '\u{1F3AE}', name: 'Gaming' },
      { id: 'w11', emoji: '\u{1F4A4}', name: 'Sleepy' },
      { id: 'w12', emoji: '\u{1F31F}', name: 'Star' },
    ],
  },
  {
    name: 'Expressions',
    icon: '\u{1F60A}',
    stickers: [
      { id: 'e1', emoji: '\u{1F606}', name: 'Laugh' },
      { id: 'e2', emoji: '\u{1F62D}', name: 'Crying' },
      { id: 'e3', emoji: '\u{1F621}', name: 'Angry' },
      { id: 'e4', emoji: '\u{1F633}', name: 'Flushed' },
      { id: 'e5', emoji: '\u{1F929}', name: 'Star Eyes' },
      { id: 'e6', emoji: '\u{1F973}', name: 'Partying' },
      { id: 'e7', emoji: '\u{1F92F}', name: 'Mind Blown' },
      { id: 'e8', emoji: '\u{1F917}', name: 'Hugging' },
      { id: 'e9', emoji: '\u{1F60D}', name: 'Heart Eyes' },
      { id: 'e10', emoji: '\u{1F644}', name: 'Eye Roll' },
      { id: 'e11', emoji: '\u{1F62C}', name: 'Grimacing' },
      { id: 'e12', emoji: '\u{1F9D0}', name: 'Monocle' },
    ],
  },
  {
    name: 'Activities',
    icon: '\u{1F3C6}',
    stickers: [
      { id: 'a1', emoji: '\u{1F3AE}', name: 'Video Game' },
      { id: 'a2', emoji: '\u{1F3B5}', name: 'Music' },
      { id: 'a3', emoji: '\u{1F3A8}', name: 'Art' },
      { id: 'a4', emoji: '\u{1F4DA}', name: 'Books' },
      { id: 'a5', emoji: '\u{1F3AC}', name: 'Movie' },
      { id: 'a6', emoji: '\u{26BD}', name: 'Soccer' },
      { id: 'a7', emoji: '\u{1F3C0}', name: 'Basketball' },
      { id: 'a8', emoji: '\u{1F3B3}', name: 'Bowling' },
      { id: 'a9', emoji: '\u{1F3AF}', name: 'Bullseye' },
      { id: 'a10', emoji: '\u{1F9E9}', name: 'Puzzle' },
      { id: 'a11', emoji: '\u{1F3B2}', name: 'Dice' },
      { id: 'a12', emoji: '\u{1F3C6}', name: 'Trophy' },
    ],
  },
];

export const StickerPicker = ({ onSelect, onClose }: StickerPickerProps) => {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [selectedCategory, setSelectedCategory] = useState(0);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClickOutside, handleKeyDown]);

  const category = STICKER_CATEGORIES[selectedCategory];

  return createPortal(
    <div
      ref={pickerRef}
      className={styles.picker}
      role="dialog"
      aria-label="Sticker picker"
    >
      <div className={styles.header}>
        <h3 className={styles.headerTitle}>Stickers</h3>
      </div>

      <div className={styles.categoryTabs} role="tablist" aria-label="Sticker categories">
        {STICKER_CATEGORIES.map((cat, index) => (
          <button
            key={cat.name}
            className={`${styles.categoryTab} ${index === selectedCategory ? styles.categoryTabActive : ''}`}
            onClick={() => setSelectedCategory(index)}
            role="tab"
            aria-selected={index === selectedCategory}
            aria-label={cat.name}
            title={cat.name}
            type="button"
          >
            <span className={styles.categoryIcon}>{cat.icon}</span>
          </button>
        ))}
      </div>

      <div className={styles.categoryName}>{category?.name}</div>

      <div className={styles.stickerGrid} role="listbox" aria-label={`${category?.name} stickers`}>
        {category?.stickers.map(sticker => (
          <button
            key={sticker.id}
            className={styles.stickerItem}
            onClick={() => onSelect(sticker.emoji)}
            role="option"
            aria-label={sticker.name}
            title={sticker.name}
            type="button"
          >
            <span className={styles.stickerEmoji}>{sticker.emoji}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
};
