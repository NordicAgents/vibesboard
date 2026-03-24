#!/usr/bin/env npx tsx
/**
 * One-time data migration: Supabase PostgreSQL -> Firestore
 *
 * Usage:
 *   npx tsx scripts/migrate-to-firestore.ts
 *   npx tsx scripts/migrate-to-firestore.ts --dry-run
 *
 * Required environment variables:
 *   SUPABASE_DATABASE_URL   - PostgreSQL connection string (direct, not pooler)
 *   FIREBASE_SERVICE_ACCOUNT_KEY - JSON string of Firebase service account key
 *
 * Prerequisites:
 *   pnpm add -D pg @types/pg    (if not already installed)
 *
 * Migration order (respects foreign-key dependencies):
 *   1.  feature_flags
 *   2.  users (from auth.users)
 *   3.  tenants  +  tenant_slugs
 *   4.  tenant members (tenant_users)
 *   5.  tenant branding
 *   6.  tenant feature toggles
 *   7.  invitations
 *   8.  chats
 *   9.  agents (vibe_agents)
 *   10. conversations (vibe_agent_conversations)
 *   11. agent files
 *   12. file chunks (with vector embeddings)
 *   13. conversation chunks (with vector embeddings)
 *   14. WhatsApp business accounts
 *   15. WhatsApp contacts
 *   16. WhatsApp contact lists
 *   17. contact list members -> denormalize into contacts & lists
 *   18. WhatsApp campaigns
 *   19. message queue
 *   20. WhatsApp agent connections
 *   21. message templates
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import pg from 'pg'

// ─── Configuration ──────────────────────────────────────────────────────────

const PG_CONNECTION = process.env.SUPABASE_DATABASE_URL || ''
const FIREBASE_SA_KEY = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}'
)
const BATCH_SIZE = 400 // Firestore batch limit is 500; stay well below
const DRY_RUN = process.argv.includes('--dry-run')

// ─── Initialise clients ─────────────────────────────────────────────────────

if (!PG_CONNECTION) {
  console.error('ERROR: SUPABASE_DATABASE_URL is required')
  process.exit(1)
}
if (!FIREBASE_SA_KEY.project_id) {
  console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY is required (JSON string)')
  process.exit(1)
}

const app = initializeApp({ credential: cert(FIREBASE_SA_KEY) })
const db: Firestore = getFirestore(app)
const pgPool = new pg.Pool({ connectionString: PG_CONNECTION })

// ─── Summary counters ───────────────────────────────────────────────────────

const summary: Record<string, { migrated: number; errors: number }> = {}

function initSummary(step: string) {
  summary[step] = { migrated: 0, errors: 0 }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert snake_case to camelCase */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/** Convert all keys in an object from snake_case to camelCase */
function camelCaseKeys(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value
  }
  return result
}

/** Convert a PostgreSQL timestamp to ISO string, or return undefined */
function toISOString(val: any): string | undefined {
  if (val == null) return undefined
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

/** Generate a URL-friendly slug from a tenant name */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Parse a pgvector embedding string into a float array.
 * pgvector returns strings like '[0.1,0.2,0.3,...]'
 */
function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    // pgvector can return '[...]' – parse directly
    return JSON.parse(raw)
  } catch {
    // Fallback: strip surrounding brackets and split
    const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '')
    return cleaned.split(',').map(Number)
  }
}

/**
 * Write documents in batched commits. Each batch stays under BATCH_SIZE.
 * Skips writes in --dry-run mode.
 */
async function batchWrite(
  docs: Array<{
    ref: FirebaseFirestore.DocumentReference
    data: Record<string, any>
  }>
): Promise<void> {
  if (DRY_RUN) return

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    const slice = docs.slice(i, i + BATCH_SIZE)
    for (const { ref, data } of slice) {
      batch.set(ref, data)
    }
    await batch.commit()
  }
}

/**
 * Execute a SQL query and return the rows.
 */
async function query(sql: string, params?: any[]): Promise<any[]> {
  const client = await pgPool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows
  } finally {
    client.release()
  }
}

