import { FormEvent, useState } from "react";
import { createUpload, uploadFileToS3 } from "../api/client";

export default function UploadForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a video file.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setProgress(0);

    try {
      const upload = await createUpload({
        title,
        description,
        filename: file.name,
      });
      await uploadFileToS3(upload, file, setProgress);
      setMessage(`Uploaded. Video #${upload.doc_id} is transcoding — search for it once ready.`);
      setTitle("");
      setDescription("");
      setFile(null);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upload-panel">
      <h2>Upload</h2>
      <form onSubmit={onSubmit} className="upload-form">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </label>
        <label>
          Video file
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload video"}
        </button>
      </form>
      {progress !== null && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
          <span>{progress}%</span>
        </div>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
