import { useNavigate, useLocation } from 'react-router-dom';
import styles from './legalPage.module.scss';

/**
 * Terms of Service page for Relay (rendered at /terms).
 *
 * Relay is self-hosted software, so the operator of each server is the party
 * providing the service; these terms describe how the software works and the
 * baseline expectations that apply when you use it. An operator may add or
 * substitute their own terms for the server they run.
 */
export const TermsOfService = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Return to wherever the user came from (the About modal in the app, the sign-in
  // footer, a fresh tab) rather than always going to "/", which redirects an
  // authenticated user into the app. location.key is "default" only for the initial
  // entry with no client-side history to pop, so fall back to "/" in that case.
  const handleBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <button type="button" className={styles.back} onClick={handleBack}>&larr; Back</button>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.updated}>Last updated 13 September 2026</p>

        <p className={styles.notice}>
          Relay is self-hosted software. The operator of the specific server you
          connect to provides that service and is responsible for it, and may set
          their own additional or replacement terms. The sections below describe how
          the software works and the baseline expectations that apply when you use it.
        </p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>1. What this is</h2>
          <p className={styles.sectionText}>
            Relay is software you can run on your own server. The operator of
            the specific Relay server you connect to -- not the authors of the
            Relay software -- is responsible for that server, its content, and
            its members. By creating an account here, you agree to use this
            server in accordance with the rules its operator sets, if any.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Your account</h2>
          <p className={styles.sectionText}>
            You're responsible for keeping your login credentials secure and
            for activity that happens under your account. You must provide a
            real date of birth and accurate account information where the
            software asks for it.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>3. Content</h2>
          <p className={styles.sectionText}>
            You retain ownership of messages, files, and other content you
            send. You're solely responsible for what you post, and for having
            the right to post it. The server operator may set additional rules
            about acceptable content and behavior.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>4. Moderation</h2>
          <p className={styles.sectionText}>
            Server operators and moderators may remove content, restrict, or
            terminate accounts on servers they run, at their discretion,
            including for violations of their own rules.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>5. No warranty</h2>
          <p className={styles.sectionText}>
            Relay is provided "as is," without warranties of any kind, to the
            fullest extent permitted by law. Nobody guarantees this service
            will be available, error-free, or secure.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>6. Changes</h2>
          <p className={styles.sectionText}>
            A server operator may update these terms at any time. Continuing
            to use a server after changes take effect means you accept the
            updated terms for that server.
          </p>
        </div>
      </div>
    </div>
  );
};