// ─── Step 1: Feature Flags ──────────────────────────────────────────────────

async function migrateFeatureFlags() {
  const step = '1. Feature Flags'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.feature_flags')
  console.log(`  Found ${rows.length} feature flags`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        id: row.id,
        name: row.name,
        description: row.description || undefined,
        defaultValue: row.default_value,
        createdAt: toISOString(row.created_at)!,
      }
      docs.push({ ref: db.collection('feature_flags').doc(row.id), data })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on feature flag ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} feature flags`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} feature flags`)
  }
}

// ─── Step 2: Users ──────────────────────────────────────────────────────────

async function migrateUsers() {
  const step = '2. Users'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  // Fetch users from auth.users. Join with tenant_users to get tenantIds.
  const rows = await query(`
    SELECT
      u.id,
      u.email,
      u.raw_user_meta_data,
      u.created_at,
      u.updated_at,
      COALESCE(
        (SELECT array_agg(tu.tenant_id::text)
         FROM public.tenant_users tu
         WHERE tu.user_id = u.id),
        ARRAY[]::text[]
      ) AS tenant_ids,
      EXISTS (
        SELECT 1 FROM public.tenant_users tu
        WHERE tu.user_id = u.id AND tu.role = 'SUPER_ADMIN'
      ) AS is_super_admin
    FROM auth.users u
  `)

  console.log(`  Found ${rows.length} users`)

  const docs = []
  for (const row of rows) {
    try {
      const meta = row.raw_user_meta_data || {}
      const data = {
        id: row.id,
        email: row.email || '',
        name: meta.full_name || meta.name || undefined,
        image: meta.avatar_url || meta.picture || undefined,
        isSuperAdmin: row.is_super_admin || false,
        tenantIds: row.tenant_ids || [],
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }
      docs.push({ ref: db.collection('users').doc(row.id), data })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on user ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} users`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} users`)
  }
}

// ─── Step 3: Tenants + Tenant Slugs ────────────────────────────────────────

async function migrateTenants() {
  const step = '3. Tenants + Slugs'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.tenants')
  console.log(`  Found ${rows.length} tenants`)

  const tenantDocs = []
  const slugDocs = []

  for (const row of rows) {
    try {
      const slug = row.slug || slugify(row.name)
      const data = {
        id: row.id,
        name: row.name,
        slug,
        status: row.status,
        createdBy: row.created_by,
        isPersonal: row.is_personal ?? false,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }
      tenantDocs.push({ ref: db.collection('tenants').doc(row.id), data })

      // Slug lookup document
      slugDocs.push({
        ref: db.collection('tenant_slugs').doc(slug),
        data: {
          tenantId: row.id,
          createdAt: toISOString(row.created_at)!,
        },
      })

      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on tenant ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(
      `  [DRY RUN] Would write ${tenantDocs.length} tenants + ${slugDocs.length} slugs`
    )
  } else {
    await batchWrite(tenantDocs)
    await batchWrite(slugDocs)
    console.log(
      `  Wrote ${tenantDocs.length} tenants + ${slugDocs.length} slugs`
    )
  }
}

// ─── Step 4: Tenant Members ────────────────────────────────────────────────

async function migrateTenantMembers() {
  const step = '4. Tenant Members'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.tenant_users')
  console.log(`  Found ${rows.length} tenant-user memberships`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        userId: row.user_id,
        tenantId: row.tenant_id,
        role: row.role,
        createdAt: toISOString(row.created_at)!,
      }
      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('members')
          .doc(row.user_id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(
        `  ERROR on membership ${row.user_id}/${row.tenant_id}:`,
        err
      )
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} memberships`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} memberships`)
  }
}

// ─── Step 5: Tenant Branding ───────────────────────────────────────────────

