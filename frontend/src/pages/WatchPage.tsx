import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getVideo } from "../api/client";
import VideoPlayer from "../components/VideoPlayer";
import type { Video } from "../types";

export default function WatchPage() {
  const { id } = useParams();
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const docId = Number(id);
    if (!docId) {
      setError("Invalid video id");
      setLoading(false);
      return;
    }

    setLoading(true);
    getVideo(docId)
      .then(setVideo)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load video"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <p className="loading">Loading video…</p>;
  }

  if (error || !video) {
    return (
      <div>
        <p className="error">{error ?? "Video not found"}</p>
        <Link to="/" className="back-link">
          ← Back to search
        </Link>
      </div>
    );
  }

  if (!video.stream_url) {
    return (
      <div>
        <h1>{video.title}</h1>
        <p className="empty">This video is not ready yet (status: {video.status}).</p>
        <Link to="/" className="back-link">
          ← Back to search
        </Link>
      </div>
    );
  }

  return (
    <article className="watch-page">
      <Link to="/" className="back-link">
        ← Back to search
      </Link>
      <VideoPlayer
        src={video.stream_url}
        poster={video.thumbnail_url}
        title={video.title}
      />
      <div className="watch-details">
        <h1>{video.title}</h1>
        {video.description && <p>{video.description}</p>}
      </div>
    </article>
  );
}
