import 'server-only'
import { eq, and, or, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { tenantLlmConfigs, tenantLlmTaskConfigs, tenants } from '@vibesboard/adapter-postgres/schema'
import type { LlmProviderKind, LlmTask, ProviderModelSpec } from '@vibesboard/contracts'
import { credStore, type CredStore } from './cred-store/index.ts'
import {
  createEmbedding,
  PLATFORM_EMBEDDING_DIMENSIONS,
  PLATFORM_EMBEDDING_MODEL
} from '@vibesboard/adapter-openai'
import { shouldResolveTenantProvider } from './provider-routing.ts'
import { NVIDIA_API_BASE_URL } from './provider-endpoints.ts'

export type EmbedFn = (texts: string[]) => Promise<number[][]>

// ─── Types ───────────────────────────────────────────────────────────

export interface LlmConfigInput {
  label: string
  kind: LlmProviderKind
  modelId: string
  apiKey: string
  baseUrl?: string
  isDefault?: boolean
}

export interface LlmConfigView {
  id: string
  tenantId: string
  label: string
  kind: LlmProviderKind
  modelId: string
  baseUrl: string | null
  isEnabled: boolean
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

// ─── Service ─────────────────────────────────────────────────────────

export async function listLlmConfigs(
  tenantId: string,
  store: CredStore = credStore,
): Promise<LlmConfigView[]> {
  const rows = await getMigrateDb()
    .select()
    .from(tenantLlmConfigs)
    .where(eq(tenantLlmConfigs.tenantId, tenantId))
    .orderBy(tenantLlmConfigs.createdAt)
  return rows.map(toView)
}

export async function getLlmConfig(
  id: string,
  tenantId: string,
): Promise<LlmConfigView | null> {
  const rows = await getMigrateDb()
    .select()
    .from(tenantLlmConfigs)
    .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
    .limit(1)
  return rows[0] ? toView(rows[0]) : null
}

export async function createLlmConfig(
  tenantId: string,
  input: LlmConfigInput,
  store: CredStore = credStore,
): Promise<LlmConfigView> {
  const id = uuidv7()
  const sealedKey = await store.seal(input.apiKey)

  // Single transaction: clear old default + insert new row atomically.
  const [row] = await getMigrateDb().transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(tenantLlmConfigs)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(tenantLlmConfigs.tenantId, tenantId),
            eq(tenantLlmConfigs.isDefault, true),
          ),
        )
    }
    return tx
      .insert(tenantLlmConfigs)
      .values({
        id,
        tenantId,
        label: input.label,
        kind: input.kind,
        modelId: input.modelId,
        baseUrl: input.baseUrl ?? null,
        apiKeyEncrypted: sealedKey,
        isEnabled: true,
        isDefault: input.isDefault ?? false,
      })
      .returning()
  })

  return toView(row)
}

export async function updateLlmConfig(
  id: string,
  tenantId: string,
  input: Partial<LlmConfigInput> & { isEnabled?: boolean },
  store: CredStore = credStore,
): Promise<LlmConfigView | null> {
  const sealedKey = input.apiKey != null ? await store.seal(input.apiKey) : undefined

  const [row] = await getMigrateDb().transaction(async (tx) => {
    // Verify the row belongs to this tenant before touching the default flag.
    const existing = await tx
      .select({ id: tenantLlmConfigs.id, kind: tenantLlmConfigs.kind })
      .from(tenantLlmConfigs)
      .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
      .limit(1)
    if (!existing[0]) return []

    // Switching kind without an explicit baseUrl resets it — otherwise a stale
    // custom URL (e.g. an old Ollama endpoint) survives the switch and
    // openai/nvidia specs would silently route to the wrong host.
    const kindChanged = input.kind !== undefined && input.kind !== existing[0].kind

    if (input.isDefault) {
      await tx
        .update(tenantLlmConfigs)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(tenantLlmConfigs.tenantId, tenantId),
            eq(tenantLlmConfigs.isDefault, true),
          ),
        )
    }

    return tx
      .update(tenantLlmConfigs)
      .set({
        updatedAt: new Date(),
        ...(input.label !== undefined && { label: input.label }),
        ...(input.kind !== undefined && { kind: input.kind }),
        ...(input.modelId !== undefined && { modelId: input.modelId }),
        ...(input.baseUrl !== undefined
          ? { baseUrl: input.baseUrl }
          : kindChanged
            ? { baseUrl: null }
            : {}),
        ...(sealedKey !== undefined && { apiKeyEncrypted: sealedKey }),
        ...(input.isEnabled !== undefined && { isEnabled: input.isEnabled }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      })
      .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
      .returning()
  })

  return row ? toView(row) : null
}

