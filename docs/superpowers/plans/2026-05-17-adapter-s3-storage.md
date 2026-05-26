# Adapter-S3 Storage Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `@vibesboard/adapter-s3`, port the 6 callsites to it, and delete `adapter-firebase/storage.ts`.

**Architecture:** New server-only workspace package wrapping `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Same 5-function API as today's `adapter-firebase/storage.ts` — callsite migrations are one-line import path swaps. MinIO added to `docker-compose.dev.yml` for local dev.

**Tech Stack:** `@aws-sdk/client-s3` (v3), `@aws-sdk/s3-request-presigner`, MinIO (local), Node `node --test` runner.

**Spec:** [docs/superpowers/specs/2026-05-17-adapter-s3-storage-design.md](../specs/2026-05-17-adapter-s3-storage-design.md) — read this before starting Task 1.

---

## File structure (target state)

```
docker-compose.dev.yml                                  (modified — adds minio + minio-init)
.env.example                                            (modified — adds S3_*, removes GCS_BUCKET_NAME)
package.json                                            (modified — db:up widened, minio:console added)
README.md                                               (modified — note MinIO in quickstart)
packages/adapter-s3/                                    (NEW)
  package.json
  tsconfig.json
  README.md
  src/index.ts
  src/client.ts
  src/keys.ts
  src/__tests__/smoke.test.ts
packages/adapter-firebase/
  package.json                                          (modified — drop ./storage from exports)
  src/storage.ts                                        (DELETED)
