import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { UserSettings } from './UserSettings';
import { authSlice } from '../../stores/authSlice';
import { settingsSlice } from '../../stores/settingsSlice';
import { voiceSlice } from '../../stores/voiceSlice';

const mockLogout = vi.fn();
const mockUpdateSettings = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('../../api/rest', () => ({
  api: {
    logout: (...args: unknown[]) => mockLogout(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    clearToken: vi.fn(),
  },
}));

vi.mock('../../hooks/useMediaStreams', () => ({
  useMediaStreams: () => ({
    switchInputDevice: vi.fn().mockResolvedValue(undefined),
    startAudio: vi.fn().mockResolvedValue(undefined),
    stopAudio: vi.fn(),
    setAudioEnabled: vi.fn(),
    startVideo: vi.fn().mockResolvedValue(undefined),
    stopVideo: vi.fn(),
    startScreenShare: vi.fn().mockResolvedValue(undefined),
    stopScreenShare: vi.fn(),
    stopAllStreams: vi.fn(),
    audioRef: { current: null },
    videoRef: { current: null },
    screenRef: { current: null },
    getAudioStream: () => null,
    getVideoStream: () => null,
    getScreenStream: () => null,
  }),
  useStreamChangeListener: vi.fn(),
  getMediaState: () => ({
    audioStream: null,
    videoStream: null,
    screenStream: null,
  }),
  applyOutputDeviceToAll: vi.fn(),
  ensureDevicePermissions: vi.fn().mockResolvedValue(true),
  registerAudioElement: vi.fn(() => vi.fn()),
}));

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authSlice.reducer,
      settings: settingsSlice.reducer,
      voice: voiceSlice.reducer,
    },
    preloadedState: {
      auth: {
        token: 'test-token',
        user: {
          id: '1',
          username: 'testuser',
          email: 'test@example.com',
          avatar: null,
        },
        isAuthenticated: true, status: 'online' as const, customStatus: null,
      },
      voice: {
        connected: false,
        channelId: null,
        guildId: null,
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: false,
        voiceUsersByChannel: {},
        speakingUsers: [],
      },
      settings: {
        theme: 'relay' as const,
        fontSize: 16,
        messageDisplayMode: 'cozy' as const,
        enableDesktopNotifications: true,
        enableSounds: true,
        enableMessageNotifications: true,
        enableFriendRequestNotifications: true,
        enableServerNotifications: true,
        inputDevice: 'default',
        outputDevice: 'default',
        inputVolume: 100,
        outputVolume: 100,
        inputMode: 'voiceActivity' as const,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceSensitivity: 25,
        videoDevice: 'default',
        keybinds: [
          { action: 'Toggle Mute', key: 'Ctrl+Shift+M' },
          { action: 'Toggle Deafen', key: 'Ctrl+Shift+D' },
        ],
        reducedMotion: false,
        saturation: 100,
        showRoleColors: true,
        showLinkPreviews: true,
        enableTTS: false,
        highContrast: false,
        autoPlayGifs: true,
        showEmbeds: true,
        showEmojiReactions: true,
        convertEmoticons: true,
        developerMode: false,
        hideMutedChannelsByGuild: {},
        locale: 'en-US',
        streamerMode: false,
        autoEnableStreamerMode: false,
        hidePersonalInfo: true,
        hideInviteLinks: true,
        disableSoundsStreamer: true,
        disableNotificationsStreamer: true,
        safeDMs: true,
        allowDMsFromServerMembers: true,
        friendRequestSource: 'everyone' as const,
        messageRequests: true,
      },
    },
  });
}