async function migrateTenantBranding() {
  const step = '5. Tenant Branding'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.tenant_branding')
  console.log(`  Found ${rows.length} branding records`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        tenantId: row.tenant_id,
        logoUrl: row.logo_url || undefined,
        primaryColor: row.primary_color,
        secondaryColor: row.secondary_color,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }
      // Store branding doc with tenantId as document ID (single doc per tenant)
      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('branding')
          .doc(row.tenant_id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on branding ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} branding docs`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} branding docs`)
  }
}

// ─── Step 6: Tenant Feature Toggles ────────────────────────────────────────

async function migrateTenantFeatureToggles() {
  const step = '6. Feature Toggles'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  // Join with feature_flags to denormalize the flag name
  const rows = await query(`
    SELECT tft.*, ff.name AS flag_name
    FROM public.tenant_feature_toggles tft
    JOIN public.feature_flags ff ON ff.id = tft.feature_flag_id
  `)
  console.log(`  Found ${rows.length} feature toggles`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        tenantId: row.tenant_id,
        featureFlagId: row.feature_flag_id,
        featureFlagName: row.flag_name,
        isEnabled: row.is_enabled,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }
      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('feature_toggles')
          .doc(row.feature_flag_id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(
        `  ERROR on toggle ${row.tenant_id}/${row.feature_flag_id}:`,
        err
      )
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} feature toggles`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} feature toggles`)
  }
}

// ─── Step 7: Invitations ───────────────────────────────────────────────────

async function migrateInvitations() {
  const step = '7. Invitations'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.invitations')
  console.log(`  Found ${rows.length} invitations`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        id: row.id,
        email: row.email,
        tenantId: row.tenant_id,
        token: row.token,
        role: row.role,
        status: row.status,
        expiresAt: toISOString(row.expires_at)!,
        acceptedAt: toISOString(row.accepted_at),
        createdBy: row.created_by,
        createdAt: toISOString(row.created_at)!,
      }
      // Key by token for O(1) lookup
      docs.push({
        ref: db.collection('invitations').doc(row.token),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on invitation ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} invitations`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} invitations`)
  }
}

// ─── Step 8: Chats ─────────────────────────────────────────────────────────

async function migrateChats() {
  const step = '8. Chats'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.chats')
  console.log(`  Found ${rows.length} chats`)

  const docs = []
  for (const row of rows) {
    try {
      const data: Record<string, any> = {
        id: row.id,
        userId: row.user_id || undefined,
        payload: row.payload || undefined,
      }
      docs.push({ ref: db.collection('chats').doc(row.id), data })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on chat ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} chats`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} chats`)
  }
}

// ─── Step 9: Agents (vibe_agents) ──────────────────────────────────────────

// Build a tenant slug lookup for denormalization
let tenantSlugMap: Record<string, string> = {}

async function buildTenantSlugMap() {
  const rows = await query('SELECT id, slug FROM public.tenants')
  tenantSlugMap = {}
  for (const row of rows) {
    tenantSlugMap[row.id] = row.slug || slugify(row.name || '')
  }
}

async function migrateAgents() {
  const step = '9. Agents'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  await buildTenantSlugMap()

  const rows = await query('SELECT * FROM public.vibe_agents')
  console.log(`  Found ${rows.length} agents`)

  const docs = []
  for (const row of rows) {
    try {
      if (!row.tenant_id) {
        console.warn(`  WARN: Agent ${row.id} has no tenant_id, skipping`)
        summary[step].errors++
        continue
      }

      const data: Record<string, any> = {
        id: row.id,
        userId: row.user_id,
        tenantId: row.tenant_id,
        tenantSlug: tenantSlugMap[row.tenant_id] || '',
        name: row.name,
        instructions: row.instructions,
        fileKeys: row.file_keys || [],
        agentUrl: row.agent_url,
        tools: row.tools || [],
        allowAnonymous: row.allow_anonymous ?? true,
        greetingText: row.greeting_text || undefined,
        quickSuggestionsMode: row.quick_suggestions_mode || 'off',
        quickSuggestionsCount: row.quick_suggestions_count ?? 4,
        mode: row.mode || 'provider',
        maxMessages: row.max_messages ?? undefined,
        lastEmbeddingsSyncAt: toISOString(row.last_embeddings_sync_at),
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('agents')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on agent ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} agents`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} agents`)
  }
}

