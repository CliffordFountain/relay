import { useEffect, useRef, useState } from 'react';
import { isMediaSupported, MEDIA_INSECURE_CONTEXT_REASON } from '../../hooks/useMediaStreams';
import { store } from '../../stores/store';
import styles from './userSettings.module.scss';

/**
 * Mic Test — captures the microphone and shows a live input-level meter so the user
 * can confirm their mic actually works (the bar moves when they speak). This is
 * independent of the voice connection; it opens its own short-lived stream and tears
 * it down when stopped or unmounted.
 *
 * "Hear myself" pipes the captured mic straight back to the speakers (a hidden <audio>
 * sink) so the user can confirm sound is actually coming through, not just watch a bar.
 * Best used with headphones — on open speakers it can feed back.
 */
export function MicTest() {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0); // 0..100
  const [monitor, setMonitor] = useState(false); // play the mic back to the speakers
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const monitorRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (monitorRef.current) monitorRef.current.srcObject = null;
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

      // Route the raw mic to the speakers when "Hear myself" is on (muted otherwise, so
      // the sink stays attached and un-mutes instantly when the box is ticked mid-test).
      if (monitorRef.current) {
        monitorRef.current.srcObject = stream;
        monitorRef.current.muted = !monitor;
        void monitorRef.current.play?.().catch(() => {});
      }

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

  // Keep the playback sink's mute in sync while a test is running, so ticking the box
  // starts/stops playback immediately without restarting the test.
  useEffect(() => {
    if (monitorRef.current) monitorRef.current.muted = !monitor;
  }, [monitor]);

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

      {/* Hear-myself monitor toggle */}
      <div className={styles.toggleRow}>
        <div>
          <label className={styles.optionLabel} htmlFor="mic-monitor-toggle">Hear myself</label>
        </div>
        <button
          id="mic-monitor-toggle"
          type="button"
          role="switch"
          aria-checked={monitor}
          className={`${styles.toggle} ${monitor ? styles.toggleOn : ''}`}
          onClick={() => setMonitor((m) => !m)}
          aria-label="Toggle hearing your own microphone"
          data-testid="mic-monitor-toggle"
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      {testing && (
        <p className={styles.optionHint}>
          Speak — the bar should move. If it stays flat, your mic isn&apos;t picking up sound.
        </p>
      )}
      {monitor && (
        <p className={styles.optionHint}>
          You&apos;ll hear your own mic played back — use headphones to avoid an echo.
        </p>
      )}
      {error && <p className={styles.micTestError}>{error}</p>}

      {/* Hidden playback sink for the "Hear myself" monitor. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={monitorRef} autoPlay style={{ display: 'none' }} data-testid="mic-monitor-audio" />
    </div>
  );
}
