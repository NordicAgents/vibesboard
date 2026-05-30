// Shared S3/MinIO env defaults for adapter-s3 tests.
//
// The global Vitest setup (test/setup/env.ts) already bakes these, but importing
// this module first keeps the integration tests self-sufficient if the adapter
// is exercised in isolation. Defaults match docker-compose.dev.yml.
process.env.S3_ENDPOINT ??= 'http://localhost:9000'
process.env.S3_REGION ??= 'us-east-1'
process.env.S3_BUCKET ??= 'vibesboard-files'
process.env.S3_ACCESS_KEY_ID ??= 'vibesboard'
process.env.S3_SECRET_ACCESS_KEY ??= 'vibesboard'
process.env.S3_FORCE_PATH_STYLE ??= 'true'

export {}
