/**
 * Web Audio API sound generation utilities.
 * Generates short synthetic sounds using OscillatorNode + GainNode.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  // Resume if suspended (browsers require user gesture first)
  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }
  return audioContext;
}

/**
 * Play a single tone at a given frequency for a given duration.
 */
export function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3,
): void {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  gainNode.gain.setValueAtTime(volume, ctx.currentTime);
  // Fade out to avoid click at end
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

/**
 * Play a sequence of tones (chime). Each tone plays after the previous one ends.
 * @param frequencies Array of frequencies to play in sequence
 * @param durations Array of durations for each tone (in seconds)
 * @param type Oscillator wave type
 * @param volume Volume level (0-1)
 */
export function playChime(
  frequencies: number[],
  durations: number[],
  type: OscillatorType = 'sine',
  volume: number = 0.3,
): void {
  const ctx = getAudioContext();
  let startTime = ctx.currentTime;

  for (let i = 0; i < frequencies.length; i++) {
    const freq = frequencies[i] ?? 440;
    const dur = durations[i] ?? durations[0] ?? 0.15;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, startTime);

    gainNode.gain.setValueAtTime(volume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + dur);

    startTime += dur;
  }
}

/**
 * Play a short click/pop sound using noise burst.
 * @param highPitch If true, plays a higher pitched pop
 * @param volume Volume level (0-1)
 */
export function playPop(highPitch: boolean = false, volume: number = 0.2): void {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  const freq = highPitch ? 1800 : 1000;
  const duration = 0.06;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(freq, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    highPitch ? 800 : 400,
    ctx.currentTime + duration,
  );

  gainNode.gain.setValueAtTime(volume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

/**
 * Play a double-tone click (for deafen/undeafen).
 * @param ascending If true plays ascending, otherwise descending
 * @param volume Volume level (0-1)
 */
export function playDoubleTone(ascending: boolean = true, volume: number = 0.2): void {
  const ctx = getAudioContext();
  const freq1 = ascending ? 600 : 800;
  const freq2 = ascending ? 800 : 600;
  const duration = 0.08;
  const gap = 0.05;

  // First tone
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
  gain1.gain.setValueAtTime(volume, ctx.currentTime);
  gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(ctx.currentTime);
  osc1.stop(ctx.currentTime + duration);

  // Second tone
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq2, ctx.currentTime + duration + gap);
  gain2.gain.setValueAtTime(volume, ctx.currentTime + duration + gap);
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration + gap + duration);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(ctx.currentTime + duration + gap);
  osc2.stop(ctx.currentTime + duration + gap + duration);
}

/**
 * Play a notification ping sound.
 * @param loud If true, plays a slightly louder/more prominent ping (for mentions)
 * @param volume Base volume level (0-1)
 */
export function playPing(loud: boolean = false, volume: number = 0.25): void {
  const ctx = getAudioContext();
  const baseFreq = loud ? 880 : 660;
  const effectiveVolume = loud ? volume * 1.4 : volume;
  const duration = loud ? 0.2 : 0.15;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(baseFreq, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, ctx.currentTime + 0.05);
  oscillator.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, ctx.currentTime + duration);

  gainNode.gain.setValueAtTime(effectiveVolume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

interface RingHandle {
  stop: () => void;
}

/**
 * Play a repeating ring tone for DM calls.
 * Returns a handle with a stop() method to stop the ringing.
 */
export function playRing(volume: number = 0.3): RingHandle {
  const ctx = getAudioContext();
  let stopped = false;
  let currentTimeout: ReturnType<typeof setTimeout> | null = null;

  function ringOnce(): void {
    if (stopped) return;

    const now = ctx.currentTime;
    // Two-tone ring: higher then lower
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, now); // C5
    gain1.gain.setValueAtTime(volume, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659, now + 0.3); // E5
    gain2.gain.setValueAtTime(volume, now + 0.3);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.3);
    osc2.stop(now + 0.6);

    // Repeat after a pause
    currentTimeout = setTimeout(() => {
      if (!stopped) {
        ringOnce();
      }
    }, 2000);
  }

  ringOnce();

  return {
    stop() {
      stopped = true;
      if (currentTimeout !== null) {
        clearTimeout(currentTimeout);
      }
    },
  };
}
