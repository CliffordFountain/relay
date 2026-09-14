import { useEffect, useRef } from 'react';
import { registerAudioElement } from '../../hooks/useMediaStreams';

/**
 * Small presentational sinks for media rendered into a <video>/<audio> element.
 * Attaching a MediaStream must happen via srcObject (not a prop), so these wrap the
 * imperative assignment in an effect keyed on the stream. The effect also runs on
 * MOUNT, so the same stream re-attaches correctly when the element is unmounted and
 * remounted (e.g. when the stage switches between two screen-shares) — a parent-owned
 * ref keyed only on the stream value would NOT re-attach in that case.
 *
 * RemoteVideo works for LOCAL streams too (own camera / screen preview): it is always
 * muted, so a local preview never echoes, and local audio is never played through it.
 */

interface RemoteVideoProps {
  stream: MediaStream | null | undefined;
  className?: string;
  /** Object-fit hint via className is preferred; kept minimal here. */
  onClick?: () => void;
  /** Native tooltip (e.g. "Click to toggle fullscreen"). */
  title?: string;
}

export function RemoteVideo({ stream, className, onClick, title }: RemoteVideoProps) {
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
      // is also required for autoplay to start without a user gesture. Local previews
      // must also stay muted to avoid echoing the user's own mic/screen audio.
      muted
      playsInline
      onClick={onClick}
      title={title}
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
