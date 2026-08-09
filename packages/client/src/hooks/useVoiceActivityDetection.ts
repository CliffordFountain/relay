import { useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from './useAppDispatch';
import { setLocalSpeaking } from '../stores/voiceSlice';
import { getMediaState } from './useMediaStreams';
import { voiceManager } from '../voice/voiceManager';

/** Delay in ms before the user is considered to have stopped speaking */
const SILENCE_DELAY_MS = 300;

/** Polling interval in ms for checking audio levels */
const POLL_INTERVAL_MS = 50;

/**
 * Hook that analyzes the local audio input stream using Web Audio API
 * to detect when the user is speaking, and dispatches speaking state
 * to the Redux store.
 *
 * This hook should be mounted once in a component that is always
 * rendered while the user is in a voice channel (e.g., VoiceConnectedBar
 * or the main app layout).
 */
export function useVoiceActivityDetection(): void {
  const dispatch = useAppDispatch();
  const connected = useAppSelector(s => s.voice.connected);
  const selfMute = useAppSelector(s => s.voice.selfMute);
  const currentUserId = useAppSelector(s => s.auth.user?.id);
  const voiceSensitivity = useAppSelector(s => s.settings.voiceSensitivity);
  const inputMode = useAppSelector(s => s.settings.inputMode);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpeakingRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackedStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Skip VAD entirely when in push-to-talk mode — PTT handles speaking state
    if (!connected || selfMute || !currentUserId || inputMode === 'pushToTalk') {
      // Clean up if we disconnect, mute, or no user
      cleanup();
      // If we were speaking, mark as not speaking
      if (lastSpeakingRef.current && currentUserId) {
        lastSpeakingRef.current = false;
        dispatch(setLocalSpeaking({ userId: currentUserId, speaking: false }));
      }
      return;
    }

    // Capture userId in a const that TypeScript knows is defined
    const userId: string = currentUserId;

    function setupAnalyser(): void {
      const media = getMediaState();
      const stream = media.audioStream;

      if (!stream) {
        // No audio stream yet, poll until it appears
        return;
      }

      // Don't re-create analyser for the same stream
      if (trackedStreamRef.current === stream && analyserRef.current) {
        return;
      }

      // Clean up old analyser if switching streams
      cleanupAudioNodes();

      trackedStreamRef.current = stream;

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;
    }

    function pollAudioLevel(): void {
      // Try to set up analyser if not yet created
      if (!analyserRef.current) {
        setupAnalyser();
      }

      const analyser = analyserRef.current;
      if (!analyser) return;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);

      // Calculate average amplitude across frequency bins
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] ?? 0;
      }
      const average = sum / dataArray.length;

      const isSpeakingNow = average > voiceSensitivity;

      if (isSpeakingNow) {
        // Clear any pending silence timer
        if (silenceTimerRef.current !== null) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        if (!lastSpeakingRef.current) {
          lastSpeakingRef.current = true;
          dispatch(setLocalSpeaking({ userId, speaking: true }));
          voiceManager.setSpeaking(true); // tell the SFU so other members see us speaking
        }
      } else {
        // Not speaking right now, start silence timer if currently marked as speaking
        if (lastSpeakingRef.current && silenceTimerRef.current === null) {
          silenceTimerRef.current = setTimeout(() => {
            lastSpeakingRef.current = false;
            dispatch(setLocalSpeaking({ userId, speaking: false }));
            voiceManager.setSpeaking(false);
            silenceTimerRef.current = null;
          }, SILENCE_DELAY_MS);
        }
      }
    }

    function cleanupAudioNodes(): void {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      trackedStreamRef.current = null;
    }

    function cleanup(): void {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      cleanupAudioNodes();
    }

    // Start polling
    intervalRef.current = setInterval(pollAudioLevel, POLL_INTERVAL_MS);

    return () => {
      cleanup();
      if (lastSpeakingRef.current) {
        lastSpeakingRef.current = false;
        dispatch(setLocalSpeaking({ userId, speaking: false }));
      }
    };
  }, [connected, selfMute, currentUserId, dispatch, voiceSensitivity, inputMode]);
}
