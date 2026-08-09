import { useState } from 'react';
import { api } from '../../api/rest';
import styles from './loginPage.module.scss';

export interface ResetPasswordPageProps {
  token: string;
  onNavigateToLogin: () => void;
}

export const ResetPasswordPage = ({ token, onNavigateToLogin }: ResetPasswordPageProps) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    try {
      await api.resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err: unknown) {
      const detail = err && typeof err === 'object' && 'detail' in err
        ? (err as { detail: { message?: string } }).detail
        : null;
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : null;
      setError(detail?.message ?? message ?? 'This reset link is invalid or has expired.');
    }
  };

  if (success) {
    return (
      <div className={styles.page}>
        <div className={styles.form}>
          <h1 className={styles.title}>Password changed</h1>
          <p className={styles.subtitle}>
            Your password has been successfully reset. You can now log in with your new password.
          </p>
          <button
            type="button"
            className={styles.button}
            onClick={onNavigateToLogin}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subtitle}>
          Enter a new password for your account.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.label}>
          <span>NEW PASSWORD <span className={styles.required}>*</span></span>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={8}
            aria-label="New password"
          />
        </label>

        <label className={styles.label}>
          <span>CONFIRM PASSWORD <span className={styles.required}>*</span></span>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            aria-label="Confirm password"
          />
        </label>

        <button type="submit" className={styles.button}>
          Change Password
        </button>

        <p className={styles.switch}>
          <a href="#" onClick={(e) => { e.preventDefault(); onNavigateToLogin(); }}>
            Back to Login
          </a>
        </p>
      </form>
    </div>
  );
};
