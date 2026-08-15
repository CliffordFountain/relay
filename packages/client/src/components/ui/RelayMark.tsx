export interface RelayMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Relay brand mark: concentric "signal rings" (currentColor, inherits
 * text color). Same mark used by the server-rail Home button.
 */
export const RelayMark = ({ size = 24, className }: RelayMarkProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeDasharray="12.6 6.3" transform="rotate(-30 12 12)" />
    <circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeDasharray="19.7 9.85" transform="rotate(15 12 12)" opacity="0.5" />
  </svg>
);
