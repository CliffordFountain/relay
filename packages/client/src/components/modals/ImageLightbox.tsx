import { useCallback, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { closeLightbox } from '../../stores/uiSlice';
import styles from './imageLightbox.module.scss';

export const ImageLightbox = () => {
  const dispatch = useAppDispatch();
  const imageUrl = useAppSelector(s => s.ui.lightboxImage);

  const handleClose = useCallback(() => {
    dispatch(closeLightbox());
  }, [dispatch]);

  useEffect(() => {
    if (!imageUrl) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, handleClose]);

  if (!imageUrl) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={handleClose}
      role="dialog"
      aria-label="Image preview"
      aria-modal="true"
    >
      <div
        className={styles.content}
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <img
          src={imageUrl}
          className={styles.image}
          alt="Full size preview"
        />
      </div>
      <div className={styles.toolbar}>
        <a
          href={imageUrl}
          className={styles.openOriginal}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open original
        </a>
        <button
          className={styles.closeButton}
          onClick={handleClose}
          aria-label="Close lightbox"
          type="button"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>
      </div>
    </div>
  );
};
