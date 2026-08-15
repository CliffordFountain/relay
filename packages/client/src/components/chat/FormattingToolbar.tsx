import { useCallback } from 'react';
import styles from './formattingToolbar.module.scss';

export type FormatAction = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'spoiler';

export interface FormattingToolbarProps {
  /** Position of the toolbar relative to the viewport */
  position: { top: number; left: number };
  onFormat: (action: FormatAction) => void;
}

const FORMAT_BUTTONS: Array<{
  action: FormatAction;
  label: string;
  shortcut?: string;
}> = [
  { action: 'bold', label: 'Bold', shortcut: 'Ctrl+B' },
  { action: 'italic', label: 'Italic', shortcut: 'Ctrl+I' },
  { action: 'underline', label: 'Underline', shortcut: 'Ctrl+U' },
  { action: 'strikethrough', label: 'Strikethrough' },
  { action: 'code', label: 'Code' },
  { action: 'spoiler', label: 'Spoiler' },
];

/** Icon SVGs for each formatting action */
const FormatIcon = ({ action }: { action: FormatAction }) => {
  switch (action) {
    case 'bold':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" />
        </svg>
      );
    case 'italic':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" />
        </svg>
      );
    case 'underline':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" />
        </svg>
      );
    case 'strikethrough':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" />
        </svg>
      );
    case 'code':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
        </svg>
      );
    case 'spoiler':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
        </svg>
      );
  }
};

export const FormattingToolbar = ({ position, onFormat }: FormattingToolbarProps) => {
  const handleClick = useCallback(
    (action: FormatAction, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFormat(action);
    },
    [onFormat],
  );

  return (
    <div
      className={styles.toolbar}
      style={{ top: position.top, left: position.left }}
      role="toolbar"
      aria-label="Text formatting"
      onMouseDown={(e) => e.preventDefault()}
    >
      {FORMAT_BUTTONS.map(({ action, label, shortcut }) => (
        <button
          key={action}
          className={styles.button}
          onClick={(e) => handleClick(action, e)}
          title={shortcut ? `${label} (${shortcut})` : label}
          aria-label={label}
          type="button"
        >
          <FormatIcon action={action} />
        </button>
      ))}
    </div>
  );
};