// ─── Step 10: Conversations ────────────────────────────────────────────────

// Build an agent -> tenantId lookup
let agentTenantMap: Record<string, string> = {}

async function buildAgentTenantMap() {
  const rows = await query(
    'SELECT id, tenant_id FROM public.vibe_agents WHERE tenant_id IS NOT NULL'
  )
  agentTenantMap = {}
  for (const row of rows) {
    agentTenantMap[row.id] = row.tenant_id
  }
}

async function migrateConversations() {
  const step = '10. Conversations'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  await buildAgentTenantMap()

  const rows = await query('SELECT * FROM public.vibe_agent_conversations')
  console.log(`  Found ${rows.length} conversations`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = agentTenantMap[row.agent_id]
      if (!tenantId) {
        console.warn(
          `  WARN: Conversation ${row.id} has orphaned agent ${row.agent_id}, skipping`
        )
        summary[step].errors++
        continue
      }

      const data: Record<string, any> = {
        id: row.id,
        agentId: row.agent_id,
        userId: row.user_id || undefined,
        externalId: row.external_id || undefined,
        messages: row.messages || [],
        summary: row.summary || undefined,
        closedAt: toISOString(row.closed_at),
        summaryGeneratedAt: toISOString(row.summary_generated_at),
        // WhatsApp-specific fields (may exist from whatsapp_agent_connections migration)
        ...(row.channel && row.channel !== 'web' ? { channel: row.channel } : {}),
        ...(row.whatsapp_connection_id
          ? { whatsappConnectionId: row.whatsapp_connection_id }
          : {}),
        ...(row.whatsapp_phone_number
          ? { whatsappPhoneNumber: row.whatsapp_phone_number }
          : {}),
        ...(row.whatsapp_message_ids && row.whatsapp_message_ids.length > 0
          ? { whatsappMessageIds: row.whatsapp_message_ids }
          : {}),
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('agents')
          .doc(row.agent_id)
          .collection('conversations')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on conversation ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} conversations`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} conversations`)
  }
}

// ─── Step 11: Agent Files ──────────────────────────────────────────────────

async function migrateAgentFiles() {
  const step = '11. Agent Files'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.agent_files')
  console.log(`  Found ${rows.length} agent files`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = row.tenant_id || agentTenantMap[row.agent_id]
      if (!tenantId) {
        console.warn(
          `  WARN: Agent file ${row.id} has no resolvable tenant, skipping`
        )
        summary[step].errors++
        continue
      }

      const data = {
        id: row.id,
        agentId: row.agent_id,
        tenantId,
        userId: row.user_id,
        fileKey: row.file_key,
        fileName: row.file_name,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size),
        status: row.status,
        processingError: row.processing_error || undefined,
        processingStartedAt: toISOString(row.processing_started_at),
        processingCompletedAt: toISOString(row.processing_completed_at),
        chunkCount: row.chunk_count ?? 0,
        totalTokens: row.total_tokens ?? 0,
        embeddingModel: row.embedding_model || 'text-embedding-3-small',
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('agents')
          .doc(row.agent_id)
          .collection('files')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on agent file ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} agent files`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} agent files`)
  }
}

// ─── Step 12: File Chunks (with vector embeddings) ─────────────────────────

