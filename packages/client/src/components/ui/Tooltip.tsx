import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './tooltip.module.scss';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  text: string;
  position?: TooltipPosition;
  delay?: number;
  children: ReactNode;
}

interface TooltipCoords {
  top: number;
  left: number;
}

const ARROW_SIZE = 5;
const TOOLTIP_GAP = 4;

const calculatePosition = (
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  position: TooltipPosition
): TooltipCoords => {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  switch (position) {
    case 'top':
      return {
        top: triggerRect.top + scrollY - tooltipRect.height - ARROW_SIZE - TOOLTIP_GAP,
        left: triggerRect.left + scrollX + triggerRect.width / 2 - tooltipRect.width / 2,
      };
    case 'bottom':
      return {
        top: triggerRect.bottom + scrollY + ARROW_SIZE + TOOLTIP_GAP,
        left: triggerRect.left + scrollX + triggerRect.width / 2 - tooltipRect.width / 2,
      };
    case 'left':
      return {
        top: triggerRect.top + scrollY + triggerRect.height / 2 - tooltipRect.height / 2,
        left: triggerRect.left + scrollX - tooltipRect.width - ARROW_SIZE - TOOLTIP_GAP,
      };
    case 'right':
      return {
        top: triggerRect.top + scrollY + triggerRect.height / 2 - tooltipRect.height / 2,
        left: triggerRect.right + scrollX + ARROW_SIZE + TOOLTIP_GAP,
      };
  }
};

const clampToViewport = (coords: TooltipCoords, tooltipRect: DOMRect): TooltipCoords => {
  const padding = 8;
  return {
    top: Math.max(padding, Math.min(coords.top, window.innerHeight - tooltipRect.height - padding)),
    left: Math.max(padding, Math.min(coords.left, window.innerWidth - tooltipRect.width - padding)),
  };
};

export const Tooltip = ({ text, position = 'top', delay = 300, children }: TooltipProps) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hideTooltip = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const rawCoords = calculatePosition(triggerRect, tooltipRect, position);
    const clamped = clampToViewport(rawCoords, tooltipRect);
    setCoords(clamped);
  }, [visible, position]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const positionClass = styles[position] ?? '';

  return (
    <>
      <div
        ref={triggerRef}
        className={styles.trigger}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`${styles.tooltip} ${positionClass}`}
            style={{ top: coords.top, left: coords.left }}
            role="tooltip"
            aria-live="polite"
          >
            <div className={styles.content}>{text}</div>
            <div className={styles.arrow} />
          </div>,
          document.body
        )}
    </>
  );
};