export async function deleteLlmConfig(
  id: string,
  tenantId: string,
  store: CredStore = credStore,
): Promise<boolean> {
  const rows = await getMigrateDb()
    .delete(tenantLlmConfigs)
    .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
    .returning({ id: tenantLlmConfigs.id, token: tenantLlmConfigs.apiKeyEncrypted })

  if (rows[0]?.token) {
    await store.revoke(rows[0].token).catch(() => {})
  }
  return rows.length > 0
}

// ─── Per-task routing ────────────────────────────────────────────────────────

export interface TaskAssignment {
  task: LlmTask
  configId: string
  config: LlmConfigView
}

/** List all task→config assignments for a tenant. */
export async function listTaskAssignments(tenantId: string): Promise<TaskAssignment[]> {
  const db = getMigrateDb()
  const rows = await db
    .select({
      task: tenantLlmTaskConfigs.task,
      configId: tenantLlmTaskConfigs.configId,
    })
    .from(tenantLlmTaskConfigs)
    .where(eq(tenantLlmTaskConfigs.tenantId, tenantId))

  const configs = await db
    .select()
    .from(tenantLlmConfigs)
    .where(eq(tenantLlmConfigs.tenantId, tenantId))

  return rows.map(r => {
    const cfg = configs.find(c => c.id === r.configId)
    return { task: r.task, configId: r.configId, config: cfg ? toView(cfg) : { id: r.configId } as LlmConfigView }
  })
}

/** Assign (or update) a specific configId to a task. Upserts by (tenantId, task). */
export async function setTaskAssignment(
  tenantId: string,
  task: LlmTask,
  configId: string,
): Promise<void> {
  await getMigrateDb()
    .insert(tenantLlmTaskConfigs)
    .values({ tenantId, task, configId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [tenantLlmTaskConfigs.tenantId, tenantLlmTaskConfigs.task],
      set: { configId, updatedAt: new Date() },
    })
}

/** Remove a task assignment (falls back to default resolution). */
export async function clearTaskAssignment(tenantId: string, task: LlmTask): Promise<void> {
  await getMigrateDb()
    .delete(tenantLlmTaskConfigs)
    .where(and(
      eq(tenantLlmTaskConfigs.tenantId, tenantId),
      eq(tenantLlmTaskConfigs.task, task),
    ))
}

/**
 * Look up the configId assigned to a task. Resolution order:
 *   1. Exact task match (e.g. 'chat')
 *   2. Wildcard '*'
 *   3. null (caller falls through to isDefault / platform)
 */
async function resolveTaskConfigId(tenantId: string, task: LlmTask): Promise<string | null> {
  if (task === '*') return null
  const rows = await getMigrateDb()
    .select({ task: tenantLlmTaskConfigs.task, configId: tenantLlmTaskConfigs.configId })
    .from(tenantLlmTaskConfigs)
    .where(
      and(
        eq(tenantLlmTaskConfigs.tenantId, tenantId),
        or(eq(tenantLlmTaskConfigs.task, task), eq(tenantLlmTaskConfigs.task, '*')),
      ),
    )
  // Prefer exact task match over wildcard
  return (
    rows.find(r => r.task === task)?.configId ??
    rows.find(r => r.task === '*')?.configId ??
    null
  )
}

