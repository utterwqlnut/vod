import json
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import boto3
from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("transcoder")

QUEUE_URL = os.environ["QUEUE_URL"]
UPLOADS_BUCKET = os.environ["S3_UPLOADS_BUCKET"]
MEDIA_BUCKET = os.environ["S3_MEDIA_BUCKET"]
POSTGRES_URL = os.environ["POSTGRES_URL"]
CDN_BASE_URL = os.environ["CDN_BASE_URL"].rstrip("/")

sqs = boto3.client("sqs")
s3 = boto3.client("s3")
engine = create_engine(POSTGRES_URL, pool_pre_ping=True)

RESOLUTIONS = [
    {"name": "360p", "height": 360, "bitrate": "800k", "audio": "96k"},
    {"name": "720p", "height": 720, "bitrate": "2800k", "audio": "128k"},
    {"name": "1080p", "height": 1080, "bitrate": "5000k", "audio": "192k"},
]


def run_ffmpeg(args: list[str]) -> None:
    log.info("ffmpeg %s", " ".join(args))
    subprocess.run(["ffmpeg", *args], check=True)


def transcode(source: Path, output_dir: Path) -> tuple[str, str]:
    video_id = uuid.uuid4().hex
    manifest_name = "master.m3u8"
    manifest_path = output_dir / manifest_name

    variant_playlists: list[str] = []

    for profile in RESOLUTIONS:
        variant_dir = output_dir / profile["name"]
        variant_dir.mkdir(parents=True, exist_ok=True)
        playlist = variant_dir / "index.m3u8"
        segment_pattern = str(variant_dir / "segment_%03d.ts")

        run_ffmpeg(
            [
                "-y",
                "-i",
                str(source),
                "-vf",
                f"scale=-2:{profile['height']}",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-b:v",
                profile["bitrate"],
                "-c:a",
                "aac",
                "-b:a",
                profile["audio"],
                "-hls_time",
                "6",
                "-hls_playlist_type",
                "vod",
                "-hls_segment_filename",
                segment_pattern,
                str(playlist),
            ]
        )
        variant_playlists.append(
            f"#EXT-X-STREAM-INF:BANDWIDTH={int(profile['bitrate'].replace('k', '000'))},"
            f"RESOLUTION=1280x{profile['height']}\n{profile['name']}/index.m3u8"
        )

    manifest_path.write_text(
        "#EXTM3U\n#EXT-X-VERSION:3\n" + "\n".join(variant_playlists) + "\n",
        encoding="utf-8",
    )

    thumb_path = output_dir / "thumbnail.jpg"
    run_ffmpeg(
        [
            "-y",
            "-i",
            str(source),
            "-ss",
            "00:00:03",
            "-vframes",
            "1",
            "-q:v",
            "2",
            str(thumb_path),
        ]
    )

    return video_id, manifest_name


def upload_tree(local_dir: Path, prefix: str) -> tuple[str, str]:
    manifest_key = ""
    thumbnail_key = ""

    for path in local_dir.rglob("*"):
        if path.is_file():
            rel = path.relative_to(local_dir).as_posix()
            key = f"{prefix}/{rel}"
            content_type = "application/vnd.apple.mpegurl" if rel.endswith(".m3u8") else None
            if rel.endswith(".ts"):
                content_type = "video/mp2t"
            if rel.endswith(".jpg"):
                content_type = "image/jpeg"
                thumbnail_key = key
            if rel == "master.m3u8":
                manifest_key = key

            extra = {"ContentType": content_type} if content_type else {}
            s3.upload_file(str(path), MEDIA_BUCKET, key, ExtraArgs=extra)

    return manifest_key, thumbnail_key


def find_doc_for_upload(upload_key: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, title, description
                FROM docs
                WHERE upload_key = :upload_key
                """
            ),
            {"upload_key": upload_key},
        ).mappings().first()
    return dict(row) if row else None


def mark_processing(doc_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE docs SET status = 'processing' WHERE id = :doc_id"),
            {"doc_id": doc_id},
        )


def mark_ready(doc_id: int, manifest_key: str, thumbnail_key: str, cdn_path: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE docs
                SET status = 'ready',
                    manifest_key = :manifest_key,
                    thumbnail_key = :thumbnail_key,
                    cdn_path = :cdn_path
                WHERE id = :doc_id
                """
            ),
            {
                "doc_id": doc_id,
                "manifest_key": manifest_key,
                "thumbnail_key": thumbnail_key,
                "cdn_path": cdn_path,
            },
        )


def mark_failed(doc_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE docs SET status = 'failed' WHERE id = :doc_id"),
            {"doc_id": doc_id},
        )


def process_job(bucket: str, key: str) -> None:
    doc = find_doc_for_upload(key)
    if doc is None:
        log.warning("No doc row for upload key %s", key)
        return

    doc_id = doc["id"]
    mark_processing(doc_id)

    workdir = Path(tempfile.mkdtemp())
    try:
        source = workdir / "source"
        source.mkdir()
        local_input = source / Path(key).name
        s3.download_file(bucket, key, str(local_input))

        output_dir = workdir / "output"
        output_dir.mkdir()
        video_id, _manifest = transcode(local_input, output_dir)

        prefix = f"media/{video_id}"
        manifest_key, thumbnail_key = upload_tree(output_dir, prefix)
        mark_ready(doc_id, manifest_key, thumbnail_key, manifest_key)
        log.info("Transcode complete for doc %s -> %s", doc_id, manifest_key)
    except Exception:
        log.exception("Transcode failed for doc %s", doc_id)
        mark_failed(doc_id)
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def poll_forever() -> None:
    log.info("Worker started, polling %s", QUEUE_URL)
    while True:
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=20,
            VisibilityTimeout=1800,
        )
        for message in response.get("Messages", []):
            body = json.loads(message["Body"])
            bucket = body["bucket"]
            key = body["key"]
            try:
                process_job(bucket, key)
                sqs.delete_message(
                    QueueUrl=QUEUE_URL,
                    ReceiptHandle=message["ReceiptHandle"],
                )
            except Exception:
                log.exception("Failed to process %s/%s", bucket, key)


if __name__ == "__main__":
    poll_forever()