apps/web/app/api/agents/[id]/files/upload-url/route.ts  (1-line import swap)
apps/web/app/api/agents/[id]/files/delete/route.ts      (1-line import swap)
apps/web/app/api/agents/[id]/files/download-url/route.ts(1-line import swap)
apps/web/app/api/files/upload-url/route.ts              (1-line import swap)
apps/web/app/api/agents/[id]/route.ts                   (1-line import swap)
packages/ai/src/file-search.ts                          (1-line import swap)
```

---

## Tasks

### Task 1: Package scaffold + AWS SDK deps + env vars

**Files:**
- Create: `packages/adapter-s3/package.json`
- Create: `packages/adapter-s3/tsconfig.json`
- Create: `packages/adapter-s3/README.md`
- Modify: `.env.example`

- [ ] **Step 1.1:** Create `packages/adapter-s3/package.json`:

```json
{
  "name": "@vibesboard/adapter-s3",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "node --experimental-strip-types --test 'src/__tests__/**/*.test.ts'"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 1.2:** Create `packages/adapter-s3/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 1.3:** Create `packages/adapter-s3/README.md`:

```md
# @vibesboard/adapter-s3

S3-compatible binary storage adapter for Vibesboard self-host. Works
against MinIO (dev), Cloudflare R2, Backblaze B2, AWS S3, Wasabi, etc.

## Status

Sub-project #3 of the Firebase → Postgres/S3/Auth migration. See the
[design spec](../../docs/superpowers/specs/2026-05-17-adapter-s3-storage-design.md).

## Local dev

\`\`\`bash
pnpm db:setup           # also brings up MinIO at localhost:9000 (api) + :9001 (console)
pnpm minio:console      # open the web console
\`\`\`

## Imports

\`\`\`ts
import {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  downloadFile,
  deleteFile,
  fileExists,
} from '@vibesboard/adapter-s3'
\`\`\`
```

- [ ] **Step 1.4:** Modify `.env.example`:

Find and REMOVE the existing `GCS_BUCKET_NAME=vibeagent-files` line and its preceding `## Google Cloud Storage bucket name` comment.

Append at the end of the file (after the last existing block):

```bash
## S3-compatible storage (self-host)
## MinIO for dev; in prod set to your S3/R2/B2/etc. endpoint
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=vibesboard-files
S3_ACCESS_KEY_ID=vibesboard
S3_SECRET_ACCESS_KEY=vibesboard
## true for MinIO; false for AWS S3 / Cloudflare R2 / etc. (virtual-hosted style)
S3_FORCE_PATH_STYLE=true
```

- [ ] **Step 1.5:** Install + type-check

Run: `pnpm install`
Expected: completes without error; AWS SDK packages installed.

Run: `pnpm --filter @vibesboard/adapter-s3 type-check`
Expected: passes (empty package — `src/` doesn't exist yet; that's fine, tsc will exit cleanly).

If tsc complains about no input files because `src/` is empty, that's expected — proceed; Task 3 fills it in.

- [ ] **Step 1.6:** Commit

```bash
git add packages/adapter-s3/ .env.example
git commit -m "feat(adapter-s3): scaffold package + AWS SDK deps"
```

---

### Task 2: MinIO in docker-compose.dev.yml + pnpm scripts

**Files:**
- Modify: `docker-compose.dev.yml`
- Modify: `package.json` (root)

- [ ] **Step 2.1:** Modify `docker-compose.dev.yml` — add `minio` and `minio-init` services. After the existing `adminer:` service block (and before the existing `volumes:` top-level key), insert:

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
      timeout: 5s
      retries: 30

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      sh -c "
        mc alias set local http://minio:9000 vibesboard vibesboard &&
        (mc mb -p local/vibesboard-files || true) &&
        mc anonymous set none local/vibesboard-files
      "
```

Add `vibesboard_minio:` to the `volumes:` block at the bottom of the file. The result should look like:

```yaml
volumes:
  vibesboard_pg:
  vibesboard_minio:
```

- [ ] **Step 2.2:** Modify root `package.json` — broaden `db:up` to also bring MinIO up. Find the existing line:

```json
"db:up": "docker compose -f docker-compose.dev.yml up -d postgres adminer",
```

Change it to:

```json
"db:up": "docker compose -f docker-compose.dev.yml up -d postgres adminer minio minio-init",
```

Add a new `minio:console` script (anywhere in the `scripts` block):

```json
"minio:console": "open http://localhost:9001"
```

- [ ] **Step 2.3:** Bring MinIO up and verify

Run: `pnpm db:up`
Expected: services start; `minio-init` runs to completion and exits 0 (creating the bucket); `minio` reports Healthy.

Run: `docker exec $(docker ps -qf name=minio | head -1) mc ls local/`
Expected: lists `vibesboard-files/`.

- [ ] **Step 2.4:** Commit

```bash
git add docker-compose.dev.yml package.json
git commit -m "feat(adapter-s3): docker compose with MinIO + bucket bootstrap"
```

---

### Task 3: Implement the 5-function API

**Files:**
- Create: `packages/adapter-s3/src/client.ts`
- Create: `packages/adapter-s3/src/keys.ts`
- Create: `packages/adapter-s3/src/index.ts`

- [ ] **Step 3.1:** Create `packages/adapter-s3/src/client.ts`:

```ts
import 'server-only'
import { S3Client } from '@aws-sdk/client-s3'

function readEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[adapter-s3] ${name} is not set. See .env.example.`)
  return v
}

let _client: S3Client | undefined

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: readEnv('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: readEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: readEnv('S3_SECRET_ACCESS_KEY'),
      },
      // MinIO uses path-style. AWS/R2 use virtual-hosted (path-style: false).
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    })
  }
  return _client
}

export function getBucket(): string {
  return readEnv('S3_BUCKET')
}
```

- [ ] **Step 3.2:** Create `packages/adapter-s3/src/keys.ts`:

```ts
/**
 * File-key path scheme used by the app. Kept identical to the previous
 * GCS layout so existing file_keys stored in the DB remain valid.
 *
 *   tenants/{tenantId}/agents/{agentId}/files/{fileName}
 */
export function agentFileKey(tenantId: string, agentId: string, fileName: string): string {
  return `tenants/${tenantId}/agents/${agentId}/files/${fileName}`
}
```

- [ ] **Step 3.3:** Create `packages/adapter-s3/src/index.ts` — the 5-function public API:

```ts
import 'server-only'
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client, getBucket } from './client.ts'

export { agentFileKey } from './keys.ts'

/**
 * Generate a signed URL for uploading a file directly from the browser.
 * The client MUST send the same Content-Type header when issuing the PUT.
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInMs = 15 * 60 * 1000,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(getS3Client(), command, {
    expiresIn: Math.floor(expiresInMs / 1000),
  })
}

/**
 * Generate a signed URL for downloading a file.
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresInMs = 60 * 60 * 1000,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getS3Client(), command, {
    expiresIn: Math.floor(expiresInMs / 1000),
  })
}

/**
 * Download a file's contents as a Buffer.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  const response = await getS3Client().send(command)
  if (!response.Body) {
    throw new Error(`[adapter-s3] Empty body for key: ${key}`)
  }
  // Body is a readable stream; convert to Buffer.
  const chunks: Buffer[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Delete a file. Missing keys are silently ignored (matches the prior
 * GCS adapter's `ignoreNotFound: true` semantics).
 */
export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  try {
    await getS3Client().send(command)
  } catch (err: unknown) {
    // S3 DELETE is idempotent — most providers don't error on missing keys —
    // but be defensive against the few that do.
    const name = (err as { name?: string } | null)?.name
    if (name === 'NoSuchKey' || name === 'NotFound') return
    throw err
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(key: string): Promise<boolean> {
  const command = new HeadObjectCommand({ Bucket: getBucket(), Key: key })
  try {
    await getS3Client().send(command)
    return true
  } catch (err: unknown) {
    const name = (err as { name?: string } | null)?.name
    if (name === 'NoSuchKey' || name === 'NotFound') return false
    // Some S3-compat providers return a different error name with a 404
    // statusCode — check that too.
    const meta = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    if (meta?.httpStatusCode === 404) return false
    throw err
  }
}
```

- [ ] **Step 3.4:** Type-check

Run: `pnpm --filter @vibesboard/adapter-s3 type-check`
Expected: passes.

- [ ] **Step 3.5:** Commit

```bash
git add packages/adapter-s3/src/
git commit -m "feat(adapter-s3): implement signed URLs + download/delete/exists"
```

---

### Task 4: Smoke test against local MinIO

**Files:**
- Create: `packages/adapter-s3/src/__tests__/smoke.test.ts`

- [ ] **Step 4.1:** Create `packages/adapter-s3/src/__tests__/smoke.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  downloadFile,
  deleteFile,
  fileExists,
} from '../index.ts'

// Tests require MinIO running (pnpm db:up); env: S3_ENDPOINT, S3_BUCKET,
// S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE.

// Set sensible local defaults if env isn't loaded (e.g. from a .env file).
process.env.S3_ENDPOINT          ??= 'http://localhost:9000'
process.env.S3_REGION            ??= 'us-east-1'
process.env.S3_BUCKET            ??= 'vibesboard-files'
process.env.S3_ACCESS_KEY_ID     ??= 'vibesboard'
process.env.S3_SECRET_ACCESS_KEY ??= 'vibesboard'
process.env.S3_FORCE_PATH_STYLE  ??= 'true'

describe('adapter-s3 smoke', () => {
  test('upload → exists → download (signed + raw) → delete → not-exists round-trip', async () => {
    const key = `test-${randomUUID()}/hello.txt`
    const body = 'hello, vibesboard'

    // 1. Signed PUT
    const uploadUrl = await getSignedUploadUrl(key, 'text/plain')
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'text/plain' },
    })
    assert.equal(putResp.status, 200, `PUT failed: ${putResp.status} ${await putResp.text()}`)

    // 2. fileExists is true
    assert.equal(await fileExists(key), true)

    // 3. Signed GET returns the body
    const downloadUrl = await getSignedDownloadUrl(key)
    const getResp = await fetch(downloadUrl)
    assert.equal(getResp.status, 200)
    assert.equal(await getResp.text(), body)

    // 4. downloadFile returns the same body as a Buffer
    const buf = await downloadFile(key)
    assert.equal(buf.toString('utf8'), body)

    // 5. delete + fileExists false
    await deleteFile(key)
    assert.equal(await fileExists(key), false)

    // 6. delete is idempotent — no throw on missing key
    await deleteFile(key)
  })
})
```

- [ ] **Step 4.2:** Ensure MinIO is up

Run: `docker ps -qf name=minio | head -1` — if empty, run `pnpm db:up`.

- [ ] **Step 4.3:** Run the test

Run: `pnpm --filter @vibesboard/adapter-s3 test`
Expected: 1 test passes (the round-trip).

If the PUT fails with a 403 or 400 on `Content-Type`, MinIO's signature checks may be stricter than expected — the smoke test sends `Content-Type: text/plain` matching the signed URL, so this should work. If it fails, paste the error.

- [ ] **Step 4.4:** Commit

```bash
git add packages/adapter-s3/src/__tests__/smoke.test.ts
git commit -m "test(adapter-s3): smoke test against local MinIO"
```

---

### Task 5: Migrate the 6 callsites + delete the old file

**Files:**
- Modify: `apps/web/app/api/agents/[id]/files/upload-url/route.ts` (line 3)
- Modify: `apps/web/app/api/agents/[id]/files/delete/route.ts` (line 3)
- Modify: `apps/web/app/api/agents/[id]/files/download-url/route.ts` (line 3)
- Modify: `apps/web/app/api/files/upload-url/route.ts` (line 3)
- Modify: `apps/web/app/api/agents/[id]/route.ts` (line 9)
- Modify: `packages/ai/src/file-search.ts` (line 6)
- Modify: `packages/adapter-firebase/package.json` (remove `./storage` from exports)
- Delete: `packages/adapter-firebase/src/storage.ts`

- [ ] **Step 5.1:** In all six callsite files, replace the import path. Each file has exactly one line of the form:

```ts
import { … } from '@vibesboard/adapter-firebase/storage'
```

Replace with (preserving the named imports):

```ts
import { … } from '@vibesboard/adapter-s3'
```

The six files and their current import lines (for reference — confirm with grep before editing):
- `apps/web/app/api/agents/[id]/files/upload-url/route.ts:3` — `import { getSignedUploadUrl } from '@vibesboard/adapter-firebase/storage'`
- `apps/web/app/api/agents/[id]/files/delete/route.ts:3` — `import { deleteFile } from '@vibesboard/adapter-firebase/storage'`
- `apps/web/app/api/agents/[id]/files/download-url/route.ts:3` — `import { getSignedDownloadUrl } from '@vibesboard/adapter-firebase/storage'`
- `apps/web/app/api/files/upload-url/route.ts:3` — `import { getSignedUploadUrl } from '@vibesboard/adapter-firebase/storage'`
- `apps/web/app/api/agents/[id]/route.ts:9` — `import { deleteFile } from '@vibesboard/adapter-firebase/storage'`
- `packages/ai/src/file-search.ts:6` — `import { downloadFile } from '@vibesboard/adapter-firebase/storage'`

- [ ] **Step 5.2:** Verify with grep that ZERO references to the old path remain:

Run: `grep -rEn "@vibesboard/adapter-firebase/storage" apps/ packages/`
Expected: NO output (zero matches outside of the now-stale `storage.ts` file itself, which we delete next).

- [ ] **Step 5.3:** Add `@vibesboard/adapter-s3` as a dependency wherever it's now imported. Modify `apps/web/package.json` (add `"@vibesboard/adapter-s3": "workspace:*"` to dependencies) and `packages/ai/package.json` (same).

- [ ] **Step 5.4:** Delete `packages/adapter-firebase/src/storage.ts`

Run: `rm packages/adapter-firebase/src/storage.ts`

- [ ] **Step 5.5:** Remove `./storage` from `packages/adapter-firebase/package.json` exports

Open `packages/adapter-firebase/package.json` and remove the line:

```json
    "./storage": "./src/storage.ts",
```

So the `exports` block goes from:

```json
  "exports": {
    ".": "./src/index.ts",
    "./admin": "./src/admin.ts",
    "./client": "./src/client.ts",
    "./storage": "./src/storage.ts"
  },
```

to:

```json
  "exports": {
    ".": "./src/index.ts",
    "./admin": "./src/admin.ts",
    "./client": "./src/client.ts"
  },
```

- [ ] **Step 5.6:** Reinstall to pick up new workspace deps

Run: `pnpm install`
Expected: completes; `@vibesboard/adapter-s3` shows up in `apps/web/node_modules/@vibesboard/`.

- [ ] **Step 5.7:** Type-check + lint

Run: `pnpm type-check`
Expected: passes — no callsite is broken.

Run: `pnpm lint`
Expected: passes (or only pre-existing warnings; don't introduce new ones).

- [ ] **Step 5.8:** Commit

```bash
git add apps/web/app/api/agents/\[id\]/files/upload-url/route.ts \
        apps/web/app/api/agents/\[id\]/files/delete/route.ts \
        apps/web/app/api/agents/\[id\]/files/download-url/route.ts \
        apps/web/app/api/files/upload-url/route.ts \
        apps/web/app/api/agents/\[id\]/route.ts \
        packages/ai/src/file-search.ts \
        apps/web/package.json packages/ai/package.json \
        packages/adapter-firebase/package.json \
        pnpm-lock.yaml
git rm packages/adapter-firebase/src/storage.ts
git commit -m "refactor(storage): swap 6 callsites to adapter-s3; delete adapter-firebase/storage.ts"
```

---

### Task 6: Final verification + README update

**Files:**
- Modify: `README.md` (root)

- [ ] **Step 6.1:** Modify the existing "Self-host quickstart" section in `README.md`. After the existing `pnpm db:setup` line, add a one-line note mentioning MinIO. The block should end up something like:

```md
\`\`\`bash
cp .env.example .env       # already done if you run the full app locally
pnpm install
pnpm db:setup              # docker compose up Postgres + MinIO + migrate + seed
pnpm db:studio             # browse the schema at https://local.drizzle.studio
pnpm minio:console         # browse the S3 bucket at http://localhost:9001
\`\`\`
```

Don't escape the backticks — those are literal markdown fences in the README.

- [ ] **Step 6.2:** Full success-criteria sweep

Run each and capture pass/fail:

```bash
# Criterion 1: fresh setup
pnpm db:reset && pnpm db:setup
# Expected: Postgres + MinIO healthy; vibesboard-files bucket created; [seed] Done.

# Criterion 2: adapter-s3 smoke test
pnpm --filter @vibesboard/adapter-s3 test
# Expected: 1 test passes.

# Criterion 3: adapter-postgres tests still pass
pnpm --filter @vibesboard/adapter-postgres test
# Expected: 23/23.

# Criterion 4: type-check + lint + format:check
pnpm type-check && pnpm lint && pnpm format:check
# Expected: all pass.

# Criterion 5: web build still works
pnpm --filter @vibesboard/web build
# Expected: builds successfully.

# Criterion 6: zero remaining references to the old import path
grep -rEn "@vibesboard/adapter-firebase/storage|GCS_BUCKET_NAME" apps/ packages/
# Expected: no matches.

# Criterion 7: confirm the old file is gone
ls packages/adapter-firebase/src/storage.ts 2>&1
# Expected: "No such file or directory" or equivalent.
```

If any check fails, diagnose: is it caused by sub-project #3 changes or was it pre-existing? Pre-existing → DONE_WITH_CONCERNS. Sub-project #3 → fix in the relevant earlier task.

- [ ] **Step 6.3:** Commit README

```bash
git add README.md
git commit -m "docs(self-host): MinIO + S3 in quickstart"
```

---

## Final note

After Task 6, sub-project #3 is mergeable to `dev`. Old GCS-stored files in production are NOT migrated — that's a separate effort coordinated with sub-project #6's deployment story. Until then, sub-project #3 only runs on dev/staging environments.
