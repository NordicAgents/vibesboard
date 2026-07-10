import 'server-only'
import CryptoJS from 'crypto-js'
import { eq, and } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { tenantLlmConfigs } from '@vibesboard/adapter-postgres/schema'
import type { LlmProviderKind, ProviderModelSpec } from '@vibesboard/contracts'

// ─── Encryption (same pattern as scheduling/channel packages) ───────

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not set')
  return key
}

function encryptApiKey(apiKey: string): string {
  return CryptoJS.AES.encrypt(apiKey, getEncryptionKey()).toString()
}

function decryptApiKey(encrypted: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, getEncryptionKey())
  return bytes.toString(CryptoJS.enc.Utf8)
}

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

export async function listLlmConfigs(tenantId: string): Promise<LlmConfigView[]> {
  const db = getMigrateDb()
  const rows = await db
    .select()
    .from(tenantLlmConfigs)
    .where(eq(tenantLlmConfigs.tenantId, tenantId))
    .orderBy(tenantLlmConfigs.createdAt)
  return rows.map(toView)
}

export async function getLlmConfig(id: string, tenantId: string): Promise<LlmConfigView | null> {
  const db = getMigrateDb()
  const rows = await db
    .select()
    .from(tenantLlmConfigs)
    .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
    .limit(1)
  return rows[0] ? toView(rows[0]) : null
}

export async function createLlmConfig(tenantId: string, input: LlmConfigInput): Promise<LlmConfigView> {
  const db = getMigrateDb()

  if (input.isDefault) {
    await db
      .update(tenantLlmConfigs)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(tenantLlmConfigs.tenantId, tenantId), eq(tenantLlmConfigs.isDefault, true)))
  }

  const id = uuidv7()
  const rows = await db
    .insert(tenantLlmConfigs)
    .values({
      id,
      tenantId,
      label: input.label,
      kind: input.kind,
      modelId: input.modelId,
      baseUrl: input.baseUrl ?? null,
      apiKeyEncrypted: encryptApiKey(input.apiKey),
      isEnabled: true,
      isDefault: input.isDefault ?? false,
    })
    .returning()
  return toView(rows[0])
}

export async function updateLlmConfig(
  id: string,
  tenantId: string,
  input: Partial<LlmConfigInput> & { isEnabled?: boolean },
): Promise<LlmConfigView | null> {
  const db = getMigrateDb()

  if (input.isDefault) {
    await db
      .update(tenantLlmConfigs)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(tenantLlmConfigs.tenantId, tenantId), eq(tenantLlmConfigs.isDefault, true)))
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.label !== undefined) patch.label = input.label
  if (input.kind !== undefined) patch.kind = input.kind
  if (input.modelId !== undefined) patch.modelId = input.modelId
  if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl
  if (input.apiKey !== undefined) patch.apiKeyEncrypted = encryptApiKey(input.apiKey)
  if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled
  if (input.isDefault !== undefined) patch.isDefault = input.isDefault

  const rows = await db
    .update(tenantLlmConfigs)
    .set(patch)
    .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
    .returning()
  return rows[0] ? toView(rows[0]) : null
}

export async function deleteLlmConfig(id: string, tenantId: string): Promise<boolean> {
  const db = getMigrateDb()
  const rows = await db
    .delete(tenantLlmConfigs)
    .where(and(eq(tenantLlmConfigs.id, id), eq(tenantLlmConfigs.tenantId, tenantId)))
    .returning({ id: tenantLlmConfigs.id })
  return rows.length > 0
}

export async function resolveProviderSpec(
  tenantId: string,
  llmConfigId?: string | null,
): Promise<ProviderModelSpec | null> {
  const db = getMigrateDb()

  let row = null
  if (llmConfigId) {
    const rows = await db
      .select()
      .from(tenantLlmConfigs)
      .where(
        and(
          eq(tenantLlmConfigs.id, llmConfigId),
          eq(tenantLlmConfigs.tenantId, tenantId),
          eq(tenantLlmConfigs.isEnabled, true),
        ),
      )
      .limit(1)
    row = rows[0] ?? null
  }

  if (!row) {
    const rows = await db
      .select()
      .from(tenantLlmConfigs)
      .where(
        and(
          eq(tenantLlmConfigs.tenantId, tenantId),
          eq(tenantLlmConfigs.isDefault, true),
          eq(tenantLlmConfigs.isEnabled, true),
        ),
      )
      .limit(1)
    row = rows[0] ?? null
  }

  if (!row || !row.apiKeyEncrypted) return null

  const apiKey = decryptApiKey(row.apiKeyEncrypted)

  if (row.kind === 'anthropic') {
    return { kind: 'anthropic', modelId: row.modelId, apiKey }
  }
  if (row.kind === 'openai_compatible') {
    return { kind: 'openai_compatible', modelId: row.modelId, apiKey, baseUrl: row.baseUrl! }
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
