/**
 * Relay-like sound effects using Web Audio API.
 * Each function plays a short synthetic sound.
 * All sounds respect the global `enableSounds` setting from the settings Redux slice.
 */

import { store } from '../stores/store';
import { playChime, playPop, playDoubleTone, playPing, playTone, playRing } from './soundGenerator';

function isSoundEnabled(): boolean {
  return store.getState().settings.enableSounds;
}

/** Ascending two-tone chime - played when joining a voice channel */
export function playJoinSound(): void {
  if (!isSoundEnabled()) return;
  playChime([480, 720], [0.12, 0.15], 'sine', 0.25);
}

/** Descending two-tone chime - played when leaving/disconnecting from voice */
export function playLeaveSound(): void {
  if (!isSoundEnabled()) return;
  playChime([720, 480], [0.12, 0.15], 'sine', 0.25);
}

/** Quick low click/pop - played when muting */
export function playMuteSound(): void {
  if (!isSoundEnabled()) return;
  playPop(false, 0.2);
}

/** Quick higher click/pop - played when unmuting */
export function playUnmuteSound(): void {
  if (!isSoundEnabled()) return;
  playPop(true, 0.2);
}

/** Double low tone - played when deafening */
export function playDeafenSound(): void {
  if (!isSoundEnabled()) return;
  playDoubleTone(false, 0.2);
}

/** Double higher tone - played when undeafening */
export function playUndeafenSound(): void {
  if (!isSoundEnabled()) return;
  playDoubleTone(true, 0.2);
}

/** Subtle notification ping - played when a message arrives in a non-active channel */
export function playMessageSound(): void {
  if (!isSoundEnabled()) return;
  playPing(false, 0.2);
}

/** Slightly louder notification - played when the user is mentioned */
export function playMentionSound(): void {
  if (!isSoundEnabled()) return;
  playPing(true, 0.25);
}

/** Subtle pop - played when another user joins your voice channel */
export function playUserJoinVoiceSound(): void {
  if (!isSoundEnabled()) return;
  playPop(true, 0.15);
}

/** Subtle pop - played when another user leaves your voice channel */
export function playUserLeaveVoiceSound(): void {
  if (!isSoundEnabled()) return;
  playPop(false, 0.15);
}

/** Short descending tone - played on unexpected disconnection */
export function playDisconnectSound(): void {
  if (!isSoundEnabled()) return;
  playChime([600, 350], [0.1, 0.2], 'sine', 0.25);
}

/** Subtle activation sound - played when starting screen share */
export function playScreenShareStartSound(): void {
  if (!isSoundEnabled()) return;
  playTone(880, 0.12, 'sine', 0.15);
}

/** Subtle deactivation sound - played when stopping screen share */
export function playScreenShareStopSound(): void {
  if (!isSoundEnabled()) return;
  playTone(440, 0.12, 'sine', 0.15);
}

/**
 * Repeating ring tone for DM calls.
 * Returns a handle with stop() to cease ringing.
 */
export function playCallRinging(): ReturnType<typeof playRing> {
  if (!isSoundEnabled()) {
    return { stop: () => { /* noop */ } };
  }
  return playRing(0.3);
}
