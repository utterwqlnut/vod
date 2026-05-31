import type { SearchResponse, UploadResponse, Video } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json", ...init?.headers },
    ...init,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export function searchVideos(query: string, limit = 12): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return request(`/search?${params}`);
}

export function getVideo(id: number): Promise<Video> {
  return request(`/videos/${id}`);
}

export function createUpload(body: {
  title: string;
  description: string;
  filename: string;
}): Promise<UploadResponse> {
  return request("/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function uploadFileToS3(
  upload: UploadResponse,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", upload.upload_url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("S3 upload failed"));

    const formData = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) {
      formData.append(key, value);
    }
    formData.append("Content-Type", file.type || "video/mp4");
    formData.append("file", file);
    xhr.send(formData);
  });
}