// ─── Provider spec resolution ────────────────────────────────────────────────

/**
 * Resolve a ProviderModelSpec for a tenant.
 *
 * Resolution order:
 *   1. Per-agent llmConfigId (explicit override)
 *   2. Per-task assignment (task='chat'/'embed'/etc.)
 *   3. Wildcard task assignment ('*')
 *   4. Tenant default (isDefault=true)
 *   5. null → caller falls back to platform model
 */
export async function resolveTenantNetworkOpts(
  tenantId: string,
): Promise<{ allowPrivateHosts: boolean; hostAllowlist: string[] }> {
  const row = await getMigrateDb()
    .select({ llmAllowPrivateHosts: tenants.llmAllowPrivateHosts, llmHostAllowlist: tenants.llmHostAllowlist })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
    .then(rows => rows[0] ?? null)
    .catch(() => null)
  return {
    allowPrivateHosts: row?.llmAllowPrivateHosts ?? false,
    hostAllowlist: (row?.llmHostAllowlist as string[] | null) ?? [],
  }
}

export async function resolveProviderSpec(
  tenantId: string,
  llmConfigId?: string | null,
  store: CredStore = credStore,
  task?: LlmTask,
): Promise<ProviderModelSpec | null> {
  // Step 1: per-agent explicit override
  // Step 2+3: task-based assignment (if no explicit llmConfigId)
  const taskConfigId = !llmConfigId && task ? await resolveTaskConfigId(tenantId, task) : null
  const effectiveConfigId = llmConfigId ?? taskConfigId

  const row = await getMigrateDb()
    .select()
    .from(tenantLlmConfigs)
    .where(
      and(
        eq(tenantLlmConfigs.tenantId, tenantId),
        eq(tenantLlmConfigs.isEnabled, true),
        effectiveConfigId
          ? or(eq(tenantLlmConfigs.id, effectiveConfigId), eq(tenantLlmConfigs.isDefault, true))
          : eq(tenantLlmConfigs.isDefault, true),
      ),
    )
    // Specific config (id match) ranks above the tenant default.
    .orderBy(
      effectiveConfigId
        ? sql`CASE WHEN ${tenantLlmConfigs.id} = ${effectiveConfigId} THEN 0 ELSE 1 END`
        : tenantLlmConfigs.createdAt,
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row?.apiKeyEncrypted) return null

  const apiKey = await store.unseal(row.apiKeyEncrypted)
  return rowToProviderSpec(row, apiKey)
}

/** Map a stored config row + decrypted key to its runtime provider spec. */
function rowToProviderSpec(
  row: typeof tenantLlmConfigs.$inferSelect,
  apiKey: string,
): ProviderModelSpec | null {
  if (row.kind === 'anthropic') {
    return { kind: 'anthropic', modelId: row.modelId, apiKey }
  }
  if (row.kind === 'google') {
    return { kind: 'google', modelId: row.modelId, apiKey }
  }
  if (row.kind === 'openai_compatible') {
    if (!row.baseUrl) {
      console.error(`[tenant-llm-config] openai_compatible config ${row.id} has no baseUrl — skipping`)
      return null
    }
    return { kind: 'openai_compatible', modelId: row.modelId, apiKey, baseUrl: row.baseUrl }
  }
  if (row.kind === 'nvidia') {
    // baseUrl optional — the registry defaults to the hosted API catalog
    return { kind: 'nvidia', modelId: row.modelId, apiKey, baseUrl: row.baseUrl ?? undefined }
  }
  return { kind: 'openai', modelId: row.modelId, apiKey, baseUrl: row.baseUrl ?? undefined }
}

