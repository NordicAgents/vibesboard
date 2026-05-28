# @vibesboard/adapter-s3

S3-compatible binary storage adapter for Vibesboard. Works against MinIO
(dev), Cloudflare R2, Backblaze B2, AWS S3, Wasabi, and other
S3-compatible providers.

## Local dev

MinIO is provided by the repo's dev compose stack. Run these from the repo
root:

```bash
pnpm db:setup        # also brings up MinIO at localhost:9000 (API) + :9001 (console)
pnpm minio:console   # open http://localhost:9001
```

`pnpm db:setup` runs `docker compose -f docker-compose.dev.yml up` (Postgres +
Adminer + MinIO), then migrates and seeds. The `minio-init` job creates the
`vibesboard-files` bucket.

## Environment variables

Read by `src/client.ts`:

| Variable               | Required | Default       | Notes                                                          |
| ---------------------- | -------- | ------------- | -------------------------------------------------------------- |
| `S3_ENDPOINT`          | yes      | —             | e.g. `http://localhost:9000` for MinIO                         |
| `S3_REGION`            | no       | `us-east-1`   |                                                                |
| `S3_ACCESS_KEY_ID`     | yes      | —             |                                                                |
| `S3_SECRET_ACCESS_KEY` | yes      | —             |                                                                |
| `S3_BUCKET`            | yes      | —             | Bucket name (`vibesboard-files` in dev)                        |
| `S3_FORCE_PATH_STYLE`  | no       | `true`        | `true` for MinIO; `false` for AWS S3/R2 virtual-hosted style   |

All six are documented in the repo's `.env.example`.

## Imports

Single entry point — `@vibesboard/adapter-s3`:

```ts
import {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  downloadFile,
  deleteFile,
  fileExists,
  uploadFile,
  getFileMetadata,
  agentFileKey,
} from '@vibesboard/adapter-s3'
```
