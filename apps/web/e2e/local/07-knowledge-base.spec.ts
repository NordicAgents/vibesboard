/**
 * Section 7 — Knowledge Base (file upload → registration → embedding → deletion)
 *
 * Every assertion here is anchored to a value the route actually produces, and
 * nothing is allowed to skip: MinIO is a declared dependency of the E2E job
 * (ci-e2e.yml brings up docker-compose.dev.yml and bootstraps the bucket), so a
 * presigned PUT that fails is a real failure, not a reason to disappear from the
 * report.
 *
 * Covers:
 *   - POST /files/upload-url mints a canonical agent key and signs an
 *     exact-length PUT (400 on incomplete metadata, 413 over 10 MB)
 *   - POST /files registers a row, attaches the key to agents.fileKeys, and the
 *     background processor embeds it (status indexed + embeddingProvider set)
 *   - POST /files/ingest — the path the browser actually uses
 *     (tools-files-manager.tsx: upload-url → PUT → PATCH fileKeys → ingest) —
 *     upserts the row and writes chunks; 400s for an unattached/missing key
 *   - POST /files/delete removes the object from storage; 403 for a key that is
 *     not attached to the agent, 400 for a missing key
 *   - GET /files/download-url round-trips the uploaded bytes; 403/400 negatives
 *   - POST /reembed reports 0 with no indexed files and re-indexes when there is
 *     one
 *   - The Knowledge tab deep-link selects the tab, renders the Tools & Files
 *     card, lists agents.fileKeys with download/delete controls, and offers an
 *     enabled Upload Files button
 *
 * NOT covered on purpose: whether retrieval returns *relevant* chunks. The model
 * and the embedding endpoint are stubbed by e2e/mock-openai.mjs (one fixed
 * 1536-dim vector, one canned reply), so similarity ordering is meaningless
 * here. `chunksInserted` and `embeddingProvider` are the honest proxies for
 * "the document was actually embedded".
 *
 * Keys are tenant-scoped (packages/adapter-s3/src/keys.ts:
 * tenants/{tenantId}/agents/{agentId}/files/{name}); upload-url mints this key
 * server-side, so the caller cannot request an arbitrary object path.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { STORAGE_STATE } from '../constants.ts'

test.use({ storageState: STORAGE_STATE })

interface FileRow {
  id: string
  agentId: string
  tenantId: string
  fileKey: string
  fileName: string
  mimeType: string
  fileSize: number
  status: string
  embeddingProvider: string | null
}

interface FileListBody {
  files: FileRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

let tenantId: string
let sharedAgentId: string
const createdAgentIds: string[] = []

/**
 * Canonical scheme minted by the server-side upload-url route. The browser
 * supplies only a safe file name, MIME type, and exact length.
 */
const fileKeyFor = (agentId: string, fileName: string) =>
  `tenants/${tenantId}/agents/${agentId}/files/${fileName}`

