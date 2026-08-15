import { useState, useEffect, useCallback, useMemo } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useAppSelector } from '../../hooks/useAppDispatch';
import { PermissionBits } from '../../hooks/usePermissions';
import { selectGuildList } from '../../stores/selectors';
import { api } from '../../api/rest';
import type { RootState } from '../../stores/store';
import type { Guild } from '../../stores/guildsSlice';
import type { Role } from '../../stores/rolesSlice';
import type { GuildMember } from '../../stores/membersSlice';
import styles from './followChannelModal.module.scss';

const CHANNEL_TYPE_TEXT = 0;

const selectAllChannels = createSelector(
  (state: RootState) => state.channels.channels,
  (channels) => Object.values(channels),
);

function parsePermissions(permString: string): bigint {
  try {
    return BigInt(permString);
  } catch {
    return 0n;
  }
}

/**
 * Best-effort check for "can this user manage webhooks in this guild", using
 * whatever role/member data already happens to be in the store for it.
 *
 * Roles and members are only loaded for a guild once the user has actually
 * viewed its member list or settings in this session (see MemberList /
 * ServerSettings) - they are NOT preloaded for every guild the user belongs
 * to. So when we have no role data for a guild we can't prove the user lacks
 * permission there; rather than hiding a possibly-eligible server we leave it
 * selectable and let the backend enforce the real permission check on submit
 * (its error, if any, is surfaced in the modal).
 */
function mightManageWebhooks(
  guild: Guild,
  currentUserId: string | undefined,
  rolesByGuild: Record<string, Role[]>,
  membersByGuild: Record<string, GuildMember[]>,
): boolean {
  if (!currentUserId) return true;
  if (guild.owner_id === currentUserId) return true;

  const roles = rolesByGuild[guild.id];
  if (!roles || roles.length === 0) return true;

  const members = membersByGuild[guild.id] ?? [];
  const currentMember = members.find(m => m.user.id === currentUserId);
  const memberRoleIds = currentMember?.roles ?? [];

  const everyoneRole = roles.find(r => r.id === guild.id);
  let permissions = everyoneRole ? parsePermissions(everyoneRole.permissions) : 0n;
  for (const roleId of memberRoleIds) {
    if (roleId === guild.id) continue;
    const role = roles.find(r => r.id === roleId);
    if (role) permissions |= parsePermissions(role.permissions);
  }

  if ((permissions & PermissionBits.ADMINISTRATOR) === PermissionBits.ADMINISTRATOR) return true;
  return (permissions & PermissionBits.MANAGE_WEBHOOKS) === PermissionBits.MANAGE_WEBHOOKS;
}

export interface FollowChannelModalProps {
  channelId: string;
  channelName?: string | null;
  onClose: () => void;
}

type Step = 'guild' | 'channel';

const SUCCESS_CLOSE_DELAY_MS = 1800;

