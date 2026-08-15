import { useState } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { addGuild } from '../../stores/guildsSlice';
import { api } from '../../api/rest';
import styles from './joinGuildModal.module.scss';

export interface JoinGuildModalProps {
  onClose: () => void;
}

export const JoinGuildModal = ({ onClose }: JoinGuildModalProps) => {
  const dispatch = useAppDispatch();
  const [inviteInput, setInviteInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const extractCode = (input: string): string => {
    const trimmed = input.trim();
    // Handle full URLs like http://localhost:5173/invite/abc123 or relay.gg/abc123
    const urlMatch = trimmed.match(/(?:invite\/|relay\.gg\/)([a-zA-Z0-9]+)$/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    // Otherwise treat the whole input as a code
    return trimmed;
  };

  const handleJoin = async () => {
    const code = extractCode(inviteInput);
    if (!code) {
      setError('Please enter a valid invite link or code.');
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      const result = await api.joinGuild(code);
      dispatch(addGuild(result.guild));
      onClose();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError(String((err as { message: string }).message));
      } else {
        setError('The invite is invalid or has expired.');
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && !isJoining) {
      handleJoin();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Join a Server"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Join a Server</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            &times;
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.description}>
            Enter an invite below to join an existing server
          </p>

          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="invite-link-input">
              INVITE LINK
            </label>
            <input
              id="invite-link-input"
              className={`${styles.input} ${error ? styles.inputError : ''}`}
              type="text"
              placeholder="https://relay.gg/hTKzmak"
              value={inviteInput}
              onChange={(e) => {
                setInviteInput(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
            />
            {error && <div className={styles.error}>{error}</div>}
          </div>

          <div className={styles.examples}>
            <div className={styles.examplesTitle}>INVITES SHOULD LOOK LIKE</div>
            <div className={styles.exampleItem}>hTKzmak</div>
            <div className={styles.exampleItem}>https://relay.gg/hTKzmak</div>
            <div className={styles.exampleItem}>http://localhost:5173/invite/hTKzmak</div>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            type="button"
          >
            Back
          </button>
          <button
            className={styles.joinButton}
            onClick={handleJoin}
            disabled={isJoining || !inviteInput.trim()}
            type="button"
          >
            {isJoining ? 'Joining...' : 'Join Server'}
          </button>
        </div>
      </div>
    </div>
  );
};
