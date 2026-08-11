import { useRef } from "react";

/**
 * Shared <video>/<audio> player wired for progress: resumes from the last
 * saved position, reports the position on pause and every few seconds
 * during playback, and marks the lesson complete near the end (spec §2).
 * Only .vtt sidecars become <track>s — browsers don't support .srt there.
 */
export function MediaPlayer({
  kind,
  src,
  subtitleTracks,
  initialPosition,
  completed,
  onPosition,
  onComplete,
}: {
  kind: "video" | "audio";
  src: string;
  subtitleTracks: { src: string; label: string }[];
  initialPosition: number;
  completed: boolean;
  onPosition: (seconds: number) => void;
  onComplete: () => void;
}) {
  const lastSavedAt = useRef(0);
  const completedRef = useRef(completed);

  function handleLoadedMetadata(el: HTMLMediaElement) {
    // Resume, unless we're at the very start or the very end.
    if (initialPosition > 5 && initialPosition < el.duration - 5) {
      el.currentTime = initialPosition;
    }
  }

  function handleTimeUpdate(el: HTMLMediaElement) {
    const now = Date.now();
    if (now - lastSavedAt.current > 5000) {
      lastSavedAt.current = now;
      onPosition(el.currentTime);
    }
    if (
      !completedRef.current &&
      el.duration > 0 &&
      el.currentTime / el.duration >= 0.95
    ) {
      completedRef.current = true;
      onComplete();
    }
  }

  function handleEnded(el: HTMLMediaElement) {
    onPosition(el.duration);
    if (!completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }

  const mediaProps = {
    src,
    controls: true,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      handleLoadedMetadata(e.currentTarget),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      handleTimeUpdate(e.currentTarget),
    onPause: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      onPosition(e.currentTarget.currentTime),
    onEnded: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      handleEnded(e.currentTarget),
  };

  if (kind === "audio") {
    return <audio className="player player--audio" {...mediaProps} />;
  }
  return (
    <video className="player" {...mediaProps}>
      {subtitleTracks.map((track, i) => (
        <track
          key={track.src}
          kind="subtitles"
          src={track.src}
          label={track.label}
          default={i === 0}
        />
      ))}
    </video>
  );
}
