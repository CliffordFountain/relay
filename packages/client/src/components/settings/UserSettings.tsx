import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { api } from '../../api/rest';
import { cdnBase } from '../../utils/cdn';
import { logout, setUser } from '../../stores/authSlice';
import {
  setTheme,
  setFontSize,
  setMessageDisplayMode,
  setEnableDesktopNotifications,
  setEnableSounds,
  setEnableMessageNotifications,
  setEnableFriendRequestNotifications,
  setEnableServerNotifications,
  setInputDevice,
  setOutputDevice,
  setInputMode,
  setEchoCancellation,
  setNoiseSuppression,
  setAutoGainControl,
  setVoiceSensitivity,
  setVideoDevice,
  setKeybind,
  resetKeybinds,
  setReducedMotion,
  setSaturation,
  setShowRoleColors,
  setShowLinkPreviews,
  setEnableTTS,
  setAutoPlayGifs,
  setShowEmbeds,
  setShowEmojiReactions,
  setConvertEmoticons,
  setDeveloperMode,
  setHighContrast,
} from '../../stores/settingsSlice';
import { useMediaStreams } from '../../hooks/useMediaStreams';
import { applyOutputDeviceToAll } from '../../hooks/useMediaStreams';
import { MicTest } from './MicTest';
import { PushToTalkKeybind } from './PushToTalkKeybind';
import { ImageCropModal } from '../ui/ImageCropModal';
import styles from './userSettings.module.scss';

type Section =
  | 'My Account'
  | 'Content & Social'
  | 'Notifications'
  | 'Appearance'
  | 'Accessibility'
  | 'Voice & Video'
  | 'Chat'
  | 'Keybinds'
  | 'Advanced';

interface SectionGroup {
  label: string;
  items: Section[];
}

/** Sections that should display a NEW badge next to them in the sidebar (none for now). */
const NEW_BADGE_SECTIONS: ReadonlySet<Section> = new Set<Section>();

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: 'User Settings',
    items: ['My Account', 'Content & Social', 'Notifications'],
  },
  {
    label: 'App Settings',
    items: [
      'Appearance',
      'Accessibility',
      'Voice & Video',
      'Chat',
      'Keybinds',
      'Advanced',
    ],
  },
];

/* ──────── Settings Navigation Icons (16x16 SVGs) ──────── */

const NAV_ICONS: Record<Section, React.ReactNode> = {
  'My Account': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9.243 2 7 4.243 7 7s2.243 5 5 5 5-2.243 5-5-2.243-5-5-5zM12 10c-1.654 0-3-1.346-3-3s1.346-3 3-3 3 1.346 3 3-1.346 3-3 3zm9 12c0-4.971-4.029-9-9-9s-9 4.029-9 9h2c0-3.86 3.141-7 7-7s7 3.14 7 7h2z"/></svg>
  ),
  'Content & Social': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm7.931 9h-2.764a14.67 14.67 0 0 0-1.792-6.243A8.013 8.013 0 0 1 19.931 11zM13 4.069V11h3.09A12.7 12.7 0 0 0 13 4.069zM13 13v6.931A12.7 12.7 0 0 0 16.09 13H13zm-2 6.931V13H7.91A12.7 12.7 0 0 0 11 19.931zM11 11V4.069A12.7 12.7 0 0 0 7.91 11H11zM8.625 4.757A14.67 14.67 0 0 0 6.833 11H4.069a8.013 8.013 0 0 1 4.556-6.243zM4.069 13h2.764a14.67 14.67 0 0 0 1.792 6.243A8.013 8.013 0 0 1 4.069 13zm11.306 6.243A14.67 14.67 0 0 0 17.167 13h2.764a8.013 8.013 0 0 1-4.556 6.243z"/></svg>
  ),
  'Notifications': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
  ),
  'Appearance': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67 0 1.38-1.12 2.5-2.5 2.5zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5 0-.16-.08-.28-.14-.35-.41-.46-.63-1.05-.63-1.65 0-1.38 1.12-2.5 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 10 6.5 10s1.5.67 1.5 1.5S7.33 13 6.5 13zm3-4C8.67 9 8 8.33 8 7.5S8.67 6 9.5 6s1.5.67 1.5 1.5S10.33 9 9.5 9zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 6 14.5 6s1.5.67 1.5 1.5S15.33 9 14.5 9zm3 4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
  ),
  'Accessibility': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
  ),
  'Voice & Video': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
  ),
  'Chat': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
  ),
  'Keybinds': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>
  ),
  'Advanced': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>
  ),
};

export interface UserSettingsProps {
  onClose: () => void;
}

/* ──────────────────────────── Root ──────────────────────────── */