// ─── Tenant-aware embedder ────────────────────────────────────────────
// Returns an embed function that uses the tenant's configured provider.
// Falls back to the platform OPENAI_API_KEY when no tenant config exists.
//
// Provider embedding support:
//   openai            → OpenAI Embeddings API (text-embedding-3-small, pinned)
//                       with tenant key
//   openai_compatible → Same endpoint with tenant key + custom baseUrl
//   google            → Google Generative AI Embeddings (text-embedding-004)
//   anthropic         → No embedding API — falls back to platform key
//   nvidia            → NVIDIA catalog /embeddings with the config's own modelId.
//                       NIM-branded models (nvidia/ prefix) also need the
//                       non-standard `input_type` param; third-party ones
//                       (baai/, snowflake/) reject it. Dimensions route per
//                       providerFromDimension — 1024 and 2048 both have tables.

// Two distinct things that used to share one constant:
//   PLATFORM_EMBEDDING_MODEL — our key, whatever provider it points at. Follows
//     OPENAI_EMBEDDINGS_MODEL, so it can be a Gemini model name.
//   TENANT_OPENAI_EMBEDDING_MODEL — a tenant's own `openai` key, which by
//     definition talks to real OpenAI. Pinned, so pointing the platform at a
//     gateway cannot leak a Gemini model name into a tenant's OpenAI account
//     (it would 404 there). Same value this resolved to before, since
//     OPENAI_EMBEDDINGS_MODEL was unset in every deployment.
const TENANT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'

/** Args for embedding with the platform key — model plus optional width. */
const platformEmbeddingParams = () => ({
  model: PLATFORM_EMBEDDING_MODEL,
  ...(PLATFORM_EMBEDDING_DIMENSIONS
    ? { dimensions: PLATFORM_EMBEDDING_DIMENSIONS }
    : {})
})
const GOOGLE_EMBEDDING_MODEL = process.env.GOOGLE_EMBEDDING_MODEL ?? 'text-embedding-004'
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// Try embedding models in order until one works — API key availability varies
const GOOGLE_EMBEDDING_FALLBACK_CHAIN = [
  'text-embedding-004',
  'embedding-001',
]

