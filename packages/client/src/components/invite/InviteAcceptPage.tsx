import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { api } from '../../api/rest';
import styles from './inviteAcceptPage.module.scss';

interface InviteInfo {
  code: string;
  guild: {
    id: string;
    name: string;
    icon: string | null;
    member_count?: number;
  };
  channel: {
    id: string;
    name: string;
  };
  inviter?: {
    id: string;
    username: string;
    avatar: string | null;
  };
  expires_at?: string | null;
}

export const InviteAcceptPage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!code) return;
    api.getInvite(code)
      .then(data => setInvite(data as InviteInfo))
      .catch(() => setError('This invite may be expired, or you might not have permission to join.'));
  }, [code]);

  const handleAccept = async () => {
    if (!code || joining) return;
    setJoining(true);
    try {
      const result = await api.joinGuild(code) as { guild?: { id: string } };
      setJoined(true);
      const guildId = result?.guild?.id ?? invite?.guild?.id;
      if (guildId) {
        setTimeout(() => navigate(`/channels/${guildId}`), 1000);
      }
    } catch {
      setError('Failed to join server. The invite may be expired or invalid.');
    } finally {
      setJoining(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h2 className={styles.title}>You've been invited to join a server</h2>
          <p className={styles.subtitle}>You need to log in first to accept this invite.</p>
          <button className={styles.acceptBtn} onClick={() => navigate('/login')} type="button">
            Log In
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h2 className={styles.title}>Invite Invalid</h2>
          <p className={styles.error}>{error}</p>
          <button className={styles.backBtn} onClick={() => navigate('/channels/@me')} type="button">
            Back to Relay
          </button>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.loading}>Loading invite...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {invite.inviter && (
          <p className={styles.inviterText}>{invite.inviter.username} invited you to join</p>
        )}
        <div className={styles.guildIcon}>
          {invite.guild.icon ? (
            <img src={invite.guild.icon} alt="" className={styles.iconImg} />
          ) : (
            <div className={styles.iconFallback}>
              {invite.guild.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <h2 className={styles.guildName}>{invite.guild.name}</h2>
        {invite.guild.member_count != null && (
          <p className={styles.memberCount}>{invite.guild.member_count} Members</p>
        )}

        {joined ? (
          <div className={styles.joinedText}>Joined! Redirecting...</div>
        ) : (
          <button
            className={styles.acceptBtn}
            onClick={handleAccept}
            disabled={joining}
            type="button"
          >
            {joining ? 'Joining...' : 'Accept Invite'}
          </button>
        )}
      </div>
    </div>
  );
};
