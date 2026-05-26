# @vibesboard/adapter-s3

S3-compatible binary storage adapter for Vibesboard self-host. Works
against MinIO (dev), Cloudflare R2, Backblaze B2, AWS S3, Wasabi, etc.

## Status

Sub-project #3 of the Firebase → Postgres/S3/Auth migration. See the
[design spec](../../docs/superpowers/specs/2026-05-17-adapter-s3-storage-design.md).

## Local dev

```bash
pnpm db:setup           # also brings up MinIO at localhost:9000 (api) + :9001 (console)
pnpm minio:console      # open the web console
```

## Imports

```ts
import {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  downloadFile,
  deleteFile,
  fileExists,
} from '@vibesboard/adapter-s3'
```
