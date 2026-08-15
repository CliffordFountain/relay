import { useEffect, useRef, useState } from 'react';
import { isMediaSupported, MEDIA_INSECURE_CONTEXT_REASON } from '../../hooks/useMediaStreams';
import { store } from '../../stores/store';
import styles from './userSettings.module.scss';

/**
 * Mic Test — captures the microphone and shows a live input-level meter so the user
 * can confirm their mic actually works (the bar moves when they speak). This is
 * independent of the voice connection; it opens its own short-lived stream and tears
 * it down when stopped or unmounted.
 */
export function MicTest() {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0); // 0..100
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setLevel(0);
    setTesting(false);
  };

  const start = async () => {
    setError(null);
    if (!isMediaSupported()) {
      setError(MEDIA_INSECURE_CONTEXT_REASON);
      return;
    }
    try {
      const settings = store.getState().settings;
      const deviceId =
        settings.inputDevice && settings.inputDevice !== 'default'
          ? { exact: settings.inputDevice }
          : undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ?? { ideal: 'default' },
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
        const avg = sum / data.length; // 0..255
        setLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(tick);
      };
      setTesting(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access the microphone.');
    }
  };

  // Tear down on unmount (e.g. closing settings while a test is running).
  useEffect(() => () => stop(), []);

  return (
    <div className={styles.formGroup}>
      <div className={styles.sliderHeader}>
        <label className={styles.formLabel}>MIC TEST</label>
        <button
          type="button"
          className={styles.micTestBtn}
          onClick={() => (testing ? stop() : void start())}
          data-testid="mic-test-toggle"
        >
          {testing ? 'Stop Testing' : "Let's Check"}
        </button>
      </div>
      <div className={styles.micTestMeter} role="meter" aria-valuenow={level} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={styles.micTestMeterFill}
          style={{ width: `${level}%` }}
          data-testid="mic-test-level"
          data-level={level}
        />
      </div>
      {testing && (
        <p className={styles.optionHint}>
          Speak — the bar should move. If it stays flat, your mic isn&apos;t picking up sound.
        </p>
      )}
      {error && <p className={styles.micTestError}>{error}</p>}
    </div>
  );
}