async function migrateFileChunks() {
  const step = '12. File Chunks'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  // Cast embedding to text for parsing; pgvector doesn't directly return JSON
  const rows = await query(`
    SELECT id, agent_id, file_id, file_key, file_name, mime_type,
           chunk_index, content, embedding::text AS embedding, created_at
    FROM public.agent_file_chunks
  `)
  console.log(`  Found ${rows.length} file chunks`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = agentTenantMap[row.agent_id]
      if (!tenantId) {
        console.warn(
          `  WARN: File chunk ${row.id} has orphaned agent ${row.agent_id}, skipping`
        )
        summary[step].errors++
        continue
      }

      const embeddingArray = parseEmbedding(row.embedding)

      const data: Record<string, any> = {
        id: row.id,
        agentId: row.agent_id,
        fileId: row.file_id || undefined,
        fileKey: row.file_key,
        fileName: row.file_name,
        mimeType: row.mime_type || undefined,
        chunkIndex: row.chunk_index,
        content: row.content,
        // Use FieldValue.vector() for Firestore vector search support
        embedding: embeddingArray
          ? FieldValue.vector(embeddingArray)
          : undefined,
        createdAt: toISOString(row.created_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('agents')
          .doc(row.agent_id)
          .collection('file_chunks')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on file chunk ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} file chunks`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} file chunks`)
  }
}

// ─── Step 13: Conversation Chunks (with vector embeddings) ─────────────────

async function migrateConversationChunks() {
  const step = '13. Conversation Chunks'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query(`
    SELECT id, agent_id, conversation_id, message_index, chunk_index,
           role, content, embedding::text AS embedding, created_at
    FROM public.vibe_agent_conversation_chunks
  `)
  console.log(`  Found ${rows.length} conversation chunks`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = agentTenantMap[row.agent_id]
      if (!tenantId) {
        console.warn(
          `  WARN: Conversation chunk ${row.id} has orphaned agent ${row.agent_id}, skipping`
        )
        summary[step].errors++
        continue
      }

      const embeddingArray = parseEmbedding(row.embedding)

      const data: Record<string, any> = {
        id: row.id,
        agentId: row.agent_id,
        conversationId: row.conversation_id,
        messageIndex: row.message_index,
        chunkIndex: row.chunk_index,
        role: row.role,
        content: row.content,
        embedding: embeddingArray
          ? FieldValue.vector(embeddingArray)
          : undefined,
        createdAt: toISOString(row.created_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('agents')
          .doc(row.agent_id)
          .collection('conversation_chunks')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on conversation chunk ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} conversation chunks`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} conversation chunks`)
  }
}

// ─── Step 14: WhatsApp Business Accounts ───────────────────────────────────

async function migrateWhatsAppBusinessAccounts() {
  const step = '14. WhatsApp Business Accounts'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query(
    'SELECT * FROM public.tenant_whatsapp_business_accounts'
  )
  console.log(`  Found ${rows.length} business accounts`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        id: row.id,
        tenantId: row.tenant_id,
        phoneNumberId: row.phone_number_id,
        businessAccountId: row.business_account_id,
        accessToken: row.access_token,
        phoneNumber: row.phone_number,
        phoneNumberNormalized: row.phone_number_normalized,
        status: row.status,
        qualityRating: row.quality_rating || undefined,
        messagingLimit: row.messaging_limit || undefined,
        displayName: row.display_name || undefined,
        timezone: row.timezone || 'UTC',
        verifiedAt: toISOString(row.verified_at),
        webhookVerified: row.webhook_verified ?? false,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('whatsapp_business_accounts')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on business account ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} business accounts`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} business accounts`)
  }
}

// ─── Step 15: WhatsApp Contacts ────────────────────────────────────────────

// We will need to denormalize listIds in step 17, so build a lookup first
let contactListMemberships: Record<string, string[]> = {} // contactId -> listIds[]
let listContactMemberships: Record<string, string[]> = {} // listId -> contactIds[]

async function buildContactListMemberships() {
  const rows = await query(
    'SELECT contact_id, list_id FROM public.whatsapp_contact_list_members'
  )
  contactListMemberships = {}
  listContactMemberships = {}
  for (const row of rows) {
    if (!contactListMemberships[row.contact_id]) {
      contactListMemberships[row.contact_id] = []
    }
    contactListMemberships[row.contact_id].push(row.list_id)

    if (!listContactMemberships[row.list_id]) {
      listContactMemberships[row.list_id] = []
    }
    listContactMemberships[row.list_id].push(row.contact_id)
  }
  console.log(
    `  Built contact-list memberships: ${rows.length} membership rows`
  )
}