export const UserSettings = ({ onClose }: UserSettingsProps) => {
  const [activeSection, setActiveSection] = useState<Section>('My Account');
  const [searchQuery, setSearchQuery] = useState('');
  const dispatch = useAppDispatch();

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* server may be down, still logout locally */
    }
    dispatch(logout());
    api.clearToken();
    onClose();
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const lowerSearch = searchQuery.toLowerCase();
  const filteredGroups = searchQuery
    ? SECTION_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((s) => s.toLowerCase().includes(lowerSearch)),
      })).filter((group) => group.items.length > 0)
    : SECTION_GROUPS;

  const user = useAppSelector((s) => s.auth.user);
  const cdnUrl = cdnBase();
  const avatarSrc = user?.avatar
    ? (user.avatar.startsWith('data:') ? user.avatar : `${cdnUrl}/avatars/${user.id}/${user.avatar}.png`)
    : null;

  return (
    <div className={styles.overlay} role="dialog" aria-label="User Settings">
      <div className={styles.container}>
        <nav className={styles.nav} aria-label="Settings navigation">
          <div className={styles.navScroll}>
            {/* User profile card */}
            <div className={styles.userProfileCard}>
              {avatarSrc ? (
                <img className={styles.userAvatar} src={avatarSrc} alt="" />
              ) : (
                <div className={styles.userAvatarFallback}>
                  {(user?.global_name ?? user?.username ?? '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className={styles.userProfileInfo}>
                <span className={styles.userDisplayName}>{user?.global_name ?? user?.username ?? 'User'}</span>
                <button
                  className={styles.editProfileLink}
                  onClick={() => setActiveSection('Content & Social')}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.29 9.83L19.94 9.18c1.41-1.41 1.41-3.71 0-5.12-1.41-1.41-3.71-1.41-5.12 0L14.17 4.71 19.29 9.83zM12.86 6.02L4.1 14.78c-.25.25-.43.57-.5.92L2.05 22.63c-.06.26.02.53.21.72.19.19.46.27.72.21l6.93-1.55c.35-.08.67-.26.92-.5l8.75-8.75L12.86 6.02z" />
                  </svg>
                  Edit Profiles
                </button>
              </div>
            </div>
            <div className={styles.searchContainer}>
              <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.707 20.293L16.314 14.9C17.403 13.504 18 11.799 18 10C18 5.589 14.411 2 10 2C5.589 2 2 5.589 2 10C2 14.411 5.589 18 10 18C11.799 18 13.504 17.403 14.9 16.314L20.293 21.707L21.707 20.293ZM10 16C6.691 16 4 13.309 4 10C4 6.691 6.691 4 10 4C13.309 4 16 6.691 16 10C16 13.309 13.309 16 10 16Z" />
              </svg>
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search settings"
              />
            </div>
            {filteredGroups.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <div className={styles.separator} />}
                <div className={styles.navHeader}>{group.label}</div>
                {group.items.map((s) => (
                  <button
                    key={s}
                    className={`${styles.navItem} ${activeSection === s ? styles.active : ''}`}
                    onClick={() => setActiveSection(s)}
                    aria-current={activeSection === s ? 'page' : undefined}
                  >
                    <span className={styles.navItemIcon}>{NAV_ICONS[s]}</span>
                    <span className={styles.navItemLabel}>{s}</span>
                    {NEW_BADGE_SECTIONS.has(s) && (
                      <span className={styles.newBadge}>NEW</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            <div className={styles.separator} />
            <button
              className={`${styles.navItem} ${styles.danger}`}
              onClick={handleLogout}
            >
              Log Out
            </button>
            <div className={styles.buildInfo}>
              Relay v0.1.0
            </div>
          </div>
        </nav>

        <div className={styles.contentWrapper}>
          <div className={styles.content}>
            {activeSection === 'My Account' && <MyAccountSection onNavigateToProfile={() => setActiveSection('Content & Social')} />}
            {activeSection === 'Content & Social' && <ProfilesSection />}
            {activeSection === 'Appearance' && <AppearanceSection />}
            {activeSection === 'Accessibility' && <AccessibilitySection />}
            {activeSection === 'Voice & Video' && <VoiceVideoSection />}
            {activeSection === 'Chat' && <TextImagesSection />}
            {activeSection === 'Notifications' && <NotificationsSection />}
            {activeSection === 'Keybinds' && <KeybindsSection />}
            {activeSection === 'Advanced' && <AdvancedSection />}
          </div>
          <button
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
            <div className={styles.closeLabel}>ESC</div>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ──────────────────────────── My Account ──────────────────────────── */

interface MyAccountSectionProps {
  onNavigateToProfile: () => void;
}

function MyAccountSection({ onNavigateToProfile }: MyAccountSectionProps) {
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountTab, setAccountTab] = useState<'security' | 'standing'>('security');
  const [emailRevealed, setEmailRevealed] = useState(false);

  /* Password change */
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  /* Delete account */
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
    setError(null);
  };

  const maskEmail = (email: string): string => {
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) return email;
    return '\u25CF'.repeat(atIndex) + email.slice(atIndex);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
    setError(null);
  };

  const saveField = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      if (editingField === 'displayName') payload.global_name = editValue;
      if (editingField === 'username') payload.username = editValue;
      if (editingField === 'email') payload.email = editValue;
      const updated = await api.updateUser(payload);
      dispatch(
        setUser({
          id: updated.id,
          username: updated.username,
          email: updated.email,
          avatar: updated.avatar,
          banner: updated.banner,
          global_name: updated.global_name,
          bio: updated.bio,
          accent_color: updated.accent_color,
          pronouns: updated.pronouns,
        }),
      );
      setEditingField(null);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to save';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    try {
      await api.changePassword({
        old_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordChange(false);
        setPasswordSuccess(false);
      }, 1500);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to change password';
      setPasswordError(msg);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);
    try {
      await api.deleteAccount({ password: deletePassword });
      api.clearToken();
      window.location.reload();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to delete account';
      setDeleteError(msg);
    }
  };

  const avatarFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  /** Data URL of the image currently being cropped, or null when no crop modal is open. */
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);
  const [bannerCropSrc, setBannerCropSrc] = useState<string | null>(null);

  const handleAvatarClick = () => {
    avatarFileRef.current?.click();
  };

  const handleBannerClick = () => {
    bannerFileRef.current?.click();
  };

  /** Reads a chosen file as a data URL for display, without uploading it. */
  const readFileAsDataUrl = (file: File, onLoaded: (dataUrl: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        onLoaded(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    readFileAsDataUrl(file, setAvatarCropSrc);
  };

  const handleBannerFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    readFileAsDataUrl(file, setBannerCropSrc);
  };

  const handleAvatarCropCancel = () => setAvatarCropSrc(null);
  const handleBannerCropCancel = () => setBannerCropSrc(null);

  const handleAvatarCropApply = async (croppedDataUrl: string) => {
    setAvatarCropSrc(null);
    try {
      const updated = await api.updateUser({ avatar: croppedDataUrl });
      dispatch(
        setUser({
          id: updated.id,
          username: updated.username,
          email: updated.email,
          avatar: updated.avatar,
          banner: updated.banner,
          global_name: updated.global_name,
          bio: updated.bio,
          accent_color: updated.accent_color,
          pronouns: updated.pronouns,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  const handleBannerCropApply = async (croppedDataUrl: string) => {
    setBannerCropSrc(null);
    try {
      const updated = await api.updateUser({ banner: croppedDataUrl });
      dispatch(
        setUser({
          id: updated.id,
          username: updated.username,
          email: updated.email,
          avatar: updated.avatar,
          banner: updated.banner,
          global_name: updated.global_name,
          bio: updated.bio,
          accent_color: updated.accent_color,
          pronouns: updated.pronouns,
        }),
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <>
    <div className={styles.section}>
      <h2>My Account</h2>

      {/* Security / Standing tabs */}
      <div className={styles.accountTabs}>
        <button
          className={`${styles.accountTab} ${accountTab === 'security' ? styles.accountTabActive : ''}`}
          onClick={() => setAccountTab('security')}
          aria-current={accountTab === 'security' ? 'page' : undefined}
        >
          Security
        </button>
        <button
          className={`${styles.accountTab} ${accountTab === 'standing' ? styles.accountTabActive : ''}`}
          onClick={() => setAccountTab('standing')}
          aria-current={accountTab === 'standing' ? 'page' : undefined}
        >
          Standing
        </button>
      </div>

      {accountTab === 'standing' ? (
        <div className={styles.standingContent}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#28aa5e" />
            <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className={styles.standingTitle}>Your account is in good standing</h3>
          <p className={styles.standingDescription}>
            We don&apos;t currently have any issues with your account. Keep it up!
          </p>
        </div>
      ) : (
      <>
      <div className={styles.card}>
        <div
          className={styles.cardBanner}
          style={user?.banner ? { backgroundImage: `url(${user.banner})` } : undefined}
        >
          <button
            type="button"
            className={styles.bannerBtn}
            onClick={handleBannerClick}
            aria-label="Change banner"
            title="Change banner"
          >
            <div className={styles.bannerOverlay}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z" />
              </svg>
              <span>Change Banner</span>
            </div>
          </button>
          <input
            ref={bannerFileRef}
            type="file"
            accept="image/*"
            className={styles.avatarFileInput}
            onChange={handleBannerFile}
            tabIndex={-1}
          />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardAvatarRow}>
            <button
              className={styles.avatarBtn}
              onClick={handleAvatarClick}
              aria-label="Change avatar"
              title="Change avatar"
            >
              <div className={styles.avatar}>
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt=""
                    className={styles.avatarImage}
                  />
                ) : (
                  user?.username?.charAt(0).toUpperCase()
                )}
                <div className={styles.avatarOverlay}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z" />
                  </svg>
                </div>
              </div>
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                className={styles.avatarFileInput}
                onChange={handleAvatarFile}
                tabIndex={-1}
              />
            </button>
            <span className={styles.cardUsername}>{user?.username}</span>
            <button
              className={styles.editUserProfileBtn}
              onClick={onNavigateToProfile}
            >
              Edit User Profile
            </button>
          </div>
          <div className={styles.cardInfo}>
            {/* Display Name */}
            <div className={styles.infoRow}>
              <div className={styles.infoContent}>
                <div className={styles.infoLabel}>DISPLAY NAME</div>
                {editingField === 'displayName' ? (
                  <div className={styles.editField}>
                    <input
                      className={styles.textInput}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoFocus
                    />
                    {error && <div className={styles.fieldError}>{error}</div>}
                    <div className={styles.editActions}>
                      <button className={styles.cancelBtn} onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button
                        className={styles.saveBtn}
                        onClick={saveField}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.infoValue}>
                    {user?.global_name ?? user?.username ?? ''}
                  </div>
                )}
              </div>
              {editingField !== 'displayName' && (
                <button
                  className={styles.editBtn}
                  onClick={() =>
                    startEdit('displayName', user?.global_name ?? user?.username ?? '')
                  }
                >
                  Edit
                </button>
              )}
            </div>

            {/* Username */}
            <div className={styles.infoRow}>
              <div className={styles.infoContent}>
                <div className={styles.infoLabel}>USERNAME</div>
                {editingField === 'username' ? (
                  <div className={styles.editField}>
                    <input
                      className={styles.textInput}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoFocus
                    />
                    {error && <div className={styles.fieldError}>{error}</div>}
                    <div className={styles.editActions}>
                      <button className={styles.cancelBtn} onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button
                        className={styles.saveBtn}
                        onClick={saveField}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.infoValue}>
                    {user?.username ?? ''}
                  </div>
                )}
              </div>
              {editingField !== 'username' && (
                <button
                  className={styles.editBtn}
                  onClick={() =>
                    startEdit('username', user?.username ?? '')
                  }
                >
                  Edit
                </button>
              )}
            </div>

            {/* Email */}
            <div className={styles.infoRow}>
              <div className={styles.infoContent}>
                <div className={styles.infoLabel}>EMAIL</div>
                {editingField === 'email' ? (
                  <div className={styles.editField}>
                    <input
                      type="email"
                      className={styles.textInput}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoFocus
                    />
                    {error && <div className={styles.fieldError}>{error}</div>}
                    <div className={styles.editActions}>
                      <button className={styles.cancelBtn} onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button
                        className={styles.saveBtn}
                        onClick={saveField}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.infoValue}>
                    {emailRevealed
                      ? (user?.email ?? '')
                      : maskEmail(user?.email ?? '')}
                    <button
                      className={styles.revealBtn}
                      onClick={() => setEmailRevealed(!emailRevealed)}
                      aria-label={emailRevealed ? 'Hide email' : 'Reveal email'}
                    >
                      {emailRevealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                )}
              </div>
              {editingField !== 'email' && (
                <button
                  className={styles.editBtn}
                  onClick={() => startEdit('email', user?.email ?? '')}
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Password & Authentication */}
      <div className={styles.subsection}>
        <h3>Password and Authentication</h3>
        {!showPasswordChange ? (
          <button
            className={styles.primaryBtn}
            onClick={() => setShowPasswordChange(true)}
          >
            Change Password
          </button>
        ) : (
          <div className={styles.passwordForm}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>CURRENT PASSWORD</label>
              <input
                type="password"
                className={styles.textInput}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>NEW PASSWORD</label>
              <input
                type="password"
                className={styles.textInput}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>CONFIRM NEW PASSWORD</label>
              <input
                type="password"
                className={styles.textInput}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {passwordError && (
              <div className={styles.fieldError}>{passwordError}</div>
            )}
            {passwordSuccess && (
              <div className={styles.fieldSuccess}>
                Password changed successfully!
              </div>
            )}
            <div className={styles.editActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  setShowPasswordChange(false);
                  setPasswordError(null);
                }}
              >
                Cancel
              </button>
              <button
                className={styles.saveBtn}
                onClick={handlePasswordChange}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Account Removal */}
      <div className={styles.subsection}>
        <h3>Account Removal</h3>
        <p className={styles.dangerText}>
          Deleting your account will remove all of your data. This action is
          irreversible.
        </p>
        {!showDeleteConfirm ? (
          <button
            className={styles.dangerBtn}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete Account
          </button>
        ) : (
          <div className={styles.deleteConfirm}>
            <p className={styles.dangerText}>
              Are you sure? Enter your password to confirm.
            </p>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>PASSWORD</label>
              <input
                type="password"
                className={styles.textInput}
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            {deleteError && (
              <div className={styles.fieldError}>{deleteError}</div>
            )}
            <div className={styles.editActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteError(null);
                }}
              >
                Cancel
              </button>
              <button
                className={styles.dangerBtn}
                onClick={handleDeleteAccount}
              >
                Delete Account
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
    {avatarCropSrc && (
      <ImageCropModal
        imageSrc={avatarCropSrc}
        shape="circle"
        outputWidth={256}
        outputHeight={256}
        title="Crop Avatar"
        onApply={handleAvatarCropApply}
        onCancel={handleAvatarCropCancel}
      />
    )}
    {bannerCropSrc && (
      <ImageCropModal
        imageSrc={bannerCropSrc}
        shape="rect"
        outputWidth={600}
        outputHeight={240}
        title="Crop Banner"
        onApply={handleBannerCropApply}
        onCancel={handleBannerCropCancel}
      />
    )}
    </>
  );
}

/* ──────────────────────────── Profiles ──────────────────────────── */

function ProfilesSection() {
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();
  const [displayName, setDisplayName] = useState(user?.global_name ?? user?.username ?? '');
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [accentColor, setAccentColor] = useState<string>(
    user?.accent_color != null
      ? '#' + user.accent_color.toString(16).padStart(6, '0')
      : '#3b82f6'
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Use a NaN check, not `|| null`, so pure black (#000000 → 0) is saved instead of
      // being coerced to null (which the API treats as "no change").
      const parsedAccent = parseInt(accentColor.replace('#', ''), 16);
      const accentInt = Number.isNaN(parsedAccent) ? null : parsedAccent;
      const updated = await api.updateUser({
        global_name: displayName,
        pronouns,
        bio,
        accent_color: accentInt,
      });
      dispatch(
        setUser({
          id: updated.id,
          username: updated.username,
          email: updated.email,
          avatar: updated.avatar,
          banner: updated.banner,
          global_name: updated.global_name,
          bio: updated.bio,
          accent_color: updated.accent_color,
          pronouns: updated.pronouns,
        }),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.section}>
      <h2>Content & Social</h2>
      <div className={styles.profileLayout}>
        <div className={styles.profileForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>DISPLAY NAME</label>
            <input
              className={styles.textInput}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>PRONOUNS</label>
            <input
              className={styles.textInput}
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="Add your pronouns"
              maxLength={40}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>ABOUT ME</label>
            <textarea
              className={styles.bioInput}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell the world a little about yourself"
              rows={4}
              maxLength={190}
            />
            <p className={styles.optionHint}>
              You can use markdown and links if you'd like.
            </p>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>BANNER COLOR</label>
            <div className={styles.colorPickerRow}>
              <input
                type="color"
                className={styles.colorInput}
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
              />
              <input
                className={styles.colorHexInput}
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                maxLength={7}
              />
            </div>
          </div>

          <div className={styles.editActions}>
            {saved && (
              <span className={styles.fieldSuccess}>Changes saved!</span>
            )}
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Preview Card */}
        <div className={styles.profilePreview}>
          <div className={styles.previewLabel}>PREVIEW</div>
          <div className={styles.previewCard}>
            <div
              className={styles.previewBanner}
              style={
                user?.banner
                  ? { backgroundImage: `url(${user.banner})` }
                  : { backgroundColor: accentColor }
              }
            />
            <div className={styles.previewBody}>
              <div className={styles.previewAvatar}>
                {user?.avatar ? (
                  <img src={user.avatar} alt="" />
                ) : (
                  user?.username?.charAt(0).toUpperCase()
                )}
              </div>
              <div className={styles.previewName}>
                {displayName || user?.username}
              </div>
              <div className={styles.previewUsername}>{user?.username}</div>
              {bio && (
                <>
                  <div className={styles.previewDivider} />
                  <div className={styles.previewBioLabel}>ABOUT ME</div>
                  <div className={styles.previewBio}>{bio}</div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Appearance ──────────────────────────── */

function AppearanceSection() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.settings);

  return (
    <div className={styles.section}>
      <h2>Appearance</h2>

      {/* Theme */}
      <div className={styles.option}>
        <label className={styles.optionLabel}>THEME</label>
        <div className={styles.themeOptions}>
          {(['relay'] as const).map((t) => (
            <button
              key={t}
              className={`${styles.themeBtn} ${settings.theme === t ? styles.selected : ''}`}
              onClick={() => {
                dispatch(setTheme(t));
                api.updateSettings({ theme: t }).catch(() => {/* ignore */});
              }}
            >
              <div className={styles.themeRadio}>
                {settings.theme === t && (
                  <div className={styles.themeRadioInner} />
                )}
              </div>
              Relay
            </button>
          ))}
        </div>
      </div>

      <div className={styles.separator} />

      {/* Message Display */}
      <div className={styles.option}>
        <label className={styles.optionLabel}>MESSAGE DISPLAY</label>
        <div className={styles.themeOptions}>
          {(['cozy', 'compact'] as const).map((mode) => (
            <button
              key={mode}
              className={`${styles.themeBtn} ${settings.messageDisplayMode === mode ? styles.selected : ''}`}
              onClick={() => {
                dispatch(setMessageDisplayMode(mode));
                api.updateSettings({ message_display_compact: mode === 'compact' }).catch(() => {/* ignore */});
              }}
            >
              <div className={styles.themeRadio}>
                {settings.messageDisplayMode === mode && (
                  <div className={styles.themeRadioInner} />
                )}
              </div>
              <div>
                <div>{mode === 'cozy' ? 'Cozy' : 'Compact'}</div>
                <div className={styles.radioHint}>
                  {mode === 'cozy'
                    ? 'Show avatars, display names, and timestamps on each message group.'
                    : 'Fit more messages on screen by reducing padding.'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.separator} />

      {/* Font Scaling */}
      <div className={styles.option}>
        <div className={styles.sliderHeader}>
          <label className={styles.optionLabel}>CHAT FONT SCALING</label>
          <span className={styles.sliderValue}>{settings.fontSize}px</span>
        </div>
        <input
          type="range"
          className={styles.slider}
          min={12}
          max={24}
          step={1}
          value={settings.fontSize}
          onChange={(e) => {
            dispatch(setFontSize(Number(e.target.value)));
            api.updateSettings({ font_size: Number(e.target.value) }).catch(() => {/* ignore */});
          }}
        />
        <div className={styles.sliderMarks}>
          <span>12px</span>
          <span>16px</span>
          <span>20px</span>
          <span>24px</span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Voice & Video ──────────────────────────── */

interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

/* ──────────────────────────── Accessibility ──────────────────────────── */

function AccessibilitySection() {
  const dispatch = useAppDispatch();
  const reducedMotion = useAppSelector(s => s.settings.reducedMotion);
  const saturation = useAppSelector(s => s.settings.saturation);
  const showRoleColors = useAppSelector(s => s.settings.showRoleColors);
  const showLinkPreviews = useAppSelector(s => s.settings.showLinkPreviews);
  const enableTTS = useAppSelector(s => s.settings.enableTTS);
  const highContrast = useAppSelector(s => s.settings.highContrast);

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Accessibility</h2>

      {/* Reduced Motion */}
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel} htmlFor="reduced-motion">Reduced Motion</label>
          <span className={styles.settingDescription}>
            Reduces the amount of motion and animations in the app.
          </span>
        </div>
        <button
          id="reduced-motion"
          type="button"
          role="switch"
          aria-checked={reducedMotion}
          className={`${styles.toggle} ${reducedMotion ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setReducedMotion(!reducedMotion))}
          aria-label="Toggle reduced motion"
        >
          <div className={styles.toggleHandle} />
        </button>
      </div>

      {/* Saturation */}
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel} htmlFor="saturation-slider">Saturation</label>
          <span className={styles.settingDescription}>
            Adjust the intensity of colors in the app ({saturation}%).
          </span>
        </div>
        <input
          id="saturation-slider"
          type="range"
          min={0}
          max={200}
          step={1}
          value={saturation}
          onChange={(e) => dispatch(setSaturation(parseInt(e.target.value, 10)))}
          className={styles.slider}
          aria-label={`Saturation ${saturation}%`}
        />
      </div>

      {/* Role Colors */}
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel} htmlFor="role-colors">Role Colors</label>
          <span className={styles.settingDescription}>
            Show role colors for usernames in chat and the member list.
          </span>
        </div>
        <button
          id="role-colors"
          type="button"
          role="switch"
          aria-checked={showRoleColors}
          className={`${styles.toggle} ${showRoleColors ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setShowRoleColors(!showRoleColors))}
          aria-label="Toggle role colors"
        >
          <div className={styles.toggleHandle} />
        </button>
      </div>

      {/* Link Previews */}
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel} htmlFor="link-previews">Link Preview</label>
          <span className={styles.settingDescription}>
            Automatically show embed previews for links sent in chat.
          </span>
        </div>
        <button
          id="link-previews"
          type="button"
          role="switch"
          aria-checked={showLinkPreviews}
          className={`${styles.toggle} ${showLinkPreviews ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setShowLinkPreviews(!showLinkPreviews))}
          aria-label="Toggle link previews"
        >
          <div className={styles.toggleHandle} />
        </button>
      </div>

      {/* Text-to-Speech */}
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel} htmlFor="tts-toggle">Text-to-Speech</label>
          <span className={styles.settingDescription}>
            Allow playback and usage of /tts messages.
          </span>
        </div>
        <button
          id="tts-toggle"
          type="button"
          role="switch"
          aria-checked={enableTTS}
          className={`${styles.toggle} ${enableTTS ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setEnableTTS(!enableTTS))}
          aria-label="Toggle text-to-speech"
        >
          <div className={styles.toggleHandle} />
        </button>
      </div>

      {/* High Contrast */}
      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel} htmlFor="high-contrast">High Contrast</label>
          <span className={styles.settingDescription}>
            Increases contrast of borders and text for improved readability.
          </span>
        </div>
        <button
          id="high-contrast"
          type="button"
          role="switch"
          aria-checked={highContrast}
          className={`${styles.toggle} ${highContrast ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setHighContrast(!highContrast))}
          aria-label="Toggle high contrast"
        >
          <div className={styles.toggleHandle} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <label className={styles.settingLabel}>Font Scaling</label>
          <span className={styles.settingDescription}>
            Adjust font size in the Appearance settings tab.
          </span>
        </div>
      </div>
    </div>
  );
}

function VoiceVideoSection() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.settings);
  const { switchInputDevice } = useMediaStreams();
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);

  useEffect(() => {
    async function enumerateDevices() {
      try {
        // Need permission to enumerate devices with labels
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then((stream) => {
          stream.getTracks().forEach((t) => t.stop());
        }).catch(() => {
          /* user denied, still try enumerate */
        });

        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioInputs(
          devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
            })),
        );
        setAudioOutputs(
          devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Speaker ${d.deviceId.slice(0, 5)}`,
            })),
        );
        setVideoInputs(
          devices
            .filter((d) => d.kind === 'videoinput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Camera ${d.deviceId.slice(0, 5)}`,
            })),
        );
      } catch {
        /* browser doesn't support mediaDevices */
      }
    }
    enumerateDevices();
  }, []);

  return (
    <div className={styles.section}>
      <h2>Voice & Video</h2>

      {/* Voice Settings */}
      <div className={styles.subsectionTitle}>Voice Settings</div>

      <div className={styles.twoCol}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>INPUT DEVICE</label>
          <select
            className={styles.selectInput}
            value={settings.inputDevice}
            onChange={(e) => {
              dispatch(setInputDevice(e.target.value));
              void switchInputDevice(e.target.value);
            }}
          >
            <option value="default">Default</option>
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>OUTPUT DEVICE</label>
          <select
            className={styles.selectInput}
            value={settings.outputDevice}
            onChange={(e) => {
              dispatch(setOutputDevice(e.target.value));
              applyOutputDeviceToAll(e.target.value);
            }}
          >
            <option value="default">Default</option>
            {audioOutputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.separator} />

      {/* Input Mode */}
      <div className={styles.option}>
        <label className={styles.optionLabel}>INPUT MODE</label>
        <div className={styles.themeOptions}>
          {(['voiceActivity', 'pushToTalk'] as const).map((mode) => (
            <button
              key={mode}
              className={`${styles.themeBtn} ${settings.inputMode === mode ? styles.selected : ''}`}
              onClick={() => dispatch(setInputMode(mode))}
            >
              <div className={styles.themeRadio}>
                {settings.inputMode === mode && (
                  <div className={styles.themeRadioInner} />
                )}
              </div>
              {mode === 'voiceActivity' ? 'Voice Activity' : 'Push to Talk'}
            </button>
          ))}
        </div>
      </div>

      {settings.inputMode === 'voiceActivity' && (
        <div className={styles.formGroup}>
          <div className={styles.sliderHeader}>
            <label className={styles.formLabel}>SENSITIVITY</label>
            <span className={styles.sliderValue}>{settings.voiceSensitivity}</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={100}
            value={settings.voiceSensitivity}
            onChange={(e) => dispatch(setVoiceSensitivity(Number(e.target.value)))}
          />
        </div>
      )}

      {/* Push-to-Talk needs a key bound right here, or the mode does nothing. */}
      {settings.inputMode === 'pushToTalk' && <PushToTalkKeybind />}

      {/* Mic test: live level meter so the user can confirm their mic works. */}
      <MicTest />

      <div className={styles.separator} />

      {/* Audio Processing */}
      <div className={styles.subsectionTitle}>Audio Processing</div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>Echo Cancellation</label>
          </div>
          <button
            className={`${styles.toggle} ${settings.echoCancellation ? styles.toggleOn : ''}`}
            onClick={() => dispatch(setEchoCancellation(!settings.echoCancellation))}
            aria-label="Toggle echo cancellation"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>Noise Suppression</label>
          </div>
          <button
            className={`${styles.toggle} ${settings.noiseSuppression ? styles.toggleOn : ''}`}
            onClick={() => dispatch(setNoiseSuppression(!settings.noiseSuppression))}
            aria-label="Toggle noise suppression"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>Automatic Gain Control</label>
          </div>
          <button
            className={`${styles.toggle} ${settings.autoGainControl ? styles.toggleOn : ''}`}
            onClick={() => dispatch(setAutoGainControl(!settings.autoGainControl))}
            aria-label="Toggle automatic gain control"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.separator} />

      {/* Video Settings */}
      <div className={styles.subsectionTitle}>Video Settings</div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>CAMERA</label>
        <select
          className={styles.selectInput}
          value={settings.videoDevice}
          onChange={(e) => dispatch(setVideoDevice(e.target.value))}
        >
          <option value="default">Default</option>
          {videoInputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ──────────────────────────── Notifications ──────────────────────────── */

function NotificationsSection() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.settings);

  const handleDesktopToggle = () => {
    const next = !settings.enableDesktopNotifications;
    dispatch(setEnableDesktopNotifications(next));
    api.updateSettings({ enable_desktop_notifications: next }).catch(() => {/* ignore */});

    if (next && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  return (
    <div className={styles.section}>
      <h2>Notifications</h2>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>ENABLE DESKTOP NOTIFICATIONS</label>
            <p className={styles.optionHint}>
              Get notifications pushed directly to your desktop.
            </p>
          </div>
          <button
            className={`${styles.toggle} ${settings.enableDesktopNotifications ? styles.toggleOn : ''}`}
            onClick={handleDesktopToggle}
            role="switch"
            aria-checked={settings.enableDesktopNotifications}
            aria-label="Enable desktop notifications"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>ENABLE NOTIFICATION SOUNDS</label>
            <p className={styles.optionHint}>
              Play a sound when you receive a notification.
            </p>
          </div>
          <button
            className={`${styles.toggle} ${settings.enableSounds ? styles.toggleOn : ''}`}
            onClick={() => {
              dispatch(setEnableSounds(!settings.enableSounds));
              api.updateSettings({ enable_sounds: !settings.enableSounds }).catch(() => {/* ignore */});
            }}
            role="switch"
            aria-checked={settings.enableSounds}
            aria-label="Enable notification sounds"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.separator} />
      <div className={styles.subsectionTitle}>Notification Types</div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>MESSAGE NOTIFICATIONS</label>
            <p className={styles.optionHint}>
              Get notified for new messages in channels and DMs.
            </p>
          </div>
          <button
            className={`${styles.toggle} ${settings.enableMessageNotifications ? styles.toggleOn : ''}`}
            onClick={() =>
              dispatch(
                setEnableMessageNotifications(
                  !settings.enableMessageNotifications,
                ),
              )
            }
            role="switch"
            aria-checked={settings.enableMessageNotifications}
            aria-label="Message notifications"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>
              FRIEND REQUEST NOTIFICATIONS
            </label>
            <p className={styles.optionHint}>
              Get notified when someone sends you a friend request.
            </p>
          </div>
          <button
            className={`${styles.toggle} ${settings.enableFriendRequestNotifications ? styles.toggleOn : ''}`}
            onClick={() =>
              dispatch(
                setEnableFriendRequestNotifications(
                  !settings.enableFriendRequestNotifications,
                ),
              )
            }
            role="switch"
            aria-checked={settings.enableFriendRequestNotifications}
            aria-label="Friend request notifications"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>

      <div className={styles.option}>
        <div className={styles.toggleRow}>
          <div>
            <label className={styles.optionLabel}>SERVER NOTIFICATIONS</label>
            <p className={styles.optionHint}>
              Get notified for server events like new members.
            </p>
          </div>
          <button
            className={`${styles.toggle} ${settings.enableServerNotifications ? styles.toggleOn : ''}`}
            onClick={() =>
              dispatch(
                setEnableServerNotifications(
                  !settings.enableServerNotifications,
                ),
              )
            }
            role="switch"
            aria-checked={settings.enableServerNotifications}
            aria-label="Server notifications"
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Keybinds ──────────────────────────── */

function KeybindsSection() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.settings);
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (recordingIndex === null) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingIndex(null);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        parts.push(key);
      }

      if (parts.length > 0 && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        dispatch(setKeybind({ index: recordingIndex, key: parts.join('+') }));
        setRecordingIndex(null);
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [recordingIndex, dispatch]);

  return (
    <div className={styles.section}>
      <h2>Keybinds</h2>
      <p className={styles.optionHint}>
        Click on a keybind to edit it. Press Escape to cancel.
      </p>

      <div className={styles.keybindList}>
        {settings.keybinds.map((bind, index) => (
          <div key={bind.action} className={styles.keybindRow}>
            <span className={styles.keybindAction}>{bind.action}</span>
            <button
              className={`${styles.keybindKey} ${recordingIndex === index ? styles.recording : ''}`}
              onClick={() => setRecordingIndex(index)}
              aria-label={`Set keybind for ${bind.action}`}
            >
              {recordingIndex === index
                ? 'Press a key...'
                : bind.key || 'Not set'}
            </button>
          </div>
        ))}
      </div>

      <div className={styles.editActions}>
        <button
          className={styles.cancelBtn}
          onClick={() => dispatch(resetKeybinds())}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────── Advanced ──────────────────────────── */

function AdvancedSection() {
  const dispatch = useAppDispatch();
  const developerMode = useAppSelector((s) => s.settings.developerMode);

  return (
    <div className={styles.section}>
      <h2>Advanced</h2>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Developer Mode</div>
          <div className={styles.settingDescription}>
            Exposes context menu items helpful for people writing bots using the Relay API.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${developerMode ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setDeveloperMode(!developerMode))}
          aria-label="Toggle developer mode"
          role="switch"
          aria-checked={developerMode}
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>
    </div>
  );
}



/* ──────────────────────────── Text & Images ──────────────────────────── */

function TextImagesSection() {
  const dispatch = useAppDispatch();
  const autoPlayGifs = useAppSelector((s) => s.settings.autoPlayGifs);
  const showEmbeds = useAppSelector((s) => s.settings.showEmbeds);
  const showEmojiReactions = useAppSelector((s) => s.settings.showEmojiReactions);
  const convertEmoticons = useAppSelector((s) => s.settings.convertEmoticons);

  return (
    <div className={styles.section}>
      <h2>Text & Images</h2>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Automatically play GIFs when Relay is focused</div>
          <div className={styles.settingDescription}>
            GIFs will play automatically when the Relay window is focused. When off, GIFs
            show a paused preview until clicked.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${autoPlayGifs ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setAutoPlayGifs(!autoPlayGifs))}
          role="switch"
          aria-checked={autoPlayGifs}
          aria-label="Toggle auto-play GIFs"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Show embeds and preview info from links pasted into chat</div>
          <div className={styles.settingDescription}>
            When enabled, embeds and rich content from links will be displayed in chat.
            This also requires Link Preview to be on in Accessibility settings.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${showEmbeds ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setShowEmbeds(!showEmbeds))}
          role="switch"
          aria-checked={showEmbeds}
          aria-label="Toggle show embeds"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Show emoji reactions on messages</div>
          <div className={styles.settingDescription}>
            When enabled, emoji reactions will be displayed on messages.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${showEmojiReactions ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setShowEmojiReactions(!showEmojiReactions))}
          role="switch"
          aria-checked={showEmojiReactions}
          aria-label="Toggle show emoji reactions"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div className={styles.settingInfo}>
          <div className={styles.settingLabel}>Convert emoticons in your messages to emoji</div>
          <div className={styles.settingDescription}>
            When you type :) in a message, it will be displayed as an emoji.
          </div>
        </div>
        <button
          className={`${styles.toggle} ${convertEmoticons ? styles.toggleOn : ''}`}
          onClick={() => dispatch(setConvertEmoticons(!convertEmoticons))}
          role="switch"
          aria-checked={convertEmoticons}
          aria-label="Toggle convert emoticons"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>
    </div>
  );
}

