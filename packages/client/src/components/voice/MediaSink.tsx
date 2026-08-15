import { useEffect, useRef } from 'react';
import { registerAudioElement } from '../../hooks/useMediaStreams';

/**
 * Small presentational sinks for REMOTE media consumed from the SFU. Attaching a
 * MediaStream to a media element must happen via srcObject (not a prop), so these
 * wrap the imperative assignment in an effect keyed on the stream.
 */

interface RemoteVideoProps {
  stream: MediaStream | null | undefined;
  className?: string;
  /** Object-fit hint via className is preferred; kept minimal here. */
  onClick?: () => void;
}

export function RemoteVideo({ stream, className, onClick }: RemoteVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== (stream ?? null)) {
      el.srcObject = stream ?? null;
    }
  }, [stream]);
  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      // Muted: remote AUDIO is played through <RemoteAudio> sinks so it can be
      // routed to the selected output device and gated by deafen. A muted <video>
      // is also required for autoplay to start without a user gesture.
      muted
      playsInline
      onClick={onClick}
    />
  );
}

interface RemoteAudioProps {
  stream: MediaStream;
  /** When true (deafened), the audio element is muted but stays attached. */
  muted: boolean;
}

export function RemoteAudio({ stream, muted }: RemoteAudioProps) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  // Register with the output-device (setSinkId) registry so the user's chosen
  // speaker applies, and unregister on unmount.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerAudioElement(el);
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio ref={ref} autoPlay style={{ display: 'none' }} />;
}
