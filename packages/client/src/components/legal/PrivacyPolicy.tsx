import { useNavigate, useLocation } from 'react-router-dom';
import styles from './legalPage.module.scss';

/**
 * Privacy Policy page for Relay (rendered at /privacy).
 *
 * Relay is self-hosted, so each server operator is the data controller for
 * their instance; this page describes what the software stores by default and
 * how it is used. An operator may add or substitute their own policy for the
 * server they run.
 */
export const PrivacyPolicy = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // See TermsOfService: go back to where the user came from instead of "/", which would
  // redirect an authenticated user into the app. Fall back to "/" only when there is no
  // in-app history to return to (location.key === "default").
  const handleBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <button type="button" className={styles.back} onClick={handleBack}>&larr; Back</button>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated 13 September 2026</p>

        <p className={styles.notice}>
          Relay is self-hosted. When you use a Relay server, your data is stored on
          that server's infrastructure and controlled by whoever operates it, so that
          operator is the data controller and their own privacy practices apply. This
          page explains what the software stores by default and how it is used.
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Who controls your data</h2>
          <p className={styles.sectionText}>
            When you use a Relay server, your data is stored on that server's
            own infrastructure, controlled by whoever operates it -- not by
            the authors of the Relay software. Different servers may have
            different practices, retention periods, and legal obligations.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>2. What the software stores</h2>
          <p className={styles.sectionText}>
            By default, Relay stores the account information you provide
            (such as email, username, and date of birth), messages and files
            you send, and basic technical data needed to operate the service
            (such as login sessions and connection metadata).
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>3. Who can see it</h2>
          <p className={styles.sectionText}>
            Messages are visible to other members of the channels and servers
            you send them in, per that server's normal permissions. Server
            operators and administrators can generally access data stored on
            their own server, including for moderation purposes.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>4. No sale of data</h2>
          <p className={styles.sectionText}>
            Relay is non-commercial software. The default install does not
            sell your data to third parties or share it for advertising.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>5. Your choices</h2>
          <p className={styles.sectionText}>
            You can update your profile information from your account
            settings, and ask a server's operator about deleting your account
            or data stored on their server.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>6. Changes</h2>
          <p className={styles.sectionText}>
            A server operator may update this policy at any time. Continuing
            to use a server after changes take effect means you accept the
            updated policy for that server.
          </p>
        </div>
      </div>
    </div>
  );
};