async function migrateWhatsAppContacts() {
  const step = '15. WhatsApp Contacts'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  // Build memberships first for denormalization
  await buildContactListMemberships()

  const rows = await query('SELECT * FROM public.whatsapp_contacts')
  console.log(`  Found ${rows.length} contacts`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        id: row.id,
        tenantId: row.tenant_id,
        phoneNumber: row.phone_number,
        phoneNumberNormalized: row.phone_number_normalized,
        name: row.name || undefined,
        email: row.email || undefined,
        optedIn: row.opted_in ?? false,
        optedInAt: toISOString(row.opted_in_at),
        optedOutAt: toISOString(row.opted_out_at),
        optInSource: row.opt_in_source || undefined,
        customFields: row.custom_fields || {},
        tags: row.tags || [],
        listIds: contactListMemberships[row.id] || [], // denormalized
        source: row.source || '',
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('whatsapp_contacts')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on contact ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} contacts`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} contacts`)
  }
}

// ─── Step 16: WhatsApp Contact Lists ───────────────────────────────────────

async function migrateWhatsAppContactLists() {
  const step = '16. WhatsApp Contact Lists'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.whatsapp_contact_lists')
  console.log(`  Found ${rows.length} contact lists`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        description: row.description || undefined,
        contactIds: listContactMemberships[row.id] || [], // denormalized
        totalContacts: row.total_contacts ?? 0,
        optedInCount: row.opted_in_count ?? 0,
        tags: row.tags || [],
        createdBy: row.created_by || undefined,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('whatsapp_contact_lists')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on contact list ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} contact lists`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} contact lists`)
  }
}

// ─── Step 17: Contact List Members (denormalized in steps 15 & 16) ─────────

async function logContactListMembers() {
  const step = '17. Contact List Members (denormalized)'
  initSummary(step)
  console.log(`\n=== ${step} ===`)
  console.log(
    '  Denormalized into contact.listIds[] and list.contactIds[] (steps 15 & 16)'
  )
  const count = Object.values(contactListMemberships).reduce(
    (sum, arr) => sum + arr.length,
    0
  )
  summary[step].migrated = count
  console.log(`  Total membership links: ${count}`)
}

// ─── Step 18: WhatsApp Campaigns ───────────────────────────────────────────

async function migrateWhatsAppCampaigns() {
  const step = '18. WhatsApp Campaigns'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.whatsapp_campaigns')
  console.log(`  Found ${rows.length} campaigns`)

  const docs = []
  for (const row of rows) {
    try {
      const data = {
        id: row.id,
        tenantId: row.tenant_id,
        businessAccountId: row.business_account_id,
        name: row.name,
        description: row.description || undefined,
        templateId: row.template_id || '',
        templateVariables: row.template_variables || {},
        contactListIds: row.contact_list_ids || [],
        filterCriteria: row.filter_criteria || undefined,
        status: row.status,
        scheduledAt: toISOString(row.scheduled_at),
        startedAt: toISOString(row.started_at),
        completedAt: toISOString(row.completed_at),
        pausedAt: toISOString(row.paused_at),
        totalRecipients: row.total_recipients ?? 0,
        messagesSent: row.messages_sent ?? 0,
        messagesDelivered: row.messages_delivered ?? 0,
        messagesRead: row.messages_read ?? 0,
        messagesFailed: row.messages_failed ?? 0,
        messagesPending: row.messages_pending ?? 0,
        maxMessagesPerSecond: row.max_messages_per_second ?? 20,
        createdBy: row.created_by || undefined,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(row.tenant_id)
          .collection('whatsapp_campaigns')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on campaign ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} campaigns`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} campaigns`)
  }
}

// ─── Step 19: Message Queue ────────────────────────────────────────────────

// Build campaign -> tenantId lookup
let campaignTenantMap: Record<string, string> = {}

async function buildCampaignTenantMap() {
  const rows = await query(
    'SELECT id, tenant_id FROM public.whatsapp_campaigns'
  )
  campaignTenantMap = {}
  for (const row of rows) {
    campaignTenantMap[row.id] = row.tenant_id
  }
}

