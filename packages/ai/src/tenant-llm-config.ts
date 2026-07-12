import 'server-only'
import { eq, and, or, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { tenantLlmConfigs, tenantLlmTaskConfigs } from '@vibesboard/adapter-postgres/schema'
import type { LlmProviderKind, LlmTask, ProviderModelSpec } from '@vibesboard/contracts'
import { credStore, type CredStore } from './cred-store/index.ts'
import { createEmbedding } from '@vibesboard/adapter-openai'

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
      .select({ id: tenantLlmConfigs.id })
      .from(tenantLlmConfigs)
      .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
      .limit(1)
    if (!existing[0]) return []

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
        ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
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
  return { kind: 'openai', modelId: row.modelId, apiKey, baseUrl: row.baseUrl ?? undefined }
}

// ─── Tenant-aware embedder ────────────────────────────────────────────
// Returns an embed function that uses the tenant's configured provider.
// Falls back to the platform OPENAI_API_KEY when no tenant config exists.
//
// Provider embedding support:
//   openai            → OpenAI Embeddings API (text-embedding-3-small) with tenant key
//   openai_compatible → Same endpoint with tenant key + custom baseUrl
//   google            → Google Generative AI Embeddings (text-embedding-004)
//   anthropic         → No embedding API — falls back to platform key

const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small'
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

export async function resolveEmbedder(
  tenantId: string,
  store: CredStore = credStore,
): Promise<EmbedFn> {
  const spec = await resolveProviderSpec(tenantId, null, store, 'embed').catch(() => null)

  if (!spec) {
    // No tenant config — use platform key
    return async (texts) => {
      const json = await createEmbedding({ model: OPENAI_EMBEDDING_MODEL, input: texts })
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
        const json = await createEmbedding({ model: OPENAI_EMBEDDING_MODEL, input: texts })
        return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
      }
    }
  }

  if (spec.kind === 'openai' || spec.kind === 'openai_compatible') {
    const baseUrl = spec.kind === 'openai_compatible' ? spec.baseUrl : spec.baseUrl
    return async (texts) => {
      const json = await createEmbedding({
        model: OPENAI_EMBEDDING_MODEL,
        input: texts,
        apiKey: spec.apiKey,
        ...(baseUrl ? { baseUrl } : {}),
      })
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    }
  }

  // anthropic — no embedding API, fall back to platform key
  return async (texts) => {
    const json = await createEmbedding({ model: OPENAI_EMBEDDING_MODEL, input: texts })
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
