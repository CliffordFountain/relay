import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './confirmModal.module.scss';

export interface ConfirmModalProps {
  title: string;
  description: string;
  confirmLabel: string;
  confirmDanger?: boolean;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const ConfirmModal = ({
  title,
  description,
  confirmLabel,
  confirmDanger = false,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  const modal = (
    <div className={styles.backdrop} onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className={styles.modal} ref={modalRef}>
        <h2 className={styles.title} id="confirm-modal-title">{title}</h2>
        <p className={styles.description}>{description}</p>
        {children}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`${styles.confirmButton} ${confirmDanger ? styles.danger : ''}`}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