async function migrateMessageQueue() {
  const step = '19. Message Queue'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  await buildCampaignTenantMap()

  const rows = await query('SELECT * FROM public.whatsapp_message_queue')
  console.log(`  Found ${rows.length} queue items`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = row.campaign_id
        ? campaignTenantMap[row.campaign_id]
        : undefined
      if (!tenantId) {
        console.warn(
          `  WARN: Queue item ${row.id} has no resolvable tenant, skipping`
        )
        summary[step].errors++
        continue
      }

      const data = {
        id: row.id,
        campaignId: row.campaign_id,
        businessAccountId: row.business_account_id,
        contactId: row.contact_id || undefined,
        toPhoneNumber: row.to_phone_number,
        templateId: row.template_id || undefined,
        templateName: row.template_name,
        templateLanguage: row.template_language,
        templateVariables: row.template_variables || {},
        status: row.status,
        attempts: row.attempts ?? 0,
        maxAttempts: row.max_attempts ?? 3,
        messageId: row.whatsapp_message_id || undefined,
        error: row.error_message || undefined,
        errorCode: row.error_code || undefined,
        sentAt: toISOString(row.sent_at),
        deliveredAt: toISOString(row.delivered_at),
        readAt: toISOString(row.read_at),
        failedAt: toISOString(row.failed_at),
        scheduledFor: toISOString(row.scheduled_for),
        processedAt: toISOString(row.processed_at),
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('whatsapp_campaigns')
          .doc(row.campaign_id)
          .collection('message_queue')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on queue item ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} queue items`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} queue items`)
  }
}

// ─── Step 20: WhatsApp Agent Connections ───────────────────────────────────

async function migrateWhatsAppAgentConnections() {
  const step = '20. WhatsApp Agent Connections'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  const rows = await query('SELECT * FROM public.whatsapp_agent_connections')
  console.log(`  Found ${rows.length} agent connections`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = agentTenantMap[row.agent_id]
      if (!tenantId) {
        console.warn(
          `  WARN: WhatsApp connection ${row.id} has orphaned agent ${row.agent_id}, skipping`
        )
        summary[step].errors++
        continue
      }

      const data = {
        id: row.id,
        agentId: row.agent_id,
        userId: row.user_id,
        phoneNumber: row.phone_number,
        phoneNumberNormalized: row.phone_number_normalized,
        status: row.status,
        customIntroMessage: row.custom_intro_message || undefined,
        introMessageSentAt: toISOString(row.intro_message_sent_at),
        introMessageId: row.intro_message_id || undefined,
        lastMessageReceivedAt: toISOString(row.last_message_received_at),
        totalConversations: row.total_conversations ?? 0,
        connectedAt: toISOString(row.connected_at),
        disconnectedAt: toISOString(row.disconnected_at),
        expiresAt: toISOString(row.expires_at),
        disconnectionReason: row.disconnection_reason || undefined,
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('agents')
          .doc(row.agent_id)
          .collection('whatsapp_connections')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on connection ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} connections`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} connections`)
  }
}

// ─── Step 21: Message Templates ────────────────────────────────────────────

// Build business account -> tenantId lookup
let businessAccountTenantMap: Record<string, string> = {}

async function buildBusinessAccountTenantMap() {
  const rows = await query(
    'SELECT id, tenant_id FROM public.tenant_whatsapp_business_accounts'
  )
  businessAccountTenantMap = {}
  for (const row of rows) {
    businessAccountTenantMap[row.id] = row.tenant_id
  }
}

