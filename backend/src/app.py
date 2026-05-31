import os
import uuid

import boto3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

UPLOADS_BUCKET = os.environ["S3_UPLOADS_BUCKET"]
MEDIA_BUCKET = os.environ.get("S3_MEDIA_BUCKET", "")
POSTGRES_URL = os.environ["POSTGRES_URL"]
CDN_BASE_URL = os.environ["CDN_BASE_URL"].rstrip("/")
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

s3 = boto3.client("s3")
engine = create_engine(POSTGRES_URL, pool_pre_ping=True)

app = FastAPI(title="VOD API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in CORS_ORIGINS if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UploadRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    filename: str = Field(min_length=1, max_length=255)


class UploadResponse(BaseModel):
    doc_id: int
    upload_key: str
    upload_url: str
    fields: dict[str, str]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload", response_model=UploadResponse)
def create_upload(body: UploadRequest):
    upload_key = f"uploads/{uuid.uuid4()}/{body.filename}"

    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                INSERT INTO docs (title, description, upload_key, status)
                VALUES (:title, :description, :upload_key, 'pending')
                RETURNING id
                """
            ),
            {
                "title": body.title,
                "description": body.description,
                "upload_key": upload_key,
            },
        ).one()
        doc_id = row.id

    presigned = s3.generate_presigned_post(
        UPLOADS_BUCKET,
        upload_key,
        Fields={"Content-Type": "video/*"},
        Conditions=[{"Content-Type": "video/*"}],
        ExpiresIn=3600,
    )

    return UploadResponse(
        doc_id=doc_id,
        upload_key=upload_key,
        upload_url=presigned["url"],
        fields=presigned["fields"],
    )


@app.get("/search")
def search(q: str, limit: int = 10):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, title, description, thumbnail_key, manifest_key, cdn_path, status,
                       ts_rank(search_vector, websearch_to_tsquery('english', :q)) AS rank
                FROM docs
                WHERE search_vector @@ websearch_to_tsquery('english', :q)
                  AND status = 'ready'
                ORDER BY rank DESC
                LIMIT :limit
                """
            ),
            {"q": q, "limit": limit},
        ).mappings().all()

    results = []
    for row in rows:
        item = dict(row)
        cdn_path = item.pop("cdn_path", None) or item.get("manifest_key")
        item["stream_url"] = f"{CDN_BASE_URL}/{cdn_path}" if cdn_path else None
        if item.get("thumbnail_key"):
            item["thumbnail_url"] = f"{CDN_BASE_URL}/{item['thumbnail_key']}"
        results.append(item)

    return {"results": results}


@app.get("/videos/{doc_id}")
def get_video(doc_id: int):
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, title, description, thumbnail_key, manifest_key, cdn_path, status
                FROM docs
                WHERE id = :doc_id
                """
            ),
            {"doc_id": doc_id},
        ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Video not found")

    data = dict(row)
    cdn_path = data.get("cdn_path") or data.get("manifest_key")
    data["stream_url"] = f"{CDN_BASE_URL}/{cdn_path}" if cdn_path else None
    if data.get("thumbnail_key"):
        data["thumbnail_url"] = f"{CDN_BASE_URL}/{data['thumbnail_key']}"
    return data
