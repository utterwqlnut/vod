import { Link } from "react-router-dom";
import type { Video } from "../types";

interface VideoCardProps {
  video: Video;
}

export default function VideoCard({ video }: VideoCardProps) {
  return (
    <Link to={`/watch/${video.id}`} className="video-card">
      <div className="video-card-thumb">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" loading="lazy" />
        ) : (
          <div className="video-card-placeholder">No preview</div>
        )}
      </div>
      <div className="video-card-body">
        <h3>{video.title}</h3>
        {video.description && <p>{video.description}</p>}
      </div>
    </Link>
  );
}
