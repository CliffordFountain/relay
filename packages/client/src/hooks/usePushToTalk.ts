import { useEffect, useRef, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from './useAppDispatch';
import { setLocalSpeaking } from '../stores/voiceSlice';
import { getMediaState } from './useMediaStreams';
import { store } from '../stores/store';
import { voiceManager } from '../voice/voiceManager';
import { keyboardMatchesBind, mouseMatchesBind } from './keybind';

/** Default release delay in ms before muting after key up */
const DEFAULT_RELEASE_DELAY_MS = 200;

/**
 * Returns true if the keyboard event originated from an element that
 * accepts text input (input, textarea, contentEditable, role="textbox").
 * PTT should not activate while the user is typing in chat or search.
 */
function isTextInputFocused(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;
  if (target.isContentEditable) return true;
  if (target.getAttribute('role') === 'textbox') return true;
  return false;
}

/**
 * Hook that implements Push-to-Talk (PTT) functionality.
 *
 * When inputMode is 'pushToTalk' and the user is connected to a voice channel:
 * - Pressing the configured PTT keybind unmutes the audio track and dispatches speaking state
 * - Releasing the key mutes the audio track after a configurable release delay
 *
 * When inputMode is 'voiceActivity', this hook does nothing.
 *
 * This hook should be mounted in a component that persists while the user
 * is connected to voice (e.g., VoiceConnectedBar).
 */
export function usePushToTalk(releaseDelayMs: number = DEFAULT_RELEASE_DELAY_MS): void {
  const dispatch = useAppDispatch();
  const connected = useAppSelector(s => s.voice.connected);
  const inputMode = useAppSelector(s => s.settings.inputMode);
  const currentUserId = useAppSelector(s => s.auth.user?.id);

  const isPttActiveRef = useRef(false);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getPttKeybind = useCallback((): string => {
    const settings = store.getState().settings;
    const pttBind = settings.keybinds.find(kb => kb.action === 'Push to Talk');
    return pttBind?.key ?? '';
  }, []);

  useEffect(() => {
    // Only activate when in PTT mode and connected to voice
    if (inputMode !== 'pushToTalk' || !connected || !currentUserId) {
      return;
    }

    const userId: string = currentUserId;

    // Shared activate / release so keyboard and mouse binds behave identically.
    function activate(): void {
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      if (isPttActiveRef.current) return;
      isPttActiveRef.current = true;

      const media = getMediaState();
      if (media.audioStream) {
        media.audioStream.getAudioTracks().forEach(track => { track.enabled = true; });
      }
      dispatch(setLocalSpeaking({ userId, speaking: true }));
      voiceManager.setSpeaking(true); // tell the SFU so other members see us speaking
    }

    function scheduleRelease(): void {
      if (!isPttActiveRef.current || releaseTimerRef.current !== null) return;
      releaseTimerRef.current = setTimeout(() => {
        isPttActiveRef.current = false;
        releaseTimerRef.current = null;

        const media = getMediaState();
        if (media.audioStream) {
          media.audioStream.getAudioTracks().forEach(track => { track.enabled = false; });
        }
        dispatch(setLocalSpeaking({ userId, speaking: false }));
        voiceManager.setSpeaking(false);
      }, releaseDelayMs);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.repeat) return; // key held down
      if (isTextInputFocused(event)) return; // don't PTT while typing
      if (!keyboardMatchesBind(getPttKeybind(), event)) return;
      event.preventDefault();
      activate();
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (!keyboardMatchesBind(getPttKeybind(), event)) return;
      event.preventDefault();
      scheduleRelease();
    }

    // Mouse-button binds (Mouse3 = middle, Mouse4/Mouse5 = side buttons). Left/right
    // clicks are never bound, so normal UI clicks are unaffected.
    function handleMouseDown(event: MouseEvent): void {
      if (!mouseMatchesBind(getPttKeybind(), event)) return;
      event.preventDefault(); // stop back/forward navigation on the side buttons
      activate();
    }

    function handleMouseUp(event: MouseEvent): void {
      if (!mouseMatchesBind(getPttKeybind(), event)) return;
      event.preventDefault();
      scheduleRelease();
    }

    // Ensure audio track starts muted in PTT mode
    const media = getMediaState();
    if (media.audioStream) {
      media.audioStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);

      // Clean up release timer
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }

      // If PTT was active when unmounting, clean up speaking state
      if (isPttActiveRef.current) {
        isPttActiveRef.current = false;
        const currentMedia = getMediaState();
        if (currentMedia.audioStream) {
          currentMedia.audioStream.getAudioTracks().forEach(track => {
            track.enabled = false;
          });
        }
        dispatch(setLocalSpeaking({ userId, speaking: false }));
      }
    };
  }, [connected, inputMode, currentUserId, dispatch, getPttKeybind, releaseDelayMs]);
}
