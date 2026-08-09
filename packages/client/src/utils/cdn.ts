/**
 * Central helper for the CDN base URL.
 *
 * Falls back to the page's own host on port 9000 so that a browser reaching the
 * app over the LAN (e.g. http://<your-lan-ip>:5173) loads images from that same
 * host (http://<your-lan-ip>:9000) rather than the client machine's localhost.
 * The VITE_CDN_URL env var still overrides when explicitly set.
 */
export function cdnBase(): string {
  return import.meta.env.VITE_CDN_URL || `${window.location.protocol}//${window.location.hostname}:9000`;
}

/**
 * URL for a custom guild emoji image. Served same-origin through the /cdn proxy (→ MinIO
 * relay-emojis bucket) so it loads over HTTPS and for remote viewers, rather than the raw
 * plain-HTTP MinIO host on :9000.
 */
export function emojiUrl(id: string, animated?: boolean): string {
  return `/cdn/relay-emojis/${id}.${animated ? 'gif' : 'png'}`;
}
