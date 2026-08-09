import { useState, useMemo } from 'react';
import { useAppDispatch } from '../../hooks/useAppDispatch';
import { setAuth } from '../../stores/authSlice';
import { api } from '../../api/rest';
import styles from './loginPage.module.scss';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(month: number, year: number): number {
  if (month === 0 || year === 0) return 31;
  return new Date(year, month, 0).getDate();
}

function getYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear; y >= currentYear - 150; y--) {
    years.push(y);
  }
  return years;
}

export interface RegisterPageProps {
  onNavigateToLogin: () => void;
}

export const RegisterPage = ({ onNavigateToLogin }: RegisterPageProps) => {
  const dispatch = useAppDispatch();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [dobMonth, setDobMonth] = useState(0);
  const [dobDay, setDobDay] = useState(0);
  const [dobYear, setDobYear] = useState(0);
  const [error, setError] = useState('');

  const yearOptions = useMemo(() => getYearOptions(), []);
  const daysInMonth = useMemo(() => getDaysInMonth(dobMonth, dobYear), [dobMonth, dobYear]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (dobMonth === 0 || dobDay === 0 || dobYear === 0) {
      setError('Please fill in your date of birth.');
      return;
    }

    const dateOfBirth = `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;

    try {
      const result = await api.register({
        username,
        email,
        password,
        global_name: displayName || undefined,
        date_of_birth: dateOfBirth,
        consent: true,
      });
      api.setToken(result.token);

      // Fetch user data via GET /users/@me
      const user = await api.getMe();
      // Registration signs the user straight in; the router redirects an
      // authenticated user from /register into the app (there is no email
      // verification wall — a self-hosted server may have no mail provider).
      dispatch(setAuth({ token: result.token, user }));
    } catch (err: unknown) {
      const detail = err && typeof err === 'object' && 'detail' in err
        ? (err as { detail: { message?: string } }).detail
        : null;
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : null;
      setError(detail?.message ?? message ?? 'Something went wrong');
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Create an account</h1>

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

        <label className={styles.label}>
          <span>DISPLAY NAME</span>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            aria-label="Display name"
          />
        </label>

        <label className={styles.label}>
          <span>USERNAME <span className={styles.required}>*</span></span>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            aria-label="Username"
          />
        </label>

        <label className={styles.label}>
          <span>PASSWORD <span className={styles.required}>*</span></span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            aria-label="Password"
          />
        </label>

        <div className={styles.dobSection}>
          <span className={styles.dobLabel}>DATE OF BIRTH <span className={styles.required}>*</span></span>
          <div className={styles.dobSelects}>
            <select
              className={styles.dobSelect}
              value={dobMonth}
              onChange={e => setDobMonth(Number(e.target.value))}
              aria-label="Month"
              required
            >
              <option value={0} disabled>Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>

            <select
              className={styles.dobSelect}
              value={dobDay}
              onChange={e => setDobDay(Number(e.target.value))}
              aria-label="Day"
              required
            >
              <option value={0} disabled>Day</option>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              className={styles.dobSelect}
              value={dobYear}
              onChange={e => setDobYear(Number(e.target.value))}
              aria-label="Year"
              required
            >
              <option value={0} disabled>Year</option>
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <p className={styles.tosNotice}>
          By registering, you agree to Relay&apos;s{' '}
          <a href="/terms">Terms of Service</a> and{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <button type="submit" className={styles.button}>
          Continue
        </button>

        <p className={styles.switch}>
          <a href="#" onClick={(e) => { e.preventDefault(); onNavigateToLogin(); }}>
            Already have an account?
          </a>
        </p>
      </form>
    </div>
  );
};