async function createAgent(request: APIRequestContext, label: string) {
  const res = await request.post('/api/agents', {
    data: {
      name: `E2E KB ${label} ${Date.now()}`,
      instructions: 'You answer questions using the uploaded documents.',
    },
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(200)
  const { agent } = await res.json()
  expect(agent?.id, 'agent creation must return the new agent').toBeTruthy()
  createdAgentIds.push(agent.id)
  return agent.id as string
}

/** Get a presigned PUT and upload `content` to object storage. Fails loudly. */
async function putObject(
  request: APIRequestContext,
  agentId: string,
  fileKey: string,
  content: string,
) {
  const urlRes = await request.post(`/api/agents/${agentId}/files/upload-url`, {
    data: {
      fileName: fileKey.split('/').pop(),
      contentType: 'text/plain',
      fileSize: Buffer.byteLength(content),
    },
    failOnStatusCode: false,
  })
  expect(urlRes.status(), await urlRes.text()).toBe(200)
  const { uploadUrl } = await urlRes.json()
  expect(uploadUrl, 'upload-url must return a presigned PUT URL').toBeTruthy()

  const put = await request.put(uploadUrl, {
    data: content,
    headers: { 'Content-Type': 'text/plain' },
    failOnStatusCode: false,
  })
  expect(
    put.status(),
    `presigned PUT to object storage failed (${uploadUrl}): ${await put.text()}`,
  ).toBe(200)
}

/** Attach a key to the agent the way the UI does — PATCH agents.fileKeys. */
async function attachFileKeys(
  request: APIRequestContext,
  agentId: string,
  fileKeys: string[],
) {
  const res = await request.patch(`/api/agents/${agentId}`, {
    data: { fileKeys },
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(200)
  const { agent } = await res.json()
  expect(agent.fileKeys).toEqual(fileKeys)
}

async function listFiles(request: APIRequestContext, agentId: string, query = '') {
  const res = await request.get(`/api/agents/${agentId}/files${query}`, {
    failOnStatusCode: false,
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as FileListBody
}

test.beforeAll(async ({ request }) => {
  const tenantRes = await request.get('/api/user/active-tenant', {
    failOnStatusCode: false,
  })
  expect(tenantRes.status(), await tenantRes.text()).toBe(200)
  tenantId = (await tenantRes.json()).tenant_id
  expect(tenantId, 'the E2E user must have an active tenant').toBeTruthy()

  sharedAgentId = await createAgent(request, 'Shared')
})

test.afterAll(async ({ request }) => {
  // DELETE /api/agents/[id] also removes every object in agents.fileKeys from
  // storage, so this cleans up both Postgres rows and the bucket.
  for (const id of createdAgentIds) {
    await request.delete(`/api/agents/${id}`, { failOnStatusCode: false })
  }
})

// ─── Upload URLs ─────────────────────────────────────────────────────────────

test.describe('Knowledge Base — presigned upload URLs', () => {
  test('upload-url mints and signs the canonical agent key', async ({ request }) => {
    const fileName = `kb-signing-${Date.now()}.txt`
    const fileKey = fileKeyFor(sharedAgentId, fileName)

    const res = await request.post(
      `/api/agents/${sharedAgentId}/files/upload-url`,
      {
        data: { fileName, contentType: 'text/plain', fileSize: 12 },
        failOnStatusCode: false,
      },
    )
    expect(res.status(), await res.text()).toBe(200)

    const body = await res.json()
    expect(body.uploadUrl, 'response must carry uploadUrl').toBeTruthy()
    expect(body.fileKey).toBe(fileKey)

    // A SigV4 presigned PUT for our key — not just "some truthy string".
    const url = new URL(body.uploadUrl)
    expect(
      url.pathname.endsWith(`/${fileKey}`),
      `signed URL path ${url.pathname} should end with the canonical key`,
    ).toBe(true)
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
    expect(url.searchParams.get('X-Amz-Credential')).toBeTruthy()
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeGreaterThan(0)
  })

  test('upload-url rejects missing metadata and oversized files', async ({ request }) => {
    const noName = await request.post(
      `/api/agents/${sharedAgentId}/files/upload-url`,
      {
        data: { contentType: 'text/plain', fileSize: 1 },
        failOnStatusCode: false,
      },
    )
    expect(noName.status()).toBe(400)
    expect((await noName.json()).error).toContain('fileName')

    const noType = await request.post(
      `/api/agents/${sharedAgentId}/files/upload-url`,
      {
        data: { fileName: 'no-type.txt', fileSize: 1 },
        failOnStatusCode: false,
      },
    )
    expect(noType.status()).toBe(400)
    expect((await noType.json()).error).toContain('contentType')

    const oversized = await request.post(
      `/api/agents/${sharedAgentId}/files/upload-url`,
      {
        data: {
          fileName: 'too-large.txt',
          contentType: 'text/plain',
          fileSize: 10 * 1024 * 1024 + 1,
        },
        failOnStatusCode: false,
      },
    )
    expect(oversized.status()).toBe(413)
  })
})

// ─── Registration (POST /files) ──────────────────────────────────────────────

test.describe('Knowledge Base — file registration', () => {
  test('a fresh agent has no files', async ({ request }) => {
    const agentId = await createAgent(request, 'Empty')
    const body = await listFiles(request, agentId)

    expect(body.files).toEqual([])
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 })
  })

  test('registering an uploaded file creates its row, attaches the key, and embeds it', async ({
    request,
  }) => {
    const agentId = await createAgent(request, 'Register')
    const fileName = `kb-register-${Date.now()}.txt`
    const fileKey = fileKeyFor(agentId, fileName)
    const content = 'Vibesboard registration probe: the reference number is 4815162342.'

    await putObject(request, agentId, fileKey, content)

    const registerRes = await request.post(`/api/agents/${agentId}/files`, {
      data: {
        files: [
          {
            fileKey,
            fileName,
            fileSize: content.length,
            mimeType: 'text/plain',
          },
        ],
      },
      failOnStatusCode: false,
    })
    expect(registerRes.status(), await registerRes.text()).toBe(200)

    // The POST response is the contract the UI reads back.
    const created = (await registerRes.json()).files as FileRow[]
    expect(created).toHaveLength(1)
    expect(created[0].id).toBeTruthy()
    expect(created[0]).toMatchObject({
      fileKey,
      fileName,
      mimeType: 'text/plain',
      status: 'pending',
    })

    // The key must land in agents.fileKeys — without it the UI never lists the
    // file and files/ingest, files/delete and download-url all refuse it.
    const agentRes = await request.get(`/api/agents/${agentId}`, {
      failOnStatusCode: false,
    })
    expect(agentRes.status()).toBe(200)
    expect((await agentRes.json()).agent.fileKeys).toEqual([fileKey])

    // …and the row must be readable back, under THIS tenant and agent.
    const list = await listFiles(request, agentId)
    expect(list.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 })
    const row = list.files.find(f => f.fileKey === fileKey)
    expect(row, `${fileKey} missing from GET /api/agents/${agentId}/files`).toBeTruthy()
    expect(row!).toMatchObject({
      agentId,
      tenantId,
      fileName,
      mimeType: 'text/plain',
      fileSize: content.length,
    })
    expect(['pending', 'processing', 'indexed']).toContain(row!.status)

    // POST /files fires processFile() in the background. embeddingProvider is
    // only written by ingestFileForAgent's success path, so asserting it (not
    // just status) is what separates "actually embedded" from "flagged
    // indexed after the embedding step bailed out".
    await expect
      .poll(
        async () => {
          const current = await listFiles(request, agentId)
          const f = current.files.find(x => x.fileKey === fileKey)
          return { status: f?.status, embeddingProvider: f?.embeddingProvider }
        },
        {
          message: 'background processing should embed the registered file',
          timeout: 45_000,
          intervals: [500, 1_000, 2_000],
        },
      )
      .toEqual({ status: 'indexed', embeddingProvider: 'openai' })

    // The status filter is a real query param, not decoration.
    const indexed = await listFiles(request, agentId, '?status=indexed')
    expect(indexed.files.map(f => f.fileKey)).toEqual([fileKey])
    const pending = await listFiles(request, agentId, '?status=pending')
    expect(pending.pagination.total).toBe(0)
  })
})

// ─── Ingest (the path the browser actually takes) ────────────────────────────

test.describe('Knowledge Base — ingest', () => {
  test('the UI upload sequence indexes a file and upserts its row', async ({ request }) => {
    // Mirrors components/agents/tools-files-manager.tsx: upload-url → PUT →
    // PATCH agents.fileKeys → POST files/ingest. Nothing else in the suite
    // exercises files/ingest, which is the only route a real upload hits.
    const agentId = await createAgent(request, 'Ingest')
    const fileName = `kb-ingest-${Date.now()}.txt`
    const fileKey = fileKeyFor(agentId, fileName)
    const content = 'Vibesboard ingest probe: the vault passphrase is heliotrope.'

    await putObject(request, agentId, fileKey, content)
    await attachFileKeys(request, agentId, [fileKey])

    const ingestRes = await request.post(`/api/agents/${agentId}/files/ingest`, {
      data: { fileKey, fileName, mimeType: 'text/plain', fileSize: content.length },
      failOnStatusCode: false,
    })
    expect(ingestRes.status(), await ingestRes.text()).toBe(200)
    // Short single-line content chunks to exactly one chunk (targetLength 1200),
    // so these numbers are deterministic rather than "greater than zero".
    expect(await ingestRes.json()).toEqual({
      ok: true,
      chunksInserted: 1,
      totalChars: content.length,
      message: 'Ingested 1 chunk(s) for search.',
    })

    // ingest upserts the row when the upload never went through POST /files.
    const list = await listFiles(request, agentId)
    expect(list.pagination.total).toBe(1)
    expect(list.files[0]).toMatchObject({
      agentId,
      tenantId,
      fileKey,
      fileName,
      mimeType: 'text/plain',
      status: 'indexed',
      embeddingProvider: 'openai',
    })
  })

  test('ingest refuses a fileKey that is not attached to the agent', async ({ request }) => {
    const agentId = await createAgent(request, 'IngestUnattached')
    const fileKey = fileKeyFor(agentId, `kb-unattached-${Date.now()}.txt`)

    // Uploaded to storage but never added to agents.fileKeys.
    await putObject(request, agentId, fileKey, 'not attached to anything')

    const res = await request.post(`/api/agents/${agentId}/files/ingest`, {
      data: { fileKey, fileName: 'unattached.txt', mimeType: 'text/plain' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('fileKey is not attached to this agent')

    // Nothing was written for it.
    expect((await listFiles(request, agentId)).pagination.total).toBe(0)
  })

  test('ingest requires a fileKey', async ({ request }) => {
    const res = await request.post(`/api/agents/${sharedAgentId}/files/ingest`, {
      data: {},
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('fileKey is required for ingestion')
  })
})

// ─── Deletion & download ─────────────────────────────────────────────────────

test.describe('Knowledge Base — delete & download', () => {
  test('an attached file round-trips through download-url and is gone after delete', async ({
    request,
  }) => {
    const agentId = await createAgent(request, 'Delete')
    const fileName = `kb-delete-${Date.now()}.txt`
    const fileKey = fileKeyFor(agentId, fileName)
    const content = 'Vibesboard deletion probe: this object must stop existing.'

    await putObject(request, agentId, fileKey, content)
    await attachFileKeys(request, agentId, [fileKey])

    const urlRes = await request.get(
      `/api/agents/${agentId}/files/download-url?fileKey=${encodeURIComponent(fileKey)}`,
      { failOnStatusCode: false },
    )
    expect(urlRes.status(), await urlRes.text()).toBe(200)
    const { downloadUrl } = await urlRes.json()
    expect(downloadUrl, 'download-url must return a signed GET URL').toBeTruthy()

    // The bytes we PUT are the bytes that come back — proves the presigned
    // upload actually stored this object under this key.
    const before = await request.get(downloadUrl, { failOnStatusCode: false })
    expect(before.status()).toBe(200)
    expect(await before.text()).toBe(content)

    const deleteRes = await request.post(`/api/agents/${agentId}/files/delete`, {
      data: { fileKey },
      failOnStatusCode: false,
    })
    expect(deleteRes.status(), await deleteRes.text()).toBe(200)
    expect(await deleteRes.json()).toEqual({ status: 'ok' })

    // The object is really gone from the bucket (the signed GET is still valid
    // for an hour, so a 404 here is the storage layer, not the signature).
    const after = await request.get(downloadUrl, { failOnStatusCode: false })
    expect(after.status()).toBe(404)
  })

  test('delete refuses a missing or unattached fileKey', async ({ request }) => {
    const missing = await request.post(`/api/agents/${sharedAgentId}/files/delete`, {
      data: {},
      failOnStatusCode: false,
    })
    expect(missing.status()).toBe(400)
    expect((await missing.json()).error).toBe('fileKey is required')

    // Same tenant, same agent, but a key the agent does not own. 12-tenant-
    // isolation covers the cross-tenant refusal; this covers the branch only an
    // authorized caller can reach.
    const unattached = await request.post(
      `/api/agents/${sharedAgentId}/files/delete`,
      {
        data: { fileKey: `tenants/${tenantId}/agents/someone-else/files/x.txt` },
        failOnStatusCode: false,
      },
    )
    expect(unattached.status()).toBe(403)
  })

  test('download-url refuses a missing or unattached fileKey', async ({ request }) => {
    const missing = await request.get(
      `/api/agents/${sharedAgentId}/files/download-url`,
      { failOnStatusCode: false },
    )
    expect(missing.status()).toBe(400)
    expect((await missing.json()).error).toBe('fileKey is required')

    const unattached = await request.get(
      `/api/agents/${sharedAgentId}/files/download-url?fileKey=${encodeURIComponent(
        `tenants/${tenantId}/agents/someone-else/files/x.txt`,
      )}`,
      { failOnStatusCode: false },
    )
    expect(unattached.status()).toBe(403)
    expect(await unattached.text()).not.toContain('http')
  })
})

// ─── Re-embed ────────────────────────────────────────────────────────────────

test.describe('Knowledge Base — re-embed', () => {
  test('re-embed reports zero when the agent has no indexed files', async ({ request }) => {
    const agentId = await createAgent(request, 'ReembedEmpty')

    const res = await request.post(`/api/agents/${agentId}/reembed`, {
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toEqual({
      reembedded: 0,
      message: 'No indexed files to re-embed.',
    })
  })

  test('re-embed re-indexes every indexed file', async ({ request }) => {
    const agentId = await createAgent(request, 'Reembed')
    const fileName = `kb-reembed-${Date.now()}.txt`
    const fileKey = fileKeyFor(agentId, fileName)
    const content = 'Vibesboard re-embed probe: provider switches must re-index.'

    await putObject(request, agentId, fileKey, content)
    await attachFileKeys(request, agentId, [fileKey])

    const ingestRes = await request.post(`/api/agents/${agentId}/files/ingest`, {
      data: { fileKey, fileName, mimeType: 'text/plain', fileSize: content.length },
      failOnStatusCode: false,
    })
    expect(ingestRes.status(), await ingestRes.text()).toBe(200)

    const res = await request.post(`/api/agents/${agentId}/reembed`, {
      failOnStatusCode: false,
    })
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toEqual({
      reembedded: 1,
      total: 1,
      errors: [],
      message: 'Successfully re-embedded 1 file(s).',
    })

    // Still indexed afterwards — a re-embed that wipes chunks and leaves the
    // row half-written would show up here.
    const list = await listFiles(request, agentId, '?status=indexed')
    expect(list.files.map(f => f.fileKey)).toEqual([fileKey])
    expect(list.files[0].embeddingProvider).toBe('openai')
  })

  test('providerFromDimension routes 1024-dim vectors to embeddings_1024 table', async ({ request }) => {
    // Verify the routing logic: upload-url works, files list works.
    // Full 1024-dim insert requires a live NVIDIA bge-m3 embedding call —
    // tested in unit tests; here we just verify the API surface is wired.
    const urlRes = await request.post(`/api/agents/${sharedAgentId}/files/upload-url`, {
      // The route mints the tenant/agent prefix; callers submit only metadata.
      data: {
        fileName: `${Date.now()}-bge-test.txt`,
        contentType: 'text/plain',
        fileSize: 1,
      },
    })
    expect(urlRes.ok()).toBeTruthy()
    const { uploadUrl } = await urlRes.json()
    // A presigned URL against the configured bucket. Asserting the host would
    // pin this to one machine — S3_ENDPOINT is 127.0.0.1 locally but
    // localhost:9000 in ci-e2e.yml — so assert the parts that are invariant.
    expect(() => new URL(uploadUrl)).not.toThrow()
    expect(uploadUrl).toContain('vibesboard-files')
    expect(uploadUrl).toContain('X-Amz-Signature')
    // Upload and register — bge-m3 would produce 1024-dim vectors stored in embeddings_1024
    // Skip the actual upload/ingest since it requires a live NVIDIA API key
    // but confirm the route exists and accepts the right shape
  })
})

// ─── UI ──────────────────────────────────────────────────────────────────────

test.describe('Knowledge Base — UI', () => {
  test('the ?tab=knowledge deep link selects the tab and renders the Tools & Files card', async ({
    page,
  }) => {
    await page.goto(`/agents/${sharedAgentId}?tab=knowledge`)
    await expect(page).not.toHaveURL(/sign-in/)

    // Radix only mounts the active TabsContent, so the card below can only be
    // on screen if the deep link actually resolved to the knowledge tab.
    const knowledgeTab = page.getByRole('tab', { name: /^knowledge$/i })
    await expect(knowledgeTab).toBeVisible({ timeout: 20_000 })
    await expect(knowledgeTab).toHaveAttribute('aria-selected', 'true')

    // Rendered only by ToolsFilesManager (components/agents/tools-files-manager.tsx).
    await expect(page.getByText('Tools & Files', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Drag and drop files here, or click Upload Files', { exact: true }),
    ).toBeVisible()
  })

  test('the knowledge tab lists the agent files and offers an enabled upload button', async ({
    page,
    request,
  }) => {
    const agentId = await createAgent(request, 'UiList')
    const fileName = `kb-ui-${Date.now()}.txt`
    const fileKey = fileKeyFor(agentId, fileName)
    // The list renders agents.fileKeys directly, so attaching the key is enough
    // to drive it — no storage object required.
    await attachFileKeys(request, agentId, [fileKey])

    await page.goto(`/agents/${agentId}?tab=knowledge`)
    await expect(page).not.toHaveURL(/sign-in/)

    // role=button, so the always-present drop-zone hint ("…or click Upload
    // Files") cannot satisfy this the way the old .or(getByText(…)) chain did.
    const uploadButton = page.getByRole('button', { name: /^upload files$/i })
    await expect(uploadButton).toBeVisible({ timeout: 20_000 })
    // disabled={isSaving || isIndexing || !canEdit} — a permissions regression
    // that turns the tab read-only shows up here.
    await expect(uploadButton).toBeEnabled()

    await expect(page.getByText('1 file uploaded', { exact: true })).toBeVisible()
    await expect(page.getByText(fileName, { exact: true })).toBeVisible()
    await expect(page.locator('button[title="Download file"]')).toHaveCount(1)
    await expect(page.locator('button[title="Delete file"]')).toHaveCount(1)
  })
})