async function googleEmbedSingle(text: string, model: string, apiKey: string): Promise<number[]> {
  const res = await fetch(
    `${GOOGLE_API_BASE}/models/${model}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    },
  )
  if (!res.ok) {
    const err = await res.text()
    throw Object.assign(new Error(`Google embedding error (${res.status}): ${err}`), { status: res.status })
  }
  const data = await res.json() as { embedding: { values: number[] } }
  return data.embedding.values
}

async function googleEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  // Find the first model that works with this key
  let workingModel: string | null = null
  for (const model of GOOGLE_EMBEDDING_FALLBACK_CHAIN) {
    try {
      await googleEmbedSingle(texts[0], model, apiKey)
      workingModel = model
      break
    } catch {
      continue
    }
  }
  if (!workingModel) {
    throw new Error(
      'Google embedding models (text-embedding-004, embedding-001) are not available for this API key. ' +
      'Use an OpenAI or OpenAI-compatible provider for file indexing, or set GOOGLE_EMBEDDING_MODEL env var.'
    )
  }
  // Embed all texts with the working model
  return Promise.all(texts.map(t => googleEmbedSingle(t, workingModel!, apiKey)))
}

/**
 * NVIDIA NIM embedding models are asymmetric: a document and a search query for
 * that document are embedded differently, selected by the `input_type` param.
 * Indexing must send 'passage' and retrieval must send 'query' — sending
 * 'passage' for a query still returns a vector, so the failure is silent and
 * shows up only as degraded recall. Callers that embed a query must say so.
 */
export type EmbedInputType = 'query' | 'passage'

export async function resolveEmbedder(
  tenantId: string,
  store: CredStore = credStore,
  inputType: EmbedInputType = 'passage',
): Promise<EmbedFn> {
  const [spec, tenantRow] = await Promise.all([
    shouldResolveTenantProvider({ tenantId })
      ? resolveProviderSpec(tenantId, null, store, 'embed').catch(() => null)
      : Promise.resolve(null),
    getMigrateDb()
      .select({ llmAllowPrivateHosts: tenants.llmAllowPrivateHosts })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .then(rows => rows[0] ?? null)
      .catch(() => null),
  ])
  const allowPrivateHost = tenantRow?.llmAllowPrivateHosts ?? false

  if (!spec) {
    // No tenant config — use platform key
    return async (texts) => {
      const json = await createEmbedding({ ...platformEmbeddingParams(), input: texts })
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    }
  }

  if (spec.kind === 'google') {
    return async (texts) => {
      try {
        return await googleEmbed(texts, spec.apiKey)
      } catch (err: any) {
        // Google embedding models may not be available for all API keys.
        // Fall back to the platform OPENAI_API_KEY so RAG indexing still works.
        console.warn('[tenant-llm-config] Google embeddings unavailable, falling back to platform key:', err?.message)
        const json = await createEmbedding({ ...platformEmbeddingParams(), input: texts })
        return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
      }
    }
  }

  if (spec.kind === 'openai' || spec.kind === 'openai_compatible') {
    // openai → use OpenAI's standard embedding model (text-embedding-3-small)
    // openai_compatible → use the config's modelId so Ollama/Groq/etc. can
    //   serve their own embedding model (e.g. nomic-embed-text on Ollama,
    //   baai/bge-m3 or snowflake/arctic-embed on NVIDIA free tier)
    const embeddingModel = spec.kind === 'openai_compatible' ? spec.modelId : TENANT_OPENAI_EMBEDDING_MODEL
    // baseUrl is only applicable for openai and openai_compatible; undefined for others
    const baseUrl = (spec.kind === 'openai' || spec.kind === 'openai_compatible') ? spec.baseUrl : undefined
    // NVIDIA NIM-branded models (nvidia/ prefix) require input_type, and it must
    // match what is being embedded (see EmbedInputType). Third-party models on
    // the NVIDIA catalog (baai/, snowflake/, etc.) reject the param.
    const needsInputType =
      spec.kind === 'openai_compatible' &&
      embeddingModel.startsWith('nvidia/')
    return async (texts) => {
      const json = await createEmbedding({
        model: embeddingModel,
        input: texts,
        apiKey: spec.apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(allowPrivateHost ? { allowPrivateHost: true } : {}),
        ...(needsInputType ? { inputType } : {}),
      })
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    }
  }

  if (spec.kind === 'nvidia') {
    // NVIDIA's catalog serves an OpenAI-shaped /embeddings endpoint, so the
    // config's own modelId is used rather than silently falling back to the
    // platform OpenAI key (which produced 1536-dim vectors from a provider the
    // tenant never selected). NIM-branded models (nvidia/ prefix) additionally
    // require input_type, matching what is being embedded (see EmbedInputType);
    // third-party ones (baai/, snowflake/) reject it.
    return async (texts) => {
      const json = await createEmbedding({
        model: spec.modelId,
        input: texts,
        apiKey: spec.apiKey,
        baseUrl: spec.baseUrl ?? NVIDIA_API_BASE_URL,
        // baseUrl is now always set, so createEmbedding's private-address check
        // always runs — honor the tenant's opt-in the same way the
        // openai/openai_compatible branch does, or a self-hosted NIM is rejected.
        ...(allowPrivateHost ? { allowPrivateHost: true } : {}),
        ...(spec.modelId.startsWith('nvidia/') ? { inputType } : {}),
      })
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    }
  }

  // anthropic — no embedding API, fall back to platform key
  return async (texts) => {
    const json = await createEmbedding({ ...platformEmbeddingParams(), input: texts })
    return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
  }
}

// ─── Internal ────────────────────────────────────────────────────────

function toView(row: typeof tenantLlmConfigs.$inferSelect): LlmConfigView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    kind: row.kind as LlmProviderKind,
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    isEnabled: row.isEnabled,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