async function migrateMessageTemplates() {
  const step = '21. Message Templates'
  initSummary(step)
  console.log(`\n=== ${step} ===`)

  await buildBusinessAccountTenantMap()

  const rows = await query('SELECT * FROM public.whatsapp_message_templates')
  console.log(`  Found ${rows.length} message templates`)

  const docs = []
  for (const row of rows) {
    try {
      const tenantId = businessAccountTenantMap[row.business_account_id]
      if (!tenantId) {
        console.warn(
          `  WARN: Template ${row.id} has orphaned business account ${row.business_account_id}, skipping`
        )
        summary[step].errors++
        continue
      }

      const data = {
        id: row.id,
        businessAccountId: row.business_account_id,
        name: row.name,
        language: row.language || 'en',
        category: row.category,
        headerType: row.header_type || undefined,
        headerText: row.header_text || undefined,
        headerMediaUrl: row.header_media_url || undefined,
        bodyText: row.body_text,
        footerText: row.footer_text || undefined,
        variables: row.variables || [],
        buttons: row.buttons || [],
        status: row.status,
        metaTemplateId: row.meta_template_id || undefined,
        rejectionReason: row.rejection_reason || undefined,
        totalSent: row.total_sent ?? 0,
        lastUsedAt: toISOString(row.last_used_at),
        createdAt: toISOString(row.created_at)!,
        updatedAt: toISOString(row.updated_at)!,
      }

      docs.push({
        ref: db
          .collection('tenants')
          .doc(tenantId)
          .collection('whatsapp_business_accounts')
          .doc(row.business_account_id)
          .collection('templates')
          .doc(row.id),
        data,
      })
      summary[step].migrated++
    } catch (err) {
      console.error(`  ERROR on template ${row.id}:`, err)
      summary[step].errors++
    }
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${docs.length} templates`)
  } else {
    await batchWrite(docs)
    console.log(`  Wrote ${docs.length} templates`)
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║  Supabase PostgreSQL -> Firestore Migration              ║')
  console.log('╚════════════════════════════════════════════════════════════╝')

  if (DRY_RUN) {
    console.log('\n🏃 DRY RUN MODE — no data will be written to Firestore\n')
  }

  const startTime = Date.now()

  // Run migration steps in dependency order
  const steps = [
    migrateFeatureFlags, //  1
    migrateUsers, //  2
    migrateTenants, //  3
    migrateTenantMembers, //  4
    migrateTenantBranding, //  5
    migrateTenantFeatureToggles, //  6
    migrateInvitations, //  7
    migrateChats, //  8
    migrateAgents, //  9
    migrateConversations, // 10
    migrateAgentFiles, // 11
    migrateFileChunks, // 12
    migrateConversationChunks, // 13
    migrateWhatsAppBusinessAccounts, // 14
    migrateWhatsAppContacts, // 15
    migrateWhatsAppContactLists, // 16
    logContactListMembers, // 17
    migrateWhatsAppCampaigns, // 18
    migrateMessageQueue, // 19
    migrateWhatsAppAgentConnections, // 20
    migrateMessageTemplates, // 21
  ]

  for (const stepFn of steps) {
    try {
      await stepFn()
    } catch (err) {
      console.error(`\n  FATAL ERROR in ${stepFn.name}:`, err)
      console.error('  Continuing to next step...\n')
    }
  }

  // ─── Print summary ────────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║  Migration Summary                                       ║')
  console.log('╠════════════════════════════════════════════════════════════╣')

  let totalMigrated = 0
  let totalErrors = 0
  for (const [step, counts] of Object.entries(summary)) {
    const status =
      counts.errors > 0
        ? `  ${counts.migrated} ok, ${counts.errors} errors`
        : `  ${counts.migrated} ok`
    console.log(`║ ${step.padEnd(42)} ${status.padEnd(15)} ║`)
    totalMigrated += counts.migrated
    totalErrors += counts.errors
  }

  console.log('╠════════════════════════════════════════════════════════════╣')
  console.log(
    `║ Total migrated: ${totalMigrated}   Errors: ${totalErrors}   Time: ${elapsed}s`.padEnd(
      61
    ) + '║'
  )
  if (DRY_RUN) {
    console.log(
      '║ MODE: DRY RUN (no writes performed)                       ║'
    )
  }
  console.log('╚════════════════════════════════════════════════════════════╝')

  // Clean up
  await pgPool.end()
  process.exit(totalErrors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  pgPool.end()
  process.exit(1)
})