describe('UserSettings', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
    mockUpdateSettings.mockResolvedValue({});
    mockUpdateUser.mockResolvedValue({
      id: '1',
      username: 'testuser',
      email: 'test@example.com',
      avatar: null,
    });
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    const { container } = render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );
    expect(container).toBeTruthy();
  });

  it('renders the navigation sidebar with all sections', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );
    expect(screen.getAllByText('My Account').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Content & Social')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Voice & Video')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Keybinds')).toBeInTheDocument();
    expect(screen.getByText('Log Out')).toBeInTheDocument();
  });

  it('shows My Account section by default with masked email', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );
    // Email should be masked by default
    expect(screen.getByText(/●+@example\.com/)).toBeInTheDocument();
    expect(screen.getByText('Reveal')).toBeInTheDocument();
  });

  it('reveals email when Reveal button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Reveal'));
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hide')).toBeInTheDocument();
  });

  it('switches sections when nav items are clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Appearance'));
    expect(screen.getByText('THEME')).toBeInTheDocument();
  });

  it('shows Appearance section with theme options', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Appearance'));
    expect(screen.getByText('Relay')).toBeInTheDocument();
  });

  it('shows Notifications section with toggle switches', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Notifications'));
    expect(
      screen.getByLabelText('Enable desktop notifications'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Enable notification sounds'),
    ).toBeInTheDocument();
  });

  it('shows Keybinds section with keybind list', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Keybinds'));
    expect(screen.getByText('Toggle Mute')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+M')).toBeInTheDocument();
  });

  it('shows Voice & Video section with device selectors', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Voice & Video'));
    expect(screen.getByText('INPUT DEVICE')).toBeInTheDocument();
    expect(screen.getByText('OUTPUT DEVICE')).toBeInTheDocument();
    expect(screen.getByText('CAMERA')).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes when close button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByLabelText('Close settings'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows edit fields when Edit is clicked on My Account', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    const editBtns = screen.getAllByText('Edit');
    fireEvent.click(editBtns[0]!);

    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows password change form when Change Password is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Change Password'));
    expect(screen.getByText('CURRENT PASSWORD')).toBeInTheDocument();
    expect(screen.getByText('NEW PASSWORD')).toBeInTheDocument();
    expect(screen.getByText('CONFIRM NEW PASSWORD')).toBeInTheDocument();
  });

  it('shows delete account confirmation when Delete Account is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Delete Account'));
    expect(
      screen.getByText('Are you sure? Enter your password to confirm.'),
    ).toBeInTheDocument();
  });

  it('calls logout and closes when Log Out is clicked', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Log Out'));

    // Wait for async logout
    await vi.waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
    expect(mockOnClose).toHaveBeenCalled();
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });

  it('shows Content & Social section with bio textarea and preview card', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Content & Social'));
    expect(screen.getByText('DISPLAY NAME')).toBeInTheDocument();
    expect(screen.getByText('ABOUT ME')).toBeInTheDocument();
    expect(screen.getByText('BANNER COLOR')).toBeInTheDocument();
    expect(screen.getByText('PREVIEW')).toBeInTheDocument();
  });









  it('renders all new nav items in sidebar', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('renders category headers for all groups', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByText('User Settings')).toBeInTheDocument();
    expect(screen.getByText('App Settings')).toBeInTheDocument();
  });




  it('renders Chat section with toggle switches', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Chat'));
    expect(screen.getByLabelText('Toggle auto-play GIFs')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle show embeds')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle show emoji reactions')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle convert emoticons')).toBeInTheDocument();
  });

  it('shows Security and Standing tabs on My Account page', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Standing')).toBeInTheDocument();
  });

  it('shows Standing tab content when Standing is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Standing'));
    expect(screen.getByText('Your account is in good standing')).toBeInTheDocument();
  });

  it('shows Edit User Profile button on My Account page', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByText('Edit User Profile')).toBeInTheDocument();
  });

  it('navigates to Content & Social when Edit User Profile is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    fireEvent.click(screen.getByText('Edit User Profile'));
    // Should now show Content & Social section content
    expect(screen.getByText('ABOUT ME')).toBeInTheDocument();
    expect(screen.getByText('BANNER COLOR')).toBeInTheDocument();
  });

  it('does not show a NEW badge in the settings sidebar', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.queryByText('NEW')).not.toBeInTheDocument();
  });

  it('has a search bar in settings sidebar', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    expect(screen.getByLabelText('Search settings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
  });

  it('filters settings tabs when searching', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <UserSettings onClose={mockOnClose} />
      </Provider>,
    );

    const searchInput = screen.getByPlaceholderText('Search');
    fireEvent.change(searchInput, { target: { value: 'Sessions' } });

    // Sessions should be visible
    // Other sections should be filtered out
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument();
    expect(screen.queryByText('Keybinds')).not.toBeInTheDocument();
  });
});
