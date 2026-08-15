import { useState, useEffect, useCallback } from 'react';

const EMPTY_ARRAY: never[] = [];
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { updateChannel as updateChannelAction, removeChannel, selectChannel } from '../../stores/channelsSlice';
import { setRoles } from '../../stores/rolesSlice';
import type { Role } from '../../stores/rolesSlice';
import { api } from '../../api/rest';
import styles from './channelSettings.module.scss';

export interface ChannelSettingsProps {
  channelId: string;
  onClose: () => void;
}

type Section = 'overview' | 'permissions' | 'invites' | 'integrations' | 'delete';

/** Three states for a permission overwrite: allow, deny, or inherit (neutral). */
type PermissionOverwriteState = 'allow' | 'deny' | 'inherit';

interface PermissionDef {
  name: string;
  flag: bigint;
  description: string;
}

const TEXT_PERMISSIONS: PermissionDef[] = [
  { name: 'View Channel', flag: 1n << 10n, description: 'Allows members to view this channel.' },
  { name: 'Send Messages', flag: 1n << 11n, description: 'Allows members to send messages in this channel.' },
  { name: 'Manage Messages', flag: 1n << 13n, description: 'Allows members to delete or pin messages by other members.' },
  { name: 'Attach Files', flag: 1n << 15n, description: 'Allows members to upload files or media.' },
  { name: 'Add Reactions', flag: 1n << 6n, description: 'Allows members to add reactions to messages.' },
  { name: 'Manage Channel', flag: 1n << 4n, description: 'Allows members to edit or delete the channel.' },
];

const VOICE_PERMISSIONS: PermissionDef[] = [
  { name: 'View Channel', flag: 1n << 10n, description: 'Allows members to view this channel.' },
  { name: 'Connect', flag: 1n << 20n, description: 'Allows members to connect to this voice channel.' },
  { name: 'Speak', flag: 1n << 21n, description: 'Allows members to speak in this voice channel.' },
  { name: 'Video', flag: 1n << 9n, description: 'Allows members to share video in this voice channel.' },
  { name: 'Mute Members', flag: 1n << 22n, description: 'Allows members to mute other members.' },
  { name: 'Deafen Members', flag: 1n << 23n, description: 'Allows members to deafen other members.' },
  { name: 'Move Members', flag: 1n << 24n, description: 'Allows members to move other members between voice channels.' },
];

interface OverwriteEntry {
  roleId: string;
  allow: bigint;
  deny: bigint;
}

function getPermState(allow: bigint, deny: bigint, flag: bigint): PermissionOverwriteState {
  if ((allow & flag) === flag) return 'allow';
  if ((deny & flag) === flag) return 'deny';
  return 'inherit';
}

function applyPermChange(
  entry: OverwriteEntry,
  flag: bigint,
  newState: PermissionOverwriteState,
): OverwriteEntry {
  let { allow, deny } = entry;
  // Clear the flag from both first
  allow = allow & ~flag;
  deny = deny & ~flag;
  if (newState === 'allow') {
    allow = allow | flag;
  } else if (newState === 'deny') {
    deny = deny | flag;
  }
  return { ...entry, allow, deny };
}

const SLOWMODE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 900, label: '15m' },
];

const REGION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Automatic' },
  { value: 'us-east', label: 'US East' },
  { value: 'us-west', label: 'US West' },
  { value: 'us-central', label: 'US Central' },
  { value: 'us-south', label: 'US South' },
  { value: 'europe', label: 'Europe' },
  { value: 'brazil', label: 'Brazil' },
  { value: 'hongkong', label: 'Hong Kong' },
  { value: 'india', label: 'India' },
  { value: 'japan', label: 'Japan' },
  { value: 'russia', label: 'Russia' },
  { value: 'singapore', label: 'Singapore' },
  { value: 'southafrica', label: 'South Africa' },
  { value: 'sydney', label: 'Sydney' },
  { value: 'south-korea', label: 'South Korea' },
];

const VIDEO_QUALITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Auto' },
  { value: 2, label: '720p' },
  { value: 3, label: '1080p' },
  { value: 4, label: 'Source' },
];

const MIN_BITRATE = 8000;
const MAX_BITRATE = 512000;
const DEFAULT_BITRATE = 64000;

