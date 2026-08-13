import { useEffect, useRef } from "react";

/**
 * Shared <video>/<audio> player wired for progress: resumes from the last
 * saved position, reports the position on pause, every few seconds during
 * playback, and when leaving the page mid-play, and marks the lesson
 * complete near the end (spec §2). Playback speed is remembered per
 * course (rateStorageKey) in localStorage. Only .vtt sidecars become
 * <track>s — browsers don't support .srt there.
 */
export function MediaPlayer({
  kind,
  src,
  subtitleTracks,
  initialPosition,
  completed,
  rateStorageKey,
  onPosition,
  onComplete,
}: {
  kind: "video" | "audio";
  src: string;
  subtitleTracks: { src: string; label: string }[];
  initialPosition: number;
  completed: boolean;
  rateStorageKey: string;
  onPosition: (seconds: number) => void;
  onComplete: () => void;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const lastSavedAt = useRef(0);
  const completedRef = useRef(completed);

  // Save the position when the lesson unmounts (navigating to the next
  // lesson or back to the course) or the tab is closed — the 5s throttle
  // alone would lose the tail of the session.
  useEffect(() => {
    const save = () => {
      const el = mediaRef.current;
      if (el && el.currentTime > 0 && !el.ended) onPosition(el.currentTime);
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
    // onPosition is stable for a given lesson and the component is keyed
    // by lesson path, so mount-only is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoadedMetadata(el: HTMLMediaElement) {
    const storedRate = Number(localStorage.getItem(rateStorageKey));
    if (storedRate >= 0.25 && storedRate <= 4) el.playbackRate = storedRate;
    // Resume, unless we're at the very start or the very end.
    if (initialPosition > 5 && initialPosition < el.duration - 5) {
      el.currentTime = initialPosition;
    }
  }

  function handleRateChange(el: HTMLMediaElement) {
    if (el.playbackRate > 0) {
      localStorage.setItem(rateStorageKey, String(el.playbackRate));
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
    ref: (el: HTMLMediaElement | null) => {
      mediaRef.current = el;
    },
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      handleLoadedMetadata(e.currentTarget),
    onRateChange: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      handleRateChange(e.currentTarget),
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
