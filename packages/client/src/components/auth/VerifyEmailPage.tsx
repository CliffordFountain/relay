import { useState, useEffect } from 'react';
import { api } from '../../api/rest';
import styles from './loginPage.module.scss';

export interface VerifyEmailPageProps {
  token: string;
  onNavigateToLogin: () => void;
}

export const VerifyEmailPage = ({ token, onNavigateToLogin }: VerifyEmailPageProps) => {
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      try {
        await api.verifyEmail(token);
        if (!cancelled) setStatus('success');
      } catch (err: unknown) {
        if (cancelled) return;
        const detail = err && typeof err === 'object' && 'detail' in err
          ? (err as { detail: { message?: string } }).detail
          : null;
        const message = err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : null;
        setErrorMessage(detail?.message ?? message ?? 'This verification link is invalid or has expired.');
        setStatus('error');
      }
    };

    void verify();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className={styles.page}>
      <div className={styles.form}>
        {status === 'verifying' && (
          <>
            <h1 className={styles.title}>Verifying your email...</h1>
            <p className={styles.subtitle}>Please wait while we verify your email address.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <h1 className={styles.title}>Email verified!</h1>
            <p className={styles.subtitle}>
              Your email has been successfully verified. You can now enjoy all features.
            </p>
            <button
              type="button"
              className={styles.button}
              onClick={onNavigateToLogin}
            >
              Continue to Login
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className={styles.title}>Verification failed</h1>
            <div className={styles.error}>{errorMessage}</div>
            <button
              type="button"
              className={styles.button}
              onClick={onNavigateToLogin}
            >
              Back to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
};
