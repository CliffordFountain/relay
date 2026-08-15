import { useCallback } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { openLightbox } from '../../stores/uiSlice';
import type { Attachment } from '../../stores/messagesSlice';
import styles from './messageAttachments.module.scss';

export interface MessageAttachmentsProps {
  attachments: Attachment[];
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const AUDIO_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp3'];

function isImageAttachment(a: Attachment): boolean {
  if (a.content_type && IMAGE_TYPES.includes(a.content_type)) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(a.filename);
}

function isVideoAttachment(a: Attachment): boolean {
  if (a.content_type && VIDEO_TYPES.includes(a.content_type)) return true;
  return /\.(mp4|webm)$/i.test(a.filename);
}

function isAudioAttachment(a: Attachment): boolean {
  if (a.content_type && AUDIO_TYPES.includes(a.content_type)) return true;
  return /\.(mp3|ogg|wav)$/i.test(a.filename);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function computeImageDimensions(
  width: number | undefined,
  height: number | undefined,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (!width || !height) return { width: maxWidth, height: maxHeight };
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

export const MessageAttachments = ({ attachments }: MessageAttachmentsProps) => {
  const dispatch = useAppDispatch();

  const handleImageClick = useCallback((url: string) => {
    dispatch(openLightbox(url));
  }, [dispatch]);

  if (attachments.length === 0) return null;

  return (
    <div className={styles.attachments}>
      {attachments.map((attachment) => {
        if (isImageAttachment(attachment)) {
          const dims = computeImageDimensions(attachment.width, attachment.height, 400, 300);
          return (
            <div key={attachment.id} className={styles.imageContainer}>
              <img
                src={attachment.proxy_url || attachment.url}
                alt={attachment.description ?? attachment.filename}
                className={styles.image}
                style={{ width: dims.width, height: dims.height }}
                loading="lazy"
                onClick={() => handleImageClick(attachment.url)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleImageClick(attachment.url);
                }}
              />
              <a
                href={attachment.url}
                className={styles.downloadOverlay}
                download={attachment.filename}
                aria-label={`Download ${attachment.filename}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.293 9.293L17.707 10.707L12 16.414L6.293 10.707L7.707 9.293L11 12.586V2H13V12.586L16.293 9.293ZM18 20V18H20V20C20 21.102 19.104 22 18 22H6C4.896 22 4 21.102 4 20V18H6V20H18Z" />
                </svg>
              </a>
            </div>
          );
        }

        if (isVideoAttachment(attachment)) {
          return (
            <div key={attachment.id} className={styles.videoContainer}>
              <video
                src={attachment.url}
                className={styles.video}
                controls
                preload="metadata"
                aria-label={attachment.filename}
              >
                <track kind="captions" />
              </video>
              <div className={styles.videoMeta}>
                <span className={styles.fileName}>{attachment.filename}</span>
                <span className={styles.fileSize}>{formatFileSize(attachment.size)}</span>
              </div>
            </div>
          );
        }

        if (isAudioAttachment(attachment)) {
          return (
            <div key={attachment.id} className={styles.audioContainer}>
              <div className={styles.audioInfo}>
                <svg className={styles.audioIcon} width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <div className={styles.audioMeta}>
                  <span className={styles.fileName}>{attachment.filename}</span>
                  <span className={styles.fileSize}>{formatFileSize(attachment.size)}</span>
                </div>
              </div>
              <audio
                src={attachment.url}
                className={styles.audio}
                controls
                preload="metadata"
                aria-label={attachment.filename}
              />
            </div>
          );
        }

        // Generic file attachment
        return (
          <div key={attachment.id} className={styles.fileContainer}>
            <div className={styles.fileIcon}>
              <svg width="30" height="40" viewBox="0 0 30 40" fill="currentColor">
                <path d="M0 3C0 1.34 1.34 0 3 0H18L30 12V37C30 38.66 28.66 40 27 40H3C1.34 40 0 38.66 0 37V3Z" opacity="0.3" />
                <path d="M18 0L30 12H21C19.34 12 18 10.66 18 9V0Z" opacity="0.5" />
              </svg>
            </div>
            <div className={styles.fileMeta}>
              <a
                href={attachment.url}
                className={styles.fileLink}
                download={attachment.filename}
                target="_blank"
                rel="noopener noreferrer"
              >
                {attachment.filename}
              </a>
              <span className={styles.fileSize}>{formatFileSize(attachment.size)}</span>
            </div>
            <a
              href={attachment.url}
              className={styles.fileDownload}
              download={attachment.filename}
              aria-label={`Download ${attachment.filename}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.293 9.293L17.707 10.707L12 16.414L6.293 10.707L7.707 9.293L11 12.586V2H13V12.586L16.293 9.293ZM18 20V18H20V20C20 21.102 19.104 22 18 22H6C4.896 22 4 21.102 4 20V18H6V20H18Z" />
              </svg>
            </a>
          </div>
        );
      })}
    </div>
  );
};
