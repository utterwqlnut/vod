import { FormEvent, useState } from "react";
import { searchVideos } from "../api/client";
import UploadForm from "../components/UploadForm";
import VideoCard from "../components/VideoCard";
import type { Video } from "../types";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Video[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await searchVideos(query.trim());
      setResults(data.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="hero">
        <form onSubmit={onSearch} className="search-form">
          <input
            type="search"
            placeholder="Search videos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search videos"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </section>

      {error && <p className="error">{error}</p>}

      {searched && !loading && results.length === 0 && (
        <p className="empty">No videos matched your search.</p>
      )}

      {results.length > 0 && (
        <section className="results">
          <h2>Results</h2>
          <div className="video-grid">
            {results.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        </section>
      )}

      <UploadForm />
    </>
  );
}
