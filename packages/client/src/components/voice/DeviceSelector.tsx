import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppSelector, useAppDispatch } from '../../hooks/useAppDispatch';
import { setInputDevice, setOutputDevice } from '../../stores/settingsSlice';
import { useMediaStreams } from '../../hooks/useMediaStreams';
import { applyOutputDeviceToAll, ensureDevicePermissions } from '../../hooks/useMediaStreams';
import styles from './deviceSelector.module.scss';

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface DeviceSelectorProps {
  onClose: () => void;
  mode: 'input' | 'output';
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export const DeviceSelector = ({ onClose, mode, anchorRef }: DeviceSelectorProps) => {
  const dispatch = useAppDispatch();
  const selectedInput = useAppSelector(s => s.settings.inputDevice);
  const selectedOutput = useAppSelector(s => s.settings.outputDevice);
  const { switchInputDevice } = useMediaStreams();

  const popupRef = useRef<HTMLDivElement>(null);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const loadDevices = useCallback(async () => {
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();

      // If labels are empty, request permission first then re-enumerate
      const hasLabels = devices.some(d => d.label !== '');
      if (!hasLabels && devices.length > 0) {
        const granted = await ensureDevicePermissions();
        if (granted) {
          devices = await navigator.mediaDevices.enumerateDevices();
        }
      }

      const inputs: AudioDevice[] = [];
      const outputs: AudioDevice[] = [];
      let inputIndex = 1;
      let outputIndex = 1;

      for (const device of devices) {
        let label = device.label;
        if (!label) {
          if (device.kind === 'audioinput') {
            label = `Microphone ${inputIndex}`;
            inputIndex++;
          } else if (device.kind === 'audiooutput') {
            label = `Speaker ${outputIndex}`;
            outputIndex++;
          }
        }

        const item: AudioDevice = {
          deviceId: device.deviceId,
          label,
          kind: device.kind,
        };

        if (device.kind === 'audioinput') {
          inputs.push(item);
        } else if (device.kind === 'audiooutput') {
          outputs.push(item);
        }
      }

      setInputDevices(inputs);
      setOutputDevices(outputs);
    } catch {
      // Permission denied or API unavailable - leave lists empty
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  // Position the popup relative to the anchor element
  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPopupStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(8, rect.left - 100),
      });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSelectInput = (deviceId: string) => {
    dispatch(setInputDevice(deviceId));
    // If currently streaming audio, restart with the new device
    void switchInputDevice(deviceId);
    onClose();
  };

  const handleSelectOutput = (deviceId: string) => {
    dispatch(setOutputDevice(deviceId));
    // Apply to all registered audio elements immediately
    applyOutputDeviceToAll(deviceId);
    onClose();
  };

  const devices = mode === 'input' ? inputDevices : outputDevices;
  const selected = mode === 'input' ? selectedInput : selectedOutput;
  const handleSelect = mode === 'input' ? handleSelectInput : handleSelectOutput;
  const headerLabel = mode === 'input' ? 'INPUT DEVICE' : 'OUTPUT DEVICE';
  const noDevicesLabel = mode === 'input' ? 'No input devices found' : 'No output devices found';

  return createPortal(
    <div
      ref={popupRef}
      className={styles.popup}
      style={anchorRef ? popupStyle : undefined}
      role="menu"
      aria-label={`${mode === 'input' ? 'Input' : 'Output'} device selector`}
    >
      <div className={styles.sectionHeader}>{headerLabel}</div>
      <div className={styles.deviceList}>
        <button
          className={`${styles.deviceOption} ${selected === 'default' ? styles.deviceOptionSelected : ''}`}
          onClick={() => handleSelect('default')}
          role="menuitem"
          type="button"
        >
          <span className={styles.deviceLabel}>Default</span>
          {selected === 'default' && (
            <svg className={styles.checkmark} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8.99991 16.17L4.82991 12L3.40991 13.41L8.99991 19L20.9999 7.00003L19.5899 5.59003L8.99991 16.17Z" />
            </svg>
          )}
        </button>
        {devices.length === 0 ? (
          <div className={styles.noDevices}>{noDevicesLabel}</div>
        ) : (
          devices.map((device) => (
            <button
              key={device.deviceId}
              className={`${styles.deviceOption} ${selected === device.deviceId ? styles.deviceOptionSelected : ''}`}
              onClick={() => handleSelect(device.deviceId)}
              role="menuitem"
              type="button"
            >
              <span className={styles.deviceLabel}>{device.label}</span>
              {selected === device.deviceId && (
                <svg className={styles.checkmark} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8.99991 16.17L4.82991 12L3.40991 13.41L8.99991 19L20.9999 7.00003L19.5899 5.59003L8.99991 16.17Z" />
                </svg>
              )}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
};
