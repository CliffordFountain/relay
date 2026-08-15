import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { DeviceSelector } from './DeviceSelector';
import { settingsSlice } from '../../stores/settingsSlice';
import { voiceSlice } from '../../stores/voiceSlice';

const mockSwitchInputDevice = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useMediaStreams', () => ({
  useMediaStreams: () => ({
    switchInputDevice: mockSwitchInputDevice,
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

const mockDevices: MediaDeviceInfo[] = [
  {
    deviceId: 'mic-1',
    label: 'Built-in Microphone',
    kind: 'audioinput',
    groupId: 'g1',
    toJSON: () => ({}),
  },
  {
    deviceId: 'mic-2',
    label: 'USB Microphone',
    kind: 'audioinput',
    groupId: 'g2',
    toJSON: () => ({}),
  },
  {
    deviceId: 'speaker-1',
    label: 'Built-in Speakers',
    kind: 'audiooutput',
    groupId: 'g1',
    toJSON: () => ({}),
  },
  {
    deviceId: 'speaker-2',
    label: 'HDMI Output',
    kind: 'audiooutput',
    groupId: 'g3',
    toJSON: () => ({}),
  },
];

function createTestStore(overrides?: { inputDevice?: string; outputDevice?: string }) {
  return configureStore({
    reducer: {
      settings: settingsSlice.reducer,
      voice: voiceSlice.reducer,
    },
    preloadedState: {
      settings: {
        theme: 'dark' as const,
        fontSize: 16,
        messageDisplayMode: 'cozy' as const,
        enableDesktopNotifications: true,
        enableSounds: true,
        enableMessageNotifications: true,
        enableFriendRequestNotifications: true,
        enableServerNotifications: true,
        inputDevice: overrides?.inputDevice ?? 'default',
        outputDevice: overrides?.outputDevice ?? 'default',
        inputVolume: 100,
        outputVolume: 100,
        inputMode: 'voiceActivity' as const,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceSensitivity: 25,
        videoDevice: 'default',
        keybinds: [],
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
    },
  });
}

describe('DeviceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  it('renders input devices when mode is input', async () => {
    const store = createTestStore();
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="input" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('INPUT DEVICE')).toBeInTheDocument();
    });
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Built-in Microphone')).toBeInTheDocument();
    expect(screen.getByText('USB Microphone')).toBeInTheDocument();
    // Should not show output devices
    expect(screen.queryByText('Built-in Speakers')).not.toBeInTheDocument();
  });

  it('renders output devices when mode is output', async () => {
    const store = createTestStore();
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="output" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('OUTPUT DEVICE')).toBeInTheDocument();
    });
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Built-in Speakers')).toBeInTheDocument();
    expect(screen.getByText('HDMI Output')).toBeInTheDocument();
    // Should not show input devices
    expect(screen.queryByText('Built-in Microphone')).not.toBeInTheDocument();
  });

  it('shows checkmark on the currently selected device', async () => {
    const store = createTestStore({ inputDevice: 'mic-2' });
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="input" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('USB Microphone')).toBeInTheDocument();
    });
    // The USB Microphone button should have the selected class
    const usbButton = screen.getByText('USB Microphone').closest('button');
    expect(usbButton?.className).toContain('deviceOptionSelected');
    // Default should not be selected
    const defaultButton = screen.getByText('Default').closest('button');
    expect(defaultButton?.className).not.toContain('deviceOptionSelected');
  });

  it('dispatches setInputDevice and calls switchInputDevice when selecting an input device', async () => {
    const store = createTestStore();
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="input" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('USB Microphone')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('USB Microphone'));

    // Redux state should be updated
    expect(store.getState().settings.inputDevice).toBe('mic-2');
    // switchInputDevice should have been called with the device ID
    expect(mockSwitchInputDevice).toHaveBeenCalledWith('mic-2');
    // Popup should close after selection
    expect(onClose).toHaveBeenCalled();
  });

  it('dispatches setOutputDevice and calls applyOutputDeviceToAll when selecting an output device', async () => {
    const { applyOutputDeviceToAll } = await import('../../hooks/useMediaStreams');
    const store = createTestStore();
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="output" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('HDMI Output')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('HDMI Output'));

    // Redux state should be updated
    expect(store.getState().settings.outputDevice).toBe('speaker-2');
    // applyOutputDeviceToAll should have been called
    expect(applyOutputDeviceToAll).toHaveBeenCalledWith('speaker-2');
    // Popup should close after selection
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key', async () => {
    const store = createTestStore();
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="input" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('INPUT DEVICE')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('handles devices without labels by generating numbered names', async () => {
    const unlabeledDevices: MediaDeviceInfo[] = [
      {
        deviceId: 'mic-nolabel',
        label: '',
        kind: 'audioinput',
        groupId: 'g1',
        toJSON: () => ({}),
      },
    ];
    (navigator.mediaDevices.enumerateDevices as Mock).mockResolvedValue(unlabeledDevices);
    // ensureDevicePermissions will be called but still return unlabeled on re-enumerate
    (navigator.mediaDevices.enumerateDevices as Mock).mockResolvedValue(unlabeledDevices);

    const store = createTestStore();
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="input" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Microphone 1')).toBeInTheDocument();
    });
  });

  it('selects Default and updates Redux state', async () => {
    const store = createTestStore({ inputDevice: 'mic-1' });
    const onClose = vi.fn();
    render(
      <Provider store={store}>
        <DeviceSelector mode="input" onClose={onClose} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Default')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Default'));

    expect(store.getState().settings.inputDevice).toBe('default');
    expect(mockSwitchInputDevice).toHaveBeenCalledWith('default');
    expect(onClose).toHaveBeenCalled();
  });
});
