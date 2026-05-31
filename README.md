# VOD Platform

Video-on-demand backend built with **AWS CDK**, **FastAPI**, **PostgreSQL full-text search**, and **ffmpeg** transcoding on ECS.

## Architecture

```mermaid
flowchart LR
  subgraph streaming [Streaming Path]
    C[Client] --> R53A[Route53 cdn.*]
    R53A --> CF[CloudFront]
    CF -->|cache hit| C
    CF -->|cache miss| S3M[(Media S3)]
  end

  subgraph upload [Upload Path]
    A[Admin] --> R53B[Route53 api.*]
    R53B --> API[FastAPI on ECS]
    API --> S3U[(Uploads S3)]
    S3U --> L[Lambda enqueue]
    L --> Q[SQS]
    Q --> W[ECS ffmpeg workers]
    W --> S3M
    W --> PG[(PostgreSQL on EC2)]
  end

  subgraph search [Search Path]
    C2[Client] --> R53C[Route53 api.*]
    R53C --> API
    API --> PG
  end
```

| Path | Flow |
|------|------|
| **Streaming** | `cdn.openvod.net` → CloudFront → S3 media bucket (HLS manifests + segments) |
| **Upload** | `api.openvod.net/upload` → presigned S3 POST → Lambda → SQS → ECS ffmpeg worker |
| **Search** | `api.openvod.net/search?q=` → PostgreSQL `tsvector` index → thumbnail + CDN stream URL |

PostgreSQL runs on a private EC2 instance with a nightly `pg_dump` cron job to the backup S3 bucket.

## Repository layout

```
backend/          FastAPI API (upload, search, video metadata)
frontend/         React + hls.js adaptive video player
worker/           ECS ffmpeg transcoder (SQS consumer)
lambda/enqueue/   S3 upload trigger → SQS
cdk/              AWS CDK stacks + CI/CD pipeline
```

## Prerequisites

- AWS CLI configured
- Node.js 20+ and npm
- Docker (for ECS asset builds)
- A Route53 hosted zone for `openvod.net` (or change `cdk/lib/config.ts`)
- CDK bootstrapped: `cd cdk && npx cdk bootstrap`

## Deploy with CDK Pipeline (recommended)

1. Create a **CodeStar Connections** GitHub connection in AWS Console.
2. Set context in `cdk/cdk.json` or pass via CLI:

```json
{
  "context": {
    "githubOwner": "your-org",
    "githubRepo": "vod",
    "githubBranch": "main",
    "githubConnectionArn": "arn:aws:codestar-connections:us-east-1:ACCOUNT:connection/UUID"
  }
}
```

3. Deploy the pipeline stack (one-time):

```bash
cd cdk
npm ci
npm run build
npx cdk deploy VodPipelineStack
```

4. Push to `main` — the pipeline synths and deploys the `Prod` stage automatically.

## Direct deploy (dev / testing)

Skip the pipeline and deploy stacks directly:

```bash
cd cdk
npm ci && npm run build
npx cdk deploy --all -c directDeploy=true
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/upload` | Create doc row + presigned S3 upload URL |
| `GET` | `/search?q=` | Full-text search over title/description |
| `GET` | `/videos/{id}` | Video metadata + CDN stream URL |

### Upload example

```bash
# 1. Request presigned upload
curl -s -X POST https://api.openvod.net/upload \
  -H 'Content-Type: application/json' \
  -d '{"title":"Demo","description":"A test clip","filename":"demo.mp4"}'

# 2. POST the file to the returned upload_url with the returned fields
```

After upload completes, the worker transcodes to multi-bitrate HLS (360p/720p/1080p) and updates PostgreSQL. Search results include `stream_url` and `thumbnail_url` pointing at CloudFront.

## Local development

### Backend

```bash
uv sync
export POSTGRES_URL=postgresql+psycopg2://vod:vodpassword@localhost:5432/vod
export S3_UPLOADS_BUCKET=local-uploads
export CDN_BASE_URL=http://localhost:8080
uv run uvicorn app:app --app-dir backend/src --reload
```

### Frontend

Adaptive HLS player (search, watch, upload UI). Uses **hls.js** for ABR in Chrome/Firefox and native HLS in Safari.

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. API calls go to `/api/*`, proxied to `http://localhost:8000` during dev.

For production builds, point at your deployed API:

```bash
VITE_API_BASE_URL=https://api.openvod.net npm run build
```

Static output is in `frontend/dist/` (host on S3 + CloudFront, or any static host).

**Player flow:** search → pick a video → player loads `stream_url` (master `.m3u8` on CDN) → hls.js switches between 360p / 720p / 1080p automatically.

## CI/CD pipeline stages

The `VodPipelineStack` creates a self-mutating CodePipeline that:

1. Pulls source from GitHub via CodeStar Connection
2. Runs `npm ci`, `npm run build`, `npx cdk synth` in `cdk/`
3. Deploys the `Prod` stage: Storage → CloudFront → Backend → Route53
