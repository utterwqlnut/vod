export interface Video {
  id: number;
  title: string;
  description: string;
  thumbnail_key?: string | null;
  manifest_key?: string | null;
  cdn_path?: string | null;
  status: string;
  stream_url?: string | null;
  thumbnail_url?: string | null;
  rank?: number;
}

export interface SearchResponse {
  results: Video[];
}

export interface UploadResponse {
  doc_id: number;
  upload_key: string;
  upload_url: string;
  fields: Record<string, string>;
}