export const FollowChannelModal = ({ channelId, channelName, onClose }: FollowChannelModalProps) => {
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const guilds = useAppSelector(selectGuildList);
  const rolesByGuild = useAppSelector(s => s.roles.rolesByGuild);
  const membersByGuild = useAppSelector(s => s.members.membersByGuild);
  const allChannels = useAppSelector(selectAllChannels);

  const [step, setStep] = useState<Step>('guild');
  const [targetGuildId, setTargetGuildId] = useState<string | null>(null);
  const [targetChannelId, setTargetChannelId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successChannelName, setSuccessChannelName] = useState<string | null>(null);

  const eligibleGuilds = useMemo(() => {
    return guilds
      .filter(g => mightManageWebhooks(g, currentUserId, rolesByGuild, membersByGuild))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [guilds, currentUserId, rolesByGuild, membersByGuild]);

  const targetGuild = useMemo(
    () => eligibleGuilds.find(g => g.id === targetGuildId) ?? null,
    [eligibleGuilds, targetGuildId],
  );

  const targetChannels = useMemo(() => {
    return allChannels
      .filter(c => c.guild_id === targetGuildId && c.type === CHANNEL_TYPE_TEXT)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [allChannels, targetGuildId]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Briefly show the confirmation, then close on its own.
  useEffect(() => {
    if (successChannelName === null) return;
    const timer = setTimeout(() => {
      onClose();
    }, SUCCESS_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [successChannelName, onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleSelectGuild = useCallback((guildId: string) => {
    setTargetGuildId(guildId);
    setTargetChannelId(null);
    setError(null);
    setStep('channel');
  }, []);

  const handleBack = useCallback(() => {
    setStep('guild');
    setTargetChannelId(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!targetChannelId || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await api.followAnnouncementChannel(channelId, { webhook_channel_id: targetChannelId });
      const chosen = targetChannels.find(c => c.id === targetChannelId);
      setSuccessChannelName(chosen?.name ?? 'the channel');
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError.message ?? 'Failed to follow this channel.');
    } finally {
      setIsSubmitting(false);
    }
  }, [channelId, targetChannelId, isSubmitting, targetChannels]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSubmit();
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Follow announcement channel"
    >
      <div className={styles.modal}>
        <form onSubmit={handleFormSubmit}>
          <div className={styles.header}>
            <h2 className={styles.title}>Follow Channel</h2>
            <p className={styles.subtitle}>
              {successChannelName
                ? 'You are now following this channel.'
                : channelName
                  ? `Choose where messages from #${channelName} will be posted.`
                  : 'Choose where messages from this channel will be posted.'}
            </p>
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleClose}
              aria-label="Close"
            >
              <svg width="24" height="24" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
                />
              </svg>
            </button>
          </div>

          <div className={styles.body}>
            {successChannelName ? (
              <div className={styles.successState}>
                <svg className={styles.successIcon} width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
                <p className={styles.successText}>
                  Following — new posts here will appear in #{successChannelName}.
                </p>
              </div>
            ) : step === 'guild' ? (
              <div className={styles.pickerList} role="listbox" aria-label="Servers">
                {eligibleGuilds.length === 0 ? (
                  <div className={styles.emptyState}>
                    You don&apos;t have permission to manage webhooks in any of your servers.
                  </div>
                ) : (
                  eligibleGuilds.map(guild => (
                    <button
                      key={guild.id}
                      type="button"
                      className={styles.pickerRow}
                      onClick={() => handleSelectGuild(guild.id)}
                      role="option"
                      aria-selected={guild.id === targetGuildId}
                    >
                      <span className={styles.pickerAvatar}>
                        {guild.icon ? (
                          <img src={guild.icon} alt="" className={styles.pickerAvatarImage} loading="lazy" />
                        ) : (
                          <span className={styles.pickerAvatarFallback}>{guild.name.charAt(0).toUpperCase()}</span>
                        )}
                      </span>
                      <span className={styles.pickerName}>{guild.name}</span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <>
                <button type="button" className={styles.backButton} onClick={handleBack}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                  </svg>
                  Back
                </button>
                <div className={styles.pickerList} role="listbox" aria-label={`Text channels in ${targetGuild?.name ?? 'server'}`}>
                  {targetChannels.length === 0 ? (
                    <div className={styles.emptyState}>This server has no text channels.</div>
                  ) : (
                    targetChannels.map(channel => (
                      <button
                        key={channel.id}
                        type="button"
                        className={`${styles.pickerRow} ${channel.id === targetChannelId ? styles.pickerRowSelected : ''}`}
                        onClick={() => setTargetChannelId(channel.id)}
                        role="option"
                        aria-selected={channel.id === targetChannelId}
                      >
                        <span className={styles.pickerHash} aria-hidden="true">#</span>
                        <span className={styles.pickerName}>{channel.name ?? 'channel'}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {error && <p className={styles.error}>{error}</p>}
          </div>

          {!successChannelName && step === 'channel' && (
            <div className={styles.footer}>
              <button type="button" className={styles.cancelButton} onClick={handleClose}>
                Cancel
              </button>
              <button type="submit" className={styles.followButton} disabled={!targetChannelId || isSubmitting}>
                {isSubmitting ? 'Following...' : 'Follow'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
