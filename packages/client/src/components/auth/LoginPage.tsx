import { useState, useCallback } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { setAuth } from '../../stores/authSlice';
import { setGuilds, selectGuild } from '../../stores/guildsSlice';
import { setChannels, selectChannel } from '../../stores/channelsSlice';
import { api } from '../../api/rest';
import { RelayMark } from '../ui/RelayMark';
import styles from './loginPage.module.scss';

export interface LoginPageProps {
  onNavigateToRegister: () => void;
  onNavigateToForgotPassword: () => void;
}

/* ─── Inline icons (decorative; aria-hidden) ─── */

const MailIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9.9 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6M6.4 7.8A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 3.3-.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LoginPage = ({ onNavigateToRegister, onNavigateToForgotPassword }: LoginPageProps) => {
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  // Establish an authenticated session from a Relay token after password login.
  // Mirrors the exact setToken -> getMe -> setAuth -> eager-load path.
  const establishSession = useCallback(async (token: string) => {
    api.setToken(token);

    // Fetch user data via GET /users/@me
    const user = await api.getMe();
    dispatch(setAuth({ token, user }));

    // Fetch guilds and channels after login
    try {
      const guilds = await api.getMyGuilds();
      dispatch(setGuilds(guilds));
      const channelResults = await Promise.allSettled(
        guilds.map(g => api.getGuildChannels(g.id))
      );
      const allChannels: Array<{ id: string; guild_id: string | null; type: number; name: string | null; topic: string | null; position: number; parent_id: string | null }> = [];
      for (const r of channelResults) {
        if (r.status === 'fulfilled') allChannels.push(...r.value);
      }
      if (allChannels.length > 0) dispatch(setChannels(allChannels));
      const firstGuild = guilds[0];
      if (firstGuild) {
        dispatch(selectGuild(firstGuild.id));
        const firstGuildChannels = allChannels
          .filter(c => c.guild_id === firstGuild.id && c.type === 0)
          .sort((a, b) => a.position - b.position);
        const firstChannel = firstGuildChannels[0];
        if (firstChannel) dispatch(selectChannel(firstChannel.id));
      }
    } catch {
      // Guild fetch failed - user will see empty state, guilds will load via gateway
    }
  }, [dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await api.login({ email, password });
      await establishSession(result.token);
    } catch (err: unknown) {
      const detail = err && typeof err === 'object' && 'detail' in err
        ? (err as { detail: { message?: string } }).detail
        : null;
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : null;
      setError(detail?.message ?? message ?? 'Login or password is invalid.');
    }
  };

  return (
    <div className={styles.page}>
      <div className={`${styles.blob} ${styles.blobA}`} aria-hidden="true" />
      <div className={`${styles.blob} ${styles.blobB}`} aria-hidden="true" />
      <div className={styles.rings} aria-hidden="true" />

      <div className={styles.brand}>
        <div className={styles.brandLogo} aria-hidden="true">
          <RelayMark size={22} />
        </div>
        <span className={styles.brandName}>Relay</span>
      </div>

      <div className={styles.loginContainer}>
        <div className={styles.loginLeft}>
          <form className={styles.form} onSubmit={handleSubmit}>
            <h1 className={styles.title}>Welcome back!</h1>
            <p className={styles.subtitle}>Sign in to get back in the game.</p>

            {error && <div className={styles.error}>{error}</div>}

            <label className={styles.label}>
              <span>Email or username <span className={styles.required}>*</span></span>
              <div className={styles.inputWrap}>
                <MailIcon className={styles.inputIcon} />
                <input
                  type="text"
                  className={styles.hasLeftIcon}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="you@example.com or username"
                  aria-label="Email or phone number"
                />
              </div>
            </label>

            <label className={styles.label}>
              <span>Password <span className={styles.required}>*</span></span>
              <div className={styles.inputWrap}>
                <LockIcon className={styles.inputIcon} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={`${styles.hasLeftIcon} ${styles.hasRightIcon}`}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-label="Password"
                />
                <button
                  type="button"
                  className={styles.eyeToggle}
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide' : 'Show'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </label>

            <a
              href="#"
              className={styles.forgotPassword}
              onClick={(e) => {
                e.preventDefault();
                onNavigateToForgotPassword();
              }}
            >
              Forgot your password?
            </a>

            <button type="submit" className={styles.button} aria-label="Log In">
              Log in
              <ArrowIcon />
            </button>

            <p className={styles.switch}>
              New to Relay?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); onNavigateToRegister(); }}>
                Create an account
              </a>
            </p>
          </form>
        </div>
      </div>

      <p className={styles.footer}>
        Relay · built for gamers ·{' '}
        <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
      </p>
    </div>
  );
};
