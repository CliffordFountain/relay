import type { Embed } from '../../stores/messagesSlice';
import styles from './messageEmbed.module.scss';

export interface MessageEmbedProps {
  embed: Embed;
}

function intToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * Only http(s) URLs may be used as a link href or image src. Embeds are populated from
 * untrusted webhook input, so a `javascript:`/`data:` URL here would be a stored-XSS or
 * scheme-injection vector. Returns the URL when it's safe, otherwise undefined.
 */
function safeUrl(url?: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

export const MessageEmbed = ({ embed }: MessageEmbedProps) => {
  const borderColor = embed.color ? intToHex(embed.color) : undefined;
  const providerName = embed.provider?.name ?? '';
  const hasContent = embed.title || embed.description || embed.author || (embed.fields && embed.fields.length > 0);

  // Scheme-checked URLs (never trust embed URLs — they come from webhook payloads).
  const authorIconUrl = safeUrl(embed.author?.icon_url);
  const authorLinkUrl = safeUrl(embed.author?.url);
  const titleUrl = safeUrl(embed.url);
  const imageUrl = safeUrl(embed.image?.url);
  const footerIconUrl = safeUrl(embed.footer?.icon_url);
  const thumbnailUrl = safeUrl(embed.thumbnail?.url);

  if (!hasContent && !embed.image && !embed.thumbnail) {
    return null;
  }

  return (
    <article className={styles.embed} aria-label="Embed">
      <div
        className={styles.colorBar}
        style={borderColor ? { backgroundColor: borderColor } : undefined}
      />
      <div className={styles.embedContent}>
        <div className={styles.embedBody}>
          {providerName && (
            <div className={styles.provider}>{providerName}</div>
          )}
          {embed.author && (
            <div className={styles.author}>
              {authorIconUrl && (
                <img
                  className={styles.authorIcon}
                  src={authorIconUrl}
                  alt=""
                  loading="lazy"
                  width={24}
                  height={24}
                />
              )}
              {authorLinkUrl ? (
                <a
                  href={authorLinkUrl}
                  className={styles.authorName}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {embed.author.name}
                </a>
              ) : (
                <span className={styles.authorName}>{embed.author.name}</span>
              )}
            </div>
          )}
          {embed.title && (
            <div className={styles.title}>
              {titleUrl ? (
                <a
                  href={titleUrl}
                  className={styles.titleLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {embed.title}
                </a>
              ) : (
                embed.title
              )}
            </div>
          )}
          {embed.description && (
            <div className={styles.description}>{embed.description}</div>
          )}
          {embed.fields && embed.fields.length > 0 && (
            <div className={styles.fields}>
              {embed.fields.map((field, i) => (
                <div
                  key={i}
                  className={`${styles.field} ${field.inline ? styles.fieldInline : ''}`}
                >
                  <div className={styles.fieldName}>{field.name}</div>
                  <div className={styles.fieldValue}>{field.value}</div>
                </div>
              ))}
            </div>
          )}
          {imageUrl && (
            <div className={styles.imageContainer}>
              <img
                className={styles.embedImage}
                src={imageUrl}
                alt=""
                loading="lazy"
              />
            </div>
          )}
          {embed.footer && (
            <div className={styles.footer}>
              {footerIconUrl && (
                <img
                  className={styles.footerIcon}
                  src={footerIconUrl}
                  alt=""
                  loading="lazy"
                  width={20}
                  height={20}
                />
              )}
              <span className={styles.footerText}>{embed.footer.text}</span>
              {embed.timestamp && (
                <>
                  <span className={styles.footerSeparator}>{'\u2022'}</span>
                  <span className={styles.footerText}>
                    {new Date(embed.timestamp).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {thumbnailUrl && (
          <div className={styles.thumbnailContainer}>
            <img
              className={styles.thumbnail}
              src={thumbnailUrl}
              alt=""
              loading="lazy"
            />
          </div>
        )}
      </div>
    </article>
  );
};
