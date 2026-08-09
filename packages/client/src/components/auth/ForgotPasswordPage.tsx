import { useState } from 'react';
import { api } from '../../api/rest';
import styles from './loginPage.module.scss';

export interface ForgotPasswordPageProps {
  onNavigateToLogin: () => void;
}

export const ForgotPasswordPage = ({ onNavigateToLogin }: ForgotPasswordPageProps) => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      await api.forgotPassword(email);
      setSubmitted(true);
    } catch {
      // Always show success to prevent email enumeration
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className={styles.page}>
        <div className={styles.form}>
          <h1 className={styles.title}>Request received</h1>
          <p className={styles.subtitle}>
            If an account exists for <strong>{email}</strong> and this server has email
            delivery set up, a password-reset link is on its way — check your inbox and
            spam folder. On a self-hosted server without email configured, an administrator
            can find the reset link in the server logs.
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
        <h1 className={styles.title}>Forgot your password?</h1>
        <p className={styles.subtitle}>
          Enter the email address associated with your account. If this server has email
          delivery configured, we&apos;ll send you a link to reset your password.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.label}>
          <span>EMAIL <span className={styles.required}>*</span></span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            aria-label="Email"
          />
        </label>

        <button type="submit" className={styles.button}>
          Send Reset Link
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
