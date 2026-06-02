// Global Vitest setup: bake sane localhost defaults so the suite runs without
// manual env exports. These mirror docker-compose.dev.yml + ci-test.yml.
//
// Only infra connection vars are defaulted here. Secrets that individual tests
// assert on (or deliberately leave unset) are NOT set, so test-local overrides
// keep working. `??=` only fills a value when it is missing.

// Postgres (roles created by packages/adapter-postgres/docker/init.sql)
process.env.DATABASE_URL ??=
  'postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev'
process.env.DATABASE_MIGRATE_URL ??=
  'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'

// S3 / MinIO
process.env.S3_ENDPOINT ??= 'http://localhost:9000'
process.env.S3_REGION ??= 'us-east-1'
process.env.S3_BUCKET ??= 'vibesboard-files'
process.env.S3_ACCESS_KEY_ID ??= 'vibesboard'
process.env.S3_SECRET_ACCESS_KEY ??= 'vibesboard'
process.env.S3_FORCE_PATH_STYLE ??= 'true'

// A dummy OpenAI key so client construction never throws; network calls are
// stubbed per-test via @vibesboard/test-helpers (stubOpenAIFetch).
process.env.OPENAI_API_KEY ??= 'sk-test-deterministic-key'