interface InviteEntry {
  code: string;
  channel: { id: string; name: string };
  inviter?: { id: string; username: string; avatar: string | null };
  uses: number;
  max_uses: number;
  max_age: number;
  temporary: boolean;
  created_at: string;
}

interface WebhookEntry {
  id: string;
  name: string;
  avatar: string | null;
  channel_id: string;
  guild_id: string;
  token?: string;
  type: number;
  user?: { id: string; username: string; avatar: string | null };
  created_at?: string;
}

export const ChannelSettings = ({ channelId, onClose }: ChannelSettingsProps) => {
  const dispatch = useAppDispatch();
  const channel = useAppSelector(s => s.channels.channels[channelId]);
  const channels = useAppSelector(s => s.channels.channels);
  const guildId = channel?.guild_id ?? null;
  const guildRoles = useAppSelector(s =>
    guildId ? (s.roles.rolesByGuild[guildId] ?? EMPTY_ARRAY) : EMPTY_ARRAY
  );

  const [section, setSection] = useState<Section>('overview');
  const [name, setName] = useState(channel?.name ?? '');
  // Text channel fields
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [nsfw, setNsfw] = useState(channel?.nsfw ?? false);
  const [slowmode, setSlowmode] = useState(channel?.rate_limit_per_user ?? 0);
  // Voice channel fields
  const [bitrate, setBitrate] = useState(channel?.bitrate ?? DEFAULT_BITRATE);
  const [userLimit, setUserLimit] = useState(channel?.user_limit ?? 0);
  const [rtcRegion, setRtcRegion] = useState(channel?.rtc_region ?? '');
  const [videoQualityMode, setVideoQualityMode] = useState(channel?.video_quality_mode ?? 1);

  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Permissions editor state
  const [permOverwrites, setPermOverwrites] = useState<OverwriteEntry[]>([]);
  const [permOverwritesLoaded, setPermOverwritesLoaded] = useState(false);
  const [selectedPermRole, setSelectedPermRole] = useState<string | null>(null);
  const [showAddRoleDropdown, setShowAddRoleDropdown] = useState(false);
  const [isSavingPerms, setIsSavingPerms] = useState(false);

  // Invites state (Bug 2)
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);

  // Integrations/Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState<string | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<WebhookEntry | null>(null);
  const [editWebhookName, setEditWebhookName] = useState('');
  const [isCreatingWebhook, setIsCreatingWebhook] = useState(false);
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [copiedWebhookId, setCopiedWebhookId] = useState<string | null>(null);

  // Bug 3: Fetch roles if not in store
  useEffect(() => {
    if (guildId && guildRoles.length === 0) {
      api.getGuildRoles(guildId).then(roles => {
        dispatch(setRoles({ guildId, roles }));
      }).catch(() => { /* roles fetch failed - permissions section will be limited */ });
    }
  }, [guildId, guildRoles.length, dispatch]);

  // Bug 4: Load existing permission overwrites from API
  useEffect(() => {
    if (!guildId || permOverwritesLoaded) return;

    api.getChannelPermissionOverwrites(channelId).then(overwrites => {
      if (overwrites.length > 0) {
        const entries: OverwriteEntry[] = overwrites.map(ow => ({
          roleId: ow.id,
          allow: BigInt(ow.allow || '0'),
          deny: BigInt(ow.deny || '0'),
        }));
        // Ensure @everyone is always present
        if (!entries.some(e => e.roleId === guildId)) {
          entries.unshift({ roleId: guildId, allow: 0n, deny: 0n });
        }
        setPermOverwrites(entries);
        setSelectedPermRole(entries[0]?.roleId ?? guildId);
      } else {
        // Fallback: just @everyone with empty overwrites
        setPermOverwrites([{ roleId: guildId, allow: 0n, deny: 0n }]);
        setSelectedPermRole(guildId);
      }
      setPermOverwritesLoaded(true);
    }).catch(() => {
      // If fetch fails, initialize with default @everyone entry
      setPermOverwrites([{ roleId: guildId, allow: 0n, deny: 0n }]);
      setSelectedPermRole(guildId);
      setPermOverwritesLoaded(true);
    });
  }, [channelId, guildId, permOverwritesLoaded]);

  // Load invites when switching to invites tab
  useEffect(() => {
    if (section === 'invites') {
      setInvitesLoading(true);
      setInvitesError(null);
      api.getChannelInvites(channelId).then(inv => {
        setInvites(inv);
        setInvitesLoading(false);
      }).catch(() => {
        setInvitesError('Failed to load invites');
        setInvitesLoading(false);
      });
    }
  }, [section, channelId]);

  // Load webhooks when switching to integrations tab
  useEffect(() => {
    if (section === 'integrations') {
      setWebhooksLoading(true);
      setWebhooksError(null);
      api.getChannelWebhooks(channelId).then(wh => {
        setWebhooks(wh);
        setWebhooksLoading(false);
      }).catch(() => {
        setWebhooksError('Failed to load webhooks');
        setWebhooksLoading(false);
      });
    }
  }, [section, channelId]);

  const isTextChannel = channel?.type === 0;
  const isVoiceChannel = channel?.type === 2;

  const hasTextChanges =
    name !== (channel?.name ?? '') ||
    topic !== (channel?.topic ?? '') ||
    nsfw !== (channel?.nsfw ?? false) ||
    slowmode !== (channel?.rate_limit_per_user ?? 0);

  const hasVoiceChanges =
    name !== (channel?.name ?? '') ||
    bitrate !== (channel?.bitrate ?? DEFAULT_BITRATE) ||
    userLimit !== (channel?.user_limit ?? 0) ||
    rtcRegion !== (channel?.rtc_region ?? '') ||
    videoQualityMode !== (channel?.video_quality_mode ?? 1);

  const hasChanges = isVoiceChannel ? hasVoiceChanges : hasTextChanges;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showDeleteConfirm]);

  const handleReset = useCallback(() => {
    setName(channel?.name ?? '');
    if (isVoiceChannel) {
      setBitrate(channel?.bitrate ?? DEFAULT_BITRATE);
      setUserLimit(channel?.user_limit ?? 0);
      setRtcRegion(channel?.rtc_region ?? '');
      setVideoQualityMode(channel?.video_quality_mode ?? 1);
    } else {
      setTopic(channel?.topic ?? '');
      setNsfw(channel?.nsfw ?? false);
      setSlowmode(channel?.rate_limit_per_user ?? 0);
    }
  }, [channel, isVoiceChannel]);

  const handleSave = async () => {
    if (!hasChanges || isSaving) return;
    setIsSaving(true);

    try {
      if (isVoiceChannel) {
        const changes: { name?: string; bitrate?: number; user_limit?: number; rtc_region?: string | null; video_quality_mode?: number } = {};
        if (name !== (channel?.name ?? '')) changes.name = name;
        if (bitrate !== (channel?.bitrate ?? DEFAULT_BITRATE)) changes.bitrate = bitrate;
        if (userLimit !== (channel?.user_limit ?? 0)) changes.user_limit = userLimit;
        if (rtcRegion !== (channel?.rtc_region ?? '')) changes.rtc_region = rtcRegion || null;
        if (videoQualityMode !== (channel?.video_quality_mode ?? 1)) changes.video_quality_mode = videoQualityMode;

        const updated = await api.updateChannel(channelId, changes);
        dispatch(updateChannelAction({
          id: channelId,
          changes: {
            name: updated.name,
            bitrate: updated.bitrate,
            user_limit: updated.user_limit,
            rtc_region: updated.rtc_region,
            video_quality_mode: updated.video_quality_mode,
          },
        }));
      } else {
        const changes: { name?: string; topic?: string; nsfw?: boolean; rate_limit_per_user?: number } = {};
        if (name !== (channel?.name ?? '')) changes.name = name;
        if (topic !== (channel?.topic ?? '')) changes.topic = topic;
        if (nsfw !== (channel?.nsfw ?? false)) changes.nsfw = nsfw;
        if (slowmode !== (channel?.rate_limit_per_user ?? 0)) changes.rate_limit_per_user = slowmode;

        const updated = await api.updateChannel(channelId, changes);
        dispatch(updateChannelAction({
          id: channelId,
          changes: {
            name: updated.name,
            topic: updated.topic,
            nsfw: updated.nsfw,
            rate_limit_per_user: updated.rate_limit_per_user,
          },
        }));
      }
    } catch {
      // Error handled silently - the save bar will remain showing changes
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      await api.deleteChannel(channelId);
      dispatch(removeChannel(channelId));

      // Select another channel in the same guild if possible
      if (channel?.guild_id) {
        const siblingChannels = Object.values(channels)
          .filter(c => c.guild_id === channel.guild_id && c.id !== channelId && c.type === 0)
          .sort((a, b) => a.position - b.position);
        const firstSibling = siblingChannels[0];
        if (firstSibling) {
          dispatch(selectChannel(firstSibling.id));
        }
      }

      onClose();
    } catch {
      setIsDeleting(false);
    }
  };

  const handleUserLimitChange = (value: string) => {
    const num = parseInt(value, 10);
    if (Number.isNaN(num)) {
      setUserLimit(0);
    } else {
      setUserLimit(Math.max(0, Math.min(99, num)));
    }
  };

  const handleRevokeInvite = async (code: string) => {
    try {
      await api.revokeInvite(code);
      setInvites(prev => prev.filter(i => i.code !== code));
    } catch {
      setInvitesError('Failed to revoke invite');
    }
  };

  const handleCreateWebhook = async () => {
    setIsCreatingWebhook(true);
    setWebhooksError(null);
    try {
      const newWebhook = await api.createWebhook(channelId, { name: 'New Webhook' });
      setWebhooks(prev => [...prev, newWebhook]);
      setEditingWebhook(newWebhook);
      setEditWebhookName(newWebhook.name);
    } catch {
      setWebhooksError('Failed to create webhook');
    } finally {
      setIsCreatingWebhook(false);
    }
  };

  const handleSaveWebhook = async () => {
    if (!editingWebhook) return;
    setIsSavingWebhook(true);
    setWebhooksError(null);
    try {
      const updated = await api.updateWebhook(editingWebhook.id, { name: editWebhookName });
      setWebhooks(prev => prev.map(w => w.id === updated.id ? { ...w, ...updated } : w));
      setEditingWebhook(null);
      setEditWebhookName('');
    } catch {
      setWebhooksError('Failed to update webhook');
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleCopyWebhookUrl = (wh: WebhookEntry) => {
    const webhookUrl = `${window.location.origin}/api/v10/webhooks/${wh.id}/${wh.token ?? ''}`;
    void navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhookId(wh.id);
    setTimeout(() => setCopiedWebhookId(null), 2000);
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    try {
      await api.deleteWebhook(webhookId);
      setWebhooks(prev => prev.filter(w => w.id !== webhookId));
      if (editingWebhook?.id === webhookId) {
        setEditingWebhook(null);
        setEditWebhookName('');
      }
    } catch {
      setWebhooksError('Failed to delete webhook');
    }
  };

  const formatMaxAge = (seconds: number): string => {
    if (seconds === 0) return 'Never';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    return `${Math.floor(seconds / 86400)} days`;
  };

  const formatTimestamp = (ts: string): string => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  if (!channel) {
    return null;
  }

  const channelDisplayName = channel.name ?? 'channel';

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Channel Settings for ${channelDisplayName}`}>
      <div className={styles.container}>
        {/* Left Nav */}
        <div className={styles.nav}>
          <div className={styles.navScroll}>
            <div className={styles.navHeader}>
              {isVoiceChannel ? (
                <span className={styles.navHeaderIcon}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.383 3.07904C11.009 2.92504 10.579 3.01004 10.293 3.29604L6.586 7.00304H2C1.45 7.00304 1 7.45304 1 8.00304V16.003C1 16.553 1.45 17.003 2 17.003H6.586L10.293 20.71C10.579 20.996 11.009 21.082 11.383 20.927C11.757 20.772 12 20.407 12 20.003V4.00304C12 3.59904 11.757 3.23404 11.383 3.07904ZM14 5.00304V7.00304C16.757 7.00304 19 9.24604 19 12.003C19 14.76 16.757 17.003 14 17.003V19.003C17.86 19.003 21 15.863 21 12.003C21 8.14304 17.86 5.00304 14 5.00304ZM14 9.00304V15.003C15.654 15.003 17 13.657 17 12.003C17 10.349 15.654 9.00304 14 9.00304Z" />
                  </svg>
                  {' '}{channelDisplayName}
                </span>
              ) : (
                <>#{channelDisplayName}</>
              )}
            </div>
            <button
              type="button"
              className={`${styles.navItem} ${section === 'overview' ? styles.active : ''}`}
              onClick={() => setSection('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={`${styles.navItem} ${section === 'permissions' ? styles.active : ''}`}
              onClick={() => setSection('permissions')}
            >
              Permissions
            </button>
            <button
              type="button"
              className={`${styles.navItem} ${section === 'invites' ? styles.active : ''}`}
              onClick={() => setSection('invites')}
            >
              Invites
            </button>
            {isTextChannel && (
              <button
                type="button"
                className={`${styles.navItem} ${section === 'integrations' ? styles.active : ''}`}
                onClick={() => setSection('integrations')}
              >
                Integrations
              </button>
            )}
            <div className={styles.separator} />
            <button
              type="button"
              className={`${styles.navItem} ${styles.danger}`}
              onClick={() => setSection('delete')}
            >
              Delete Channel
            </button>
          </div>
        </div>

        {/* Right Content */}
        <div className={styles.contentWrapper}>
          <div className={styles.content}>

          {section === 'overview' && (
            <div className={styles.section}>
              <h2>Overview</h2>

              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="channel-name">
                  CHANNEL NAME
                </label>
                <input
                  id="channel-name"
                  type="text"
                  className={styles.formInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
              </div>

              {isTextChannel && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="channel-topic">
                      CHANNEL TOPIC
                    </label>
                    <textarea
                      id="channel-topic"
                      className={styles.formTextarea}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="Let everyone know how to use this channel!"
                      maxLength={1024}
                      rows={3}
                    />
                    <p className={styles.formHint}>
                      {topic.length}/1024
                    </p>
                  </div>

                  <div className={styles.formGroup}>
                    <div className={styles.toggleRow}>
                      <div className={styles.toggleLabel}>
                        <span className={styles.toggleTitle}>NSFW Channel</span>
                        <span className={styles.toggleDescription}>
                          Users must be at least 18 years old and agree to view age-restricted content.
                        </span>
                      </div>
                      <button
                        type="button"
                        className={`${styles.toggle} ${nsfw ? styles.toggleOn : ''}`}
                        onClick={() => setNsfw(!nsfw)}
                        role="switch"
                        aria-checked={nsfw}
                        aria-label="NSFW Channel"
                      >
                        <div className={styles.toggleKnob} />
                      </button>
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="slowmode">
                      SLOWMODE
                    </label>
                    <select
                      id="slowmode"
                      className={styles.formSelect}
                      value={slowmode}
                      onChange={(e) => setSlowmode(Number(e.target.value))}
                    >
                      {SLOWMODE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className={styles.formHint}>
                      Members will only be able to send one message per this interval.
                    </p>
                  </div>
                </>
              )}

              {isVoiceChannel && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="channel-bitrate">
                      BITRATE
                    </label>
                    <div className={styles.sliderContainer}>
                      <input
                        id="channel-bitrate"
                        type="range"
                        className={styles.slider}
                        min={MIN_BITRATE}
                        max={MAX_BITRATE}
                        step={1000}
                        value={bitrate}
                        onChange={(e) => setBitrate(Number(e.target.value))}
                        aria-label="Bitrate"
                      />
                      <span className={styles.sliderValue}>{Math.round(bitrate / 1000)}kbps</span>
                    </div>
                    <div className={styles.sliderLabels}>
                      <span>{Math.round(MIN_BITRATE / 1000)}kbps</span>
                      <span>{Math.round(MAX_BITRATE / 1000)}kbps</span>
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="user-limit">
                      USER LIMIT
                    </label>
                    <div className={styles.userLimitRow}>
                      <input
                        id="user-limit"
                        type="number"
                        className={styles.formInputSmall}
                        value={userLimit}
                        onChange={(e) => handleUserLimitChange(e.target.value)}
                        min={0}
                        max={99}
                      />
                      <span className={styles.userLimitHint}>
                        {userLimit === 0 ? 'No Limit' : `${userLimit} user${userLimit !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <p className={styles.formHint}>
                      Set to 0 for no user limit.
                    </p>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="rtc-region">
                      REGION OVERRIDE
                    </label>
                    <select
                      id="rtc-region"
                      className={styles.formSelect}
                      value={rtcRegion}
                      onChange={(e) => setRtcRegion(e.target.value)}
                    >
                      {REGION_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className={styles.formHint}>
                      Select a region to override the automatic voice server selection.
                    </p>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel} htmlFor="video-quality">
                      VIDEO QUALITY
                    </label>
                    <select
                      id="video-quality"
                      className={styles.formSelect}
                      value={videoQualityMode}
                      onChange={(e) => setVideoQualityMode(Number(e.target.value))}
                    >
                      {VIDEO_QUALITY_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {section === 'permissions' && (
            <div className={styles.section}>
              <h2>Permissions</h2>
              <p className={styles.permissionsDescription}>
                Customize which roles can do what in this channel. These overwrites apply on top of server-wide role permissions.
              </p>

              <div className={styles.permissionsLayout}>
                {/* Role list sidebar */}
                <div className={styles.permRoleList}>
                  <div className={styles.permRoleListHeader}>
                    <span className={styles.permRoleListTitle}>ROLES</span>
                    <button
                      type="button"
                      className={styles.addRoleBtn}
                      onClick={() => setShowAddRoleDropdown(prev => !prev)}
                      aria-label="Add a role"
                      aria-haspopup="true"
                      aria-expanded={showAddRoleDropdown}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M13 5H11V11H5V13H11V19H13V13H19V11H13V5Z" />
                      </svg>
                    </button>
                  </div>

                  {showAddRoleDropdown && (
                    <div className={styles.addRoleDropdown}>
                      {guildRoles
                        .filter((r: Role) => !permOverwrites.some(o => o.roleId === r.id))
                        .map((role: Role) => (
                          <button
                            type="button"
                            key={role.id}
                            className={styles.addRoleOption}
                            onClick={() => {
                              setPermOverwrites(prev => [...prev, { roleId: role.id, allow: 0n, deny: 0n }]);
                              setSelectedPermRole(role.id);
                              setShowAddRoleDropdown(false);
                            }}
                          >
                            <span
                              className={styles.roleColorDot}
                              style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#9EAFBA' }}
                            />
                            {role.name}
                          </button>
                        ))}
                      {guildRoles.filter((r: Role) => !permOverwrites.some(o => o.roleId === r.id)).length === 0 && (
                        <div className={styles.addRoleEmpty}>All roles added</div>
                      )}
                    </div>
                  )}

                  {permOverwrites.map(entry => {
                    const role = guildRoles.find((r: Role) => r.id === entry.roleId);
                    const roleName = entry.roleId === channel?.guild_id ? '@everyone' : (role?.name ?? 'Unknown Role');
                    const roleColor = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : undefined;
                    return (
                      <button
                        type="button"
                        key={entry.roleId}
                        className={`${styles.permRoleItem} ${selectedPermRole === entry.roleId ? styles.permRoleItemActive : ''}`}
                        onClick={() => setSelectedPermRole(entry.roleId)}
                      >
                        <span
                          className={styles.roleColorDot}
                          style={{ backgroundColor: roleColor ?? '#9EAFBA' }}
                        />
                        <span className={styles.permRoleName}>{roleName}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Permission toggles */}
                <div className={styles.permEditor}>
                  {selectedPermRole && (() => {
                    const entry = permOverwrites.find(o => o.roleId === selectedPermRole);
                    if (!entry) return null;

                    const permDefs = isVoiceChannel ? VOICE_PERMISSIONS : TEXT_PERMISSIONS;
                    const categoryLabel = isVoiceChannel ? 'Voice Channel Permissions' : 'Text Channel Permissions';

                    return (
                      <>
                        <h3 className={styles.permCategoryTitle}>{categoryLabel}</h3>
                        <div className={styles.permissionsList}>
                          {permDefs.map(perm => {
                            const state = getPermState(entry.allow, entry.deny, perm.flag);
                            return (
                              <div key={perm.name} className={styles.permissionItem}>
                                <div className={styles.permissionInfo}>
                                  <span className={styles.permissionName}>{perm.name}</span>
                                  <span className={styles.permissionDesc}>{perm.description}</span>
                                </div>
                                <div className={styles.permToggleGroup} role="radiogroup" aria-label={`${perm.name} permission`}>
                                  <button
                                    type="button"
                                    className={`${styles.permToggleBtn} ${state === 'allow' ? styles.permToggleAllow : ''}`}
                                    onClick={() => {
                                      const newState = state === 'allow' ? 'inherit' : 'allow';
                                      setPermOverwrites(prev =>
                                        prev.map(o =>
                                          o.roleId === selectedPermRole ? applyPermChange(o, perm.flag, newState) : o
                                        )
                                      );
                                    }}
                                    aria-label="Allow"
                                    title="Allow"
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.permToggleBtn} ${state === 'inherit' ? styles.permToggleInherit : ''}`}
                                    onClick={() => {
                                      setPermOverwrites(prev =>
                                        prev.map(o =>
                                          o.roleId === selectedPermRole ? applyPermChange(o, perm.flag, 'inherit') : o
                                        )
                                      );
                                    }}
                                    aria-label="Inherit"
                                    title="Inherit (use server default)"
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                      <path d="M19 13H5v-2h14v2z" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.permToggleBtn} ${state === 'deny' ? styles.permToggleDeny : ''}`}
                                    onClick={() => {
                                      const newState = state === 'deny' ? 'inherit' : 'deny';
                                      setPermOverwrites(prev =>
                                        prev.map(o =>
                                          o.roleId === selectedPermRole ? applyPermChange(o, perm.flag, newState) : o
                                        )
                                      );
                                    }}
                                    aria-label="Deny"
                                    title="Deny"
                                  >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                      <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className={styles.permSaveRow}>
                          <button
                            type="button"
                            className={styles.saveBtn}
                            disabled={isSavingPerms}
                            onClick={() => {
                              void (async () => {
                                setIsSavingPerms(true);
                                try {
                                  await api.setChannelPermissionOverwrite(
                                    channelId,
                                    entry.roleId,
                                    {
                                      type: 0, // role type
                                      allow: entry.allow.toString(),
                                      deny: entry.deny.toString(),
                                    },
                                  );
                                } catch {
                                  // Silently handle - UI remains showing current state
                                } finally {
                                  setIsSavingPerms(false);
                                }
                              })();
                            }}
                          >
                            {isSavingPerms ? 'Saving...' : 'Save Permissions'}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Invites Tab (Bug 2) */}
          {section === 'invites' && (
            <div className={styles.section}>
              <h2>Invites</h2>
              <p className={styles.permissionsDescription}>
                Active invites for this channel. You can revoke invites you no longer need.
              </p>
              {invitesError && (
                <div className={styles.errorMessage} role="alert">{invitesError}</div>
              )}
              {invitesLoading ? (
                <div className={styles.emptyState}>Loading invites...</div>
              ) : invites.length === 0 ? (
                <div className={styles.emptyState}>No active invites for this channel</div>
              ) : (
                <div className={styles.invitesList}>
                  {invites.map(inv => (
                    <div key={inv.code} className={styles.inviteRow}>
                      <div className={styles.inviteInfo}>
                        <span className={styles.inviteCode}>{inv.code}</span>
                        {inv.inviter && (
                          <span className={styles.inviteCreator}>by {inv.inviter.username}</span>
                        )}
                      </div>
                      <div className={styles.inviteMeta}>
                        <span className={styles.inviteUses}>
                          {inv.uses}{inv.max_uses > 0 ? `/${inv.max_uses}` : ''} uses
                        </span>
                        <span className={styles.inviteExpiry}>
                          Expires: {formatMaxAge(inv.max_age)}
                        </span>
                        <span className={styles.inviteCreated}>
                          Created: {formatTimestamp(inv.created_at)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => void handleRevokeInvite(inv.code)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Integrations Tab - text channels only */}
          {section === 'integrations' && isTextChannel && (
            <div className={styles.section}>
              <h2>Integrations</h2>
              <p className={styles.permissionsDescription}>
                Manage webhooks for this channel. Webhooks allow external services to send messages to this channel.
              </p>
              {webhooksError && (
                <div className={styles.errorMessage} role="alert">{webhooksError}</div>
              )}

              {/* Webhook editing panel */}
              {editingWebhook && (
                <div className={styles.webhookEditPanel} role="region" aria-label="Edit webhook">
                  <div className={styles.webhookEditHeader}>
                    <button
                      type="button"
                      className={styles.webhookBackBtn}
                      onClick={() => { setEditingWebhook(null); setEditWebhookName(''); }}
                      aria-label="Back to webhooks list"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                      </svg>
                      Back
                    </button>
                  </div>
                  <div className={styles.webhookEditBody}>
                    <div className={styles.webhookEditAvatar}>
                      {editingWebhook.name.charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel} htmlFor="webhook-name">NAME</label>
                      <input
                        id="webhook-name"
                        type="text"
                        className={styles.textInput}
                        value={editWebhookName}
                        onChange={(e) => setEditWebhookName(e.target.value)}
                        maxLength={80}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>WEBHOOK URL</label>
                      <div className={styles.webhookUrlRow}>
                        <input
                          type="text"
                          className={styles.textInput}
                          readOnly
                          value={`${window.location.origin}/api/v10/webhooks/${editingWebhook.id}/${editingWebhook.token ?? ''}`}
                          aria-label="Webhook URL"
                        />
                        <button
                          type="button"
                          className={styles.saveBtn}
                          onClick={() => handleCopyWebhookUrl(editingWebhook)}
                        >
                          {copiedWebhookId === editingWebhook.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className={styles.webhookEditActions}>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => void handleDeleteWebhook(editingWebhook.id)}
                      >
                        Delete Webhook
                      </button>
                      <button
                        type="button"
                        className={styles.saveBtn}
                        disabled={isSavingWebhook || !editWebhookName.trim()}
                        onClick={() => void handleSaveWebhook()}
                      >
                        {isSavingWebhook ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Webhooks list (hidden when editing) */}
              {!editingWebhook && (
                <>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    onClick={() => void handleCreateWebhook()}
                    disabled={isCreatingWebhook}
                    style={{ marginBottom: '16px' }}
                  >
                    {isCreatingWebhook ? 'Creating...' : 'Create Webhook'}
                  </button>

                  {webhooksLoading ? (
                    <div className={styles.emptyState}>Loading webhooks...</div>
                  ) : webhooks.length === 0 ? (
                    <div className={styles.emptyState}>No webhooks for this channel</div>
                  ) : (
                    <div className={styles.webhooksList}>
                      {webhooks.map(wh => (
                        <div
                          key={wh.id}
                          className={styles.webhookRow}
                          onClick={() => { setEditingWebhook(wh); setEditWebhookName(wh.name); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter') { setEditingWebhook(wh); setEditWebhookName(wh.name); } }}
                          aria-label={`Edit webhook ${wh.name}`}
                        >
                          <div className={styles.webhookAvatar}>
                            {wh.name.charAt(0).toUpperCase()}
                          </div>
                          <div className={styles.webhookInfo}>
                            <span className={styles.webhookName}>{wh.name}</span>
                            {wh.user && (
                              <span className={styles.webhookCreator}>Created by {wh.user.username}</span>
                            )}
                            {wh.created_at && (
                              <span className={styles.webhookCreator}>
                                Created {new Date(wh.created_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className={styles.webhookCopyBtn}
                            onClick={(e) => { e.stopPropagation(); handleCopyWebhookUrl(wh); }}
                            aria-label="Copy webhook URL"
                          >
                            {copiedWebhookId === wh.id ? 'Copied!' : 'Copy URL'}
                          </button>
                          <button
                            type="button"
                            className={styles.dangerBtn}
                            onClick={(e) => { e.stopPropagation(); void handleDeleteWebhook(wh.id); }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {section === 'delete' && (
            <div className={styles.section}>
              <h2>Delete Channel</h2>
              <div className={styles.dangerZone}>
                <p className={styles.dangerText}>
                  Are you sure you want to delete <strong>{isVoiceChannel ? '' : '#'}{channelDisplayName}</strong>?
                  This action cannot be undone. All {isVoiceChannel ? 'data in' : 'messages and data in'} this channel will be permanently lost.
                </p>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                >
                  Delete Channel
                </button>
              </div>
            </div>
          )}

          {/* Save Changes Bar */}
          {hasChanges && (
            <div className={styles.saveBar}>
              <span className={styles.saveBarText}>Careful -- you have unsaved changes!</span>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={handleReset}
              >
                Reset
              </button>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => void handleSave()}
                disabled={isSaving || !name.trim()}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close settings"
          >
            <div className={styles.closeIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z"
                />
              </svg>
            </div>
            <span className={styles.closeLabel}>ESC</span>
          </button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div
          className={styles.dialogOverlay}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete channel"
        >
          <div className={styles.dialog}>
            <h3>Delete Channel</h3>
            <p>
              Are you sure you want to delete <strong>{isVoiceChannel ? '' : '#'}{channelDisplayName}</strong>?
              This action cannot be undone.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void handleDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Channel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
