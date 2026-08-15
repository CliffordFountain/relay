import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { GoLiveModal } from './GoLiveModal';
import { voiceSlice } from '../../stores/voiceSlice';
import { channelsSlice } from '../../stores/channelsSlice';
import { authSlice } from '../../stores/authSlice';

// Mutable capability flags so individual tests can simulate a device/browser
// without screen-share support, or an insecure (non-HTTPS) context. Declared
// via vi.hoisted so it exists before the hoisted vi.mock factory runs.
const mockCapabilities = vi.hoisted(() => ({
  screenShareSupported: true,
  mediaSupported: true,
}));
const mockStartScreenShare = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// Must match MEDIA_INSECURE_CONTEXT_REASON in useMediaStreams.ts.
const INSECURE_REASON = vi.hoisted(
  () =>
    'Microphone & camera need a secure (HTTPS) connection. Open Relay over HTTPS ' +
    '(e.g. https://<your-lan-ip>:5173) or on localhost, then try again.',
);

vi.mock('../../hooks/useMediaStreams', () => ({
  useMediaStreams: () => ({
    startScreenShare: mockStartScreenShare,
    stopScreenShare: vi.fn(),
    stopAllStreams: vi.fn(),
    startAudio: vi.fn().mockResolvedValue(null),
    stopAudio: vi.fn(),
    setAudioEnabled: vi.fn(),
    startVideo: vi.fn().mockResolvedValue(null),
    stopVideo: vi.fn(),
    audioRef: { current: null },
    videoRef: { current: null },
    screenRef: { current: null },
    getAudioStream: () => null,
    getVideoStream: () => null,
    getScreenStream: () => null,
    mediaError: null,
    clearMediaError: vi.fn(),
  }),
  useStreamChangeListener: vi.fn(),
  getMediaState: () => ({
    audioStream: null,
    videoStream: null,
    screenStream: null,
  }),
  isScreenShareSupported: () => mockCapabilities.screenShareSupported,
  isMediaSupported: () => mockCapabilities.mediaSupported,
  MEDIA_INSECURE_CONTEXT_REASON: INSECURE_REASON,
}));

vi.mock('../../utils/sounds', () => ({
  playScreenShareStartSound: vi.fn(),
  playScreenShareStopSound: vi.fn(),
}));

function createTestStore() {
  return configureStore({
    reducer: {
      voice: voiceSlice.reducer,
      channels: channelsSlice.reducer,
      auth: authSlice.reducer,
    },
    preloadedState: {
      voice: {
        channelId: '100',
        guildId: '1',
        selfMute: false,
        selfDeaf: false,
        selfVideo: false,
        selfScreenShare: false,
        connected: true,
        isSpeaking: false,
        speakingUsers: [],
        voiceUsersByChannel: {},
        voiceChannelStatuses: {},
        streamQuality: { resolution: 720 as const, frameRate: 30 as const },
      },
      channels: {
        channels: {
          '100': {
            id: '100',
            guild_id: '1',
            type: 2,
            name: 'General Voice',
            topic: null,
            position: 0,
            parent_id: null,
          },
        },
        selectedChannelId: '100',
      },
      auth: {
        token: 'test-token',
        user: { id: '50', username: 'TestUser', email: 'test@test.com', avatar: null },
        isAuthenticated: true, status: 'online' as const, customStatus: null,
      },
    },
  });
}

describe('GoLiveModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilities.screenShareSupported = true;
    mockCapabilities.mediaSupported = true;
  });

  it('renders without crashing', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays Screen Share title', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Screen Share')).toBeInTheDocument();
  });

  it('renders resolution dropdown with default 720p', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    const resolutionSelect = screen.getByLabelText('Resolution') as HTMLSelectElement;
    expect(resolutionSelect).toBeInTheDocument();
    expect(resolutionSelect.value).toBe('720');
  });

  it('renders frame rate dropdown with default 30 FPS', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    const fpsSelect = screen.getByLabelText('Frame Rate') as HTMLSelectElement;
    expect(fpsSelect).toBeInTheDocument();
    expect(fpsSelect.value).toBe('30');
  });

  it('has resolution options: 720p, 1080p, Source', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('720p')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
  });

  it('has frame rate options: 15 FPS, 30 FPS, 60 FPS', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('15 FPS')).toBeInTheDocument();
    expect(screen.getByText('30 FPS')).toBeInTheDocument();
    expect(screen.getByText('60 FPS')).toBeInTheDocument();
  });

  it('allows changing resolution', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    const resolutionSelect = screen.getByLabelText('Resolution') as HTMLSelectElement;
    fireEvent.change(resolutionSelect, { target: { value: '1080' } });
    expect(resolutionSelect.value).toBe('1080');
  });

  it('allows changing frame rate', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    const fpsSelect = screen.getByLabelText('Frame Rate') as HTMLSelectElement;
    fireEvent.change(fpsSelect, { target: { value: '60' } });
    expect(fpsSelect.value).toBe('60');
  });

  it('renders Go Live and Cancel buttons', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('Go Live')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when close X button is clicked', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking the overlay backdrop', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the STREAM QUALITY section header', () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    expect(screen.getByText('STREAM QUALITY')).toBeInTheDocument();
  });

  describe('when screen sharing is unsupported (mobile)', () => {
    beforeEach(() => {
      mockCapabilities.screenShareSupported = false;
    });

    it('shows an "unsupported" message instead of the normal preview text', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <GoLiveModal onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByText(/Screen sharing isn't supported/i)).toBeInTheDocument();
      expect(
        screen.queryByText('Your screen will be shared after clicking Go Live'),
      ).not.toBeInTheDocument();
    });

    it('disables the Go Live button', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <GoLiveModal onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByText('Go Live').closest('button')).toBeDisabled();
    });

    it('hides the stream quality controls', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <GoLiveModal onClose={onClose} />
        </Provider>,
      );
      expect(screen.queryByText('STREAM QUALITY')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Resolution')).not.toBeInTheDocument();
    });

    it('does not start screen share when Go Live is clicked', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <GoLiveModal onClose={onClose} />
        </Provider>,
      );
      fireEvent.click(screen.getByText('Go Live'));
      expect(mockStartScreenShare).not.toHaveBeenCalled();
    });
  });

  describe('when the context is insecure (http on a LAN IP)', () => {
    beforeEach(() => {
      // No secure context => neither screen share nor mic/camera can run.
      mockCapabilities.mediaSupported = false;
      mockCapabilities.screenShareSupported = false;
    });

    it('shows the actionable HTTPS message instead of the generic one', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <GoLiveModal onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByText(/secure \(HTTPS\) connection/i)).toBeInTheDocument();
      // The generic screen-share-unsupported copy should NOT be shown here.
      expect(
        screen.queryByText(/Screen sharing isn't supported/i),
      ).not.toBeInTheDocument();
    });

    it('disables the Go Live button', () => {
      const store = createTestStore();
      render(
        <Provider store={store}>
          <GoLiveModal onClose={onClose} />
        </Provider>,
      );
      expect(screen.getByText('Go Live').closest('button')).toBeDisabled();
    });
  });

  it('starts screen share when supported and Go Live is clicked', async () => {
    const store = createTestStore();
    render(
      <Provider store={store}>
        <GoLiveModal onClose={onClose} />
      </Provider>,
    );
    fireEvent.click(screen.getByText('Go Live'));
    // handleGoLive is async; flush microtasks.
    await Promise.resolve();
    expect(mockStartScreenShare).toHaveBeenCalled();
  });
});
