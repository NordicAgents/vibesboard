# Adapter-S3 Storage Swap — Design Spec

**Status:** Approved 2026-05-17 (sub-project #3 of self-host migration)
**Sub-project of:** Replace Firebase with self-hosted Postgres + S3 + Auth
**Predecessor:** sub-project #1 (`adapter-postgres` foundation) — merged on this branch
**Audience:** Engineer implementing with zero context for the codebase

---

## Context

Today's binary-file storage lives in **Google Cloud Storage** via the Firebase Admin SDK. The package [`@vibesboard/adapter-firebase`](../../../packages/adapter-firebase/src/storage.ts) exposes a 5-function surface used by 6 callsites total. As part of the pure-self-host-fork migration, GCS is being replaced with an **S3-compatible** target — MinIO for local dev, R2/B2/AWS/etc. for production.

The S3 SDK speaks the same protocol against every S3-compatible service, so the *code* is the same; only `S3_ENDPOINT` + creds differ.

This is the third sub-project in the broader migration:

| # | Sub-project | Status |
|---|---|---|
| 1 | `adapter-postgres` foundation | ✅ Done |
| 2 | Auth swap (Firebase Auth → Better Auth) | not started |
| **3** | **Storage swap (this spec)** | **designing** |
| 4 | Data swap (port all Firestore callsites) | not started |
| 5 | Strip Stripe + simplify policy package | not started |
| 6 | Deployment + ops | not started |

Approved design decisions:

1. **Pure self-host fork** — single supported stack. `adapter-firebase/storage.ts` is deleted in this sub-project.
2. **Port the 5 callsites in this sub-project** — the surface is tiny (5 simple import-path swaps) and doing it now keeps sub-project #4 focused on the much-larger Firestore→Postgres data work.
3. **API surface preserved** — same function names, same signatures, same return types as today's `adapter-firebase/storage.ts`. Callsite migrations become one-line import swaps.

---

## Goal

Add `@vibesboard/adapter-s3` — a server-only workspace package that owns the binary-storage interface for Vibesboard self-host. Replace every existing callsite. Delete `adapter-firebase/src/storage.ts`.

### Non-goals (explicit)

- **Not** touching `adapter-firebase/admin.ts` or `client.ts` (sub-project #4 deletes the rest of that package).
- **Not** removing Firebase storage rules (`storage.rules`, `firebase.json`'s `storage` block) — sub-project #6.
- **Not** writing a production data migration script for files already in GCS — separate effort after sub-project #6.
- **Not** changing the file-key path scheme (`tenants/{tenantId}/agents/{agentId}/files/{fileName}` stays).
- **Not** modifying `deploy-cloud-run.sh` — sub-project #6.

---

## Architecture

### Package layout

```
packages/adapter-s3/
  package.json                      # name: @vibesboard/adapter-s3
  tsconfig.json
  README.md
  src/
    index.ts                        # the 5-function public API
    client.ts                       # S3Client singleton + env reading
    keys.ts                         # path/key helpers
    __tests__/
      smoke.test.ts                 # upload → download → delete round-trip against local MinIO
```

### Tech choices (locked)

| Concern | Choice |
|---|---|
| AWS SDK | `@aws-sdk/client-s3` (v3) |
| Pre-signer | `@aws-sdk/s3-request-presigner` |
| Local dev | MinIO (`minio/minio:latest`) in `docker-compose.dev.yml` |
| Test runner | Node's built-in `node --test` |
| Import style | `.ts` extensions on relative imports (matches `adapter-postgres`) |

### Public API (unchanged from `adapter-firebase/storage.ts`)

```ts
export async function getSignedUploadUrl(key: string, contentType: string, expiresInMs?: number): Promise<string>
export async function getSignedDownloadUrl(key: string, expiresInMs?: number): Promise<string>
export async function downloadFile(key: string): Promise<Buffer>
export async function deleteFile(key: string): Promise<void>      // ignore-not-found preserved
export async function fileExists(key: string): Promise<boolean>
```

Defaults match today's behaviour: upload URLs expire in 15 minutes, download URLs in 60 minutes.

`deleteFile` swallows `NoSuchKey` errors to match GCS's `ignoreNotFound: true` semantics.

### Env vars (added to `.env.example`)

```bash
S3_ENDPOINT=http://localhost:9000          # MinIO local; prod: https://s3.eu-north-1.amazonaws.com, r2.cloudflarestorage.com, etc.
S3_REGION=us-east-1                        # MinIO ignores; AWS/R2 require
S3_BUCKET=vibesboard-files
S3_ACCESS_KEY_ID=vibesboard
S3_SECRET_ACCESS_KEY=vibesboard
S3_FORCE_PATH_STYLE=true                   # true for MinIO; false for AWS/R2 virtual-hosted
```

Removed from `.env.example`: `GCS_BUCKET_NAME` (only consumed by the deleted file).

---

## Local development

### Docker Compose addition

Append to existing `docker-compose.dev.yml`:

```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: vibesboard
      MINIO_ROOT_PASSWORD: vibesboard
    ports:
      - '9000:9000'
      - '9001:9001'
    volumes:
      - vibesboard_minio:/data
    healthcheck:
      test: ['CMD-SHELL', 'curl -fsS http://localhost:9000/minio/health/live || exit 1']
      interval: 2s
      retries: 30

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: >
      sh -c "
        mc alias set local http://minio:9000 vibesboard vibesboard &&
        (mc mb -p local/vibesboard-files || true) &&
        mc anonymous set none local/vibesboard-files
      "
```

`vibesboard_minio` added to the `volumes:` block.

### Scripts

Root `package.json` additions:

```json
"minio:console": "open http://localhost:9001",
"storage:up": "docker compose -f docker-compose.dev.yml up -d minio minio-init"
```

`db:up` is broadened to also bring up MinIO (`docker compose up -d postgres minio minio-init` — adminer already starts via `depends_on`).

`db:reset` continues to work; it cleans the entire volume set including MinIO.

---

## Callsite migration (the 5 files)

Every change is a single import-path swap:

| File | Line | Today | After |
|---|---|---|---|
| `apps/web/app/api/agents/[id]/files/upload-url/route.ts` | ~31 | `@vibesboard/adapter-firebase/storage` | `@vibesboard/adapter-s3` |
| `apps/web/app/api/agents/[id]/files/delete/route.ts` | ~27 | same | same |
| `apps/web/app/api/agents/[id]/files/download-url/route.ts` | ~27 | same | same |
| `apps/web/app/api/files/upload-url/route.ts` | ~68 | same | same |
| `apps/web/app/api/agents/[id]/route.ts` | ~212 | same | same |
| `packages/ai/src/file-search.ts` | (TBD) | same | same |

No function-name or signature changes — pure import path swap.

### Cleanup after migration

After all 6 files are updated:

1. Delete `packages/adapter-firebase/src/storage.ts`
2. Remove the `./storage` entry from `packages/adapter-firebase/package.json` `exports`
3. Confirm via `grep -r '@vibesboard/adapter-firebase/storage' apps/ packages/` that no callers remain.

---

## Testing

One integration test file: `packages/adapter-s3/src/__tests__/smoke.test.ts`.

It runs the round-trip against the live MinIO container (same posture as `adapter-postgres` tests assume a running Postgres):

```ts
test('upload → download → delete round-trip', async () => {
  const key = `test-${randomUUID()}/hello.txt`
  const body = 'hello, vibesboard'

  // 1. Get a signed upload URL, PUT to it
  const uploadUrl = await getSignedUploadUrl(key, 'text/plain')
  const putResp = await fetch(uploadUrl, { method: 'PUT', body, headers: { 'Content-Type': 'text/plain' } })
  assert.equal(putResp.status, 200)

  // 2. fileExists is now true
  assert.equal(await fileExists(key), true)

  // 3. Get a signed download URL, GET it
  const downloadUrl = await getSignedDownloadUrl(key)
  const getResp = await fetch(downloadUrl)
  assert.equal(getResp.status, 200)
  assert.equal(await getResp.text(), body)

  // 4. downloadFile returns the same buffer
  const buf = await downloadFile(key)
  assert.equal(buf.toString('utf8'), body)

  // 5. deleteFile + fileExists → false
  await deleteFile(key)
  assert.equal(await fileExists(key), false)

  // 6. deleteFile on missing key is a no-op
  await deleteFile(key)
})
```

Per-test keys (UUID prefix) keep concurrent runs from colliding.

### Test runner

The package's `test` script: `node --experimental-strip-types --test 'src/__tests__/**/*.test.ts'` (matches `adapter-postgres`). Wired into the root `pnpm -r --if-present test` already set up in sub-project #1.

---

## Deliverables

### New files

```
packages/adapter-s3/
  package.json
  tsconfig.json
  README.md
  src/index.ts
  src/client.ts
  src/keys.ts
  src/__tests__/smoke.test.ts
```

### Modified files

- `docker-compose.dev.yml` — adds `minio`, `minio-init` services and `vibesboard_minio` volume
- `.env.example` — adds 6 `S3_*` vars; removes `GCS_BUCKET_NAME`
- `package.json` (root) — adds `minio:console`, `storage:up` scripts; widens `db:up` to include MinIO
- `apps/web/app/api/agents/[id]/files/upload-url/route.ts` — import path swap
- `apps/web/app/api/agents/[id]/files/delete/route.ts` — import path swap
- `apps/web/app/api/agents/[id]/files/download-url/route.ts` — import path swap
- `apps/web/app/api/files/upload-url/route.ts` — import path swap
- `apps/web/app/api/agents/[id]/route.ts` — import path swap
- `packages/ai/src/file-search.ts` — import path swap
- `packages/adapter-firebase/package.json` — remove `./storage` from `exports`
- `README.md` — add MinIO line to Self-host quickstart

### Deleted files

- `packages/adapter-firebase/src/storage.ts`

### Untouched (intentional)

- `storage.rules`, `firebase.json` storage block (sub-project #6)
- `apps/functions/` (sub-project #4)
- `packages/adapter-firebase/src/admin.ts`, `src/client.ts`, `src/index.ts` (sub-project #4)
- `deploy-cloud-run.sh` (sub-project #6)

---

## Success criteria

1. ✅ `pnpm db:setup` brings up Postgres + MinIO; the `vibesboard-files` bucket exists.
2. ✅ `pnpm --filter @vibesboard/adapter-s3 test` smoke test passes.
3. ✅ `pnpm type-check`, `pnpm lint`, `pnpm format:check` pass at repo root.
4. ✅ `pnpm --filter @vibesboard/web build` succeeds.
5. ✅ `grep -rE '@vibesboard/adapter-firebase/storage' apps/ packages/` shows zero remaining callers.
6. ✅ `grep -rE 'GCS_BUCKET_NAME' apps/ packages/` shows zero remaining references (the `.env.example` line is gone too).
7. ✅ All existing `adapter-postgres` tests still pass (23/23).

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| AWS SDK signed URL with `Content-Type` parameter not matching GCS signed-URL semantics 1:1 (clients must send the same header on PUT) | Spec docs `getSignedUploadUrl(key, contentType)` requires `Content-Type` on the matching PUT; smoke test exercises this path |
| MinIO healthcheck timing — `pnpm db:setup` runs migrations before MinIO bucket is ready | `minio-init` is a separate service with `depends_on: { minio: condition: service_healthy }`; storage smoke test is independent of the DB migration timing |
| Existing GCS files in production are orphaned after the swap | Production data migration is **out of scope** for this sub-project (handled separately after sub-project #6). Note: this is fine because sub-project #3 runs only on `dev` until everything else is done. |
| `pnpm db:reset` wipes MinIO storage along with Postgres | This is desired behaviour for dev; documented in the README. Production has different reset semantics that sub-project #6 will define. |
| AWS SDK v3 is heavy (multi-megabyte) — affects bundle size? | Server-only package; not bundled to the client. Next.js Server Components / API routes only. |

---

## What sub-projects #2 / #4 / #5 / #6 inherit

- A working storage adapter accessible at `@vibesboard/adapter-s3` with a stable 5-function API.
- A running MinIO in dev that any later sub-project can use without reconfiguration.
- One fewer dependency on `adapter-firebase` (only `admin.ts` + `client.ts` remain after this PR).
