import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

interface VideoPlayerProps {
  src: string;
  poster?: string | null;
  title: string;
}

function formatLevel(height?: number): string {
  if (!height) return "Auto";
  return `${height}p`;
}

export default function VideoPlayer({ src, poster, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [quality, setQuality] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setQuality("Loading…");

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setQuality("Auto");
        void video.play().catch(() => undefined);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        setQuality(formatLevel(level?.height));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError("Playback failed. The stream may still be processing.");
          hls.destroy();
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      setQuality("Auto (native HLS)");
      void video.play().catch(() => undefined);
      return;
    }

    setError("HLS is not supported in this browser.");
  }, [src]);

  return (
    <div className="player-shell">
      <video
        ref={videoRef}
        className="player"
        controls
        playsInline
        poster={poster ?? undefined}
        aria-label={title}
      />
      <div className="player-meta">
        <span className="quality-badge">Quality: {quality}</span>
        <span className="player-hint">Adaptive bitrate · HLS</span>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
