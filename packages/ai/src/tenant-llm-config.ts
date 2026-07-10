import 'server-only'
import { eq, and, or, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { getDb } from '@vibesboard/adapter-postgres/client'
import { tenantLlmConfigs } from '@vibesboard/adapter-postgres/schema'
import type { LlmProviderKind, ProviderModelSpec } from '@vibesboard/contracts'
import { credStore, type CredStore } from './cred-store/index.ts'

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
  const rows = await getDb()
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
  const rows = await getDb()
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
  const [row] = await getDb().transaction(async (tx) => {
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

  const [row] = await getDb().transaction(async (tx) => {
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
  const rows = await getDb()
    .delete(tenantLlmConfigs)
    .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
    .returning({ id: tenantLlmConfigs.id, token: tenantLlmConfigs.apiKeyEncrypted })

  if (rows[0]?.token) {
    await store.revoke(rows[0].token).catch(() => {})
  }
  return rows.length > 0
}

/**
 * Resolve a ProviderModelSpec for a tenant, trying agent config first then
 * tenant default — in a single DB query.
 * Returns null if no enabled config is found (caller falls back to platform model).
 */
export async function resolveProviderSpec(
  tenantId: string,
  llmConfigId?: string | null,
  store: CredStore = credStore,
): Promise<ProviderModelSpec | null> {
  const row = await getDb()
    .select()
    .from(tenantLlmConfigs)
    .where(
      and(
        eq(tenantLlmConfigs.tenantId, tenantId),
        eq(tenantLlmConfigs.isEnabled, true),
        llmConfigId
          ? or(eq(tenantLlmConfigs.id, llmConfigId), eq(tenantLlmConfigs.isDefault, true))
          : eq(tenantLlmConfigs.isDefault, true),
      ),
    )
    // Specific config (id match) ranks above the tenant default.
    .orderBy(
      llmConfigId
        ? sql`CASE WHEN ${tenantLlmConfigs.id} = ${llmConfigId} THEN 0 ELSE 1 END`
        : tenantLlmConfigs.createdAt,
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row?.apiKeyEncrypted) return null

  const apiKey = await store.unseal(row.apiKeyEncrypted)

  if (row.kind === 'anthropic') {
    return { kind: 'anthropic', modelId: row.modelId, apiKey }
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
