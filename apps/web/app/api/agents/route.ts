import { NextResponse } from 'next/server'
import { eq, and, desc, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'

import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb, type Db } from '@vibesboard/adapter-postgres/client'
import {
  agents as agentsTable,
  tenants as tenantsTable
} from '@vibesboard/adapter-postgres/schema'
import {
  mapAgentDoc,
  createAgentSlug,
  ensureUniqueSlug
} from '@vibesboard/agents/db'
import { isMemberOfTenant, isSuperAdmin } from '@vibesboard/policy/permissions'
import { getActiveTenant, getTenantById } from '@/lib/tenant-context'
import { upsertAgentSchema } from '@vibesboard/agents/schema'
import { createAgentFilesAndTriggerProcessing } from '@vibesboard/agents/file-processing'
import { recordAgentVersion } from '@vibesboard/agents/versioning'

export const runtime = 'nodejs'

// Map a Postgres agents row + tenant slug to the legacy VibeAgent shape the
// frontend expects (uses `agentUrl` and `tenantSlug` denormalized fields,
// dates as ISO strings).
function toAgentRecord(
  row: typeof agentsTable.$inferSelect,
  tenantSlug: string
): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    tenantSlug,
    name: row.name,
    instructions: row.instructions,
    fileKeys: row.fileKeys,
    tools: row.tools,
    allowAnonymous: row.allowAnonymous,
    accessPassword: row.accessPasswordHash,
    agentUrl: row.slug,
    greetingText: row.greetingText,
    mode: row.mode,
    collectionFields: row.collectionFields ?? undefined,
    maxResponses: row.maxResponses,
    maxAgentResponses: row.maxAgentResponses,
    totalResponseCount: row.totalResponseCount,
    quickSuggestionsMode: row.quickSuggestionsMode,
    quickSuggestionsCount: row.quickSuggestionsCount,
    handoffTargets: row.handoffTargets,
    googleReviewEnabled: row.googleReviewEnabled,
    googlePlaceId: row.googlePlaceId,
    retrievalStrategy: row.retrievalStrategy ?? 'direct',
    notificationConfig: row.notificationConfig ?? undefined,
    schedulingConfig: row.schedulingConfig ?? undefined,
    dataConfig: row.dataConfig ?? undefined,
    calendarAvailabilityConfig: row.calendarAvailabilityConfig ?? undefined,
    bookingConfig: row.bookingConfig ?? undefined,
    lastEmbeddingsSyncAt: row.lastEmbeddingsSyncAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function GET(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenant_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '9')
  const from = (page - 1) * limit

  const isSuperAdminUser = tenantId ? await isSuperAdmin(user.id) : false

  if (tenantId && !isSuperAdminUser) {
    const isMember = await isMemberOfTenant(user.id, tenantId)
    if (!isMember) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const db = getMigrateDb()
  const baseFilter = tenantId
    ? eq(agentsTable.tenantId, tenantId)
    : eq(agentsTable.userId, user.id)

  // Total count
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentsTable)
    .where(baseFilter)
  const total = countRows[0]?.count ?? 0

  // Paged rows with tenant slug joined for the response
  const rows = await db
    .select({
      agent: agentsTable,
      tenantSlug: tenantsTable.slug
    })
    .from(agentsTable)
    .innerJoin(tenantsTable, eq(agentsTable.tenantId, tenantsTable.id))
    .where(baseFilter)
    .orderBy(desc(agentsTable.createdAt))
    .offset(from)
    .limit(limit)

  const agents = rows.map(r =>
    mapAgentDoc(toAgentRecord(r.agent, r.tenantSlug))
  )

  return NextResponse.json({
    agents,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  // Both of these used to throw out of the handler (SyntaxError / ZodError),
  // which Next reports as a 500 — malformed client input is a 400.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = upsertAgentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const payload = parsed.data

  const tenantId = await getActiveTenant(user.id)
  if (!tenantId) {
    return NextResponse.json(
      {
        error:
          'No tenant available for this user; ensure tenant membership exists.'
      },
      { status: 400 }
    )
  }

  const tenant = await getTenantById(tenantId)
  const tenantSlug = tenant?.slug ?? 'unknown'

  const slug = await ensureUniqueSlug(createAgentSlug(payload.name), tenantId)
  const newId = uuidv7()

  const insertValues: typeof agentsTable.$inferInsert = {
    id: newId,
    tenantId,
    userId: user.id,
    name: payload.name,
    slug,
    instructions: payload.instructions ?? '',
    mode: payload.mode ?? 'provider',
    allowAnonymous: payload.allowAnonymous ?? false,
    greetingText: payload.greetingText ?? null,
    quickSuggestionsMode: payload.quickSuggestionsMode ?? 'off',
    quickSuggestionsCount: payload.quickSuggestionsCount ?? 4,
    tools: (payload.tools as unknown as string[]) ?? [],
    fileKeys: payload.fileKeys ?? [],
    handoffTargets: payload.handoffTargets ?? [],
    collectionFields: payload.collectionFields ?? null,
    maxResponses: payload.maxResponses ?? null,
    maxAgentResponses: payload.maxAgentResponses ?? null,
    totalResponseCount: 0,
    retrievalStrategy: payload.retrievalStrategy ?? 'direct',
    notificationConfig: payload.notificationConfig ?? null,
    schedulingConfig: payload.schedulingConfig ?? null,
    bookingConfig: payload.bookingConfig ?? null,
    // dataConfig payload shape (from @vibesboard/agents/schema) differs from
    // the Postgres column's AgentDataConfig $type — they describe different
    // generations of the integration. Stored verbatim as JSONB; downstream
    // readers normalize.
    dataConfig: (payload.dataConfig ?? null) as never,
    calendarAvailabilityConfig: payload.calendarAvailabilityConfig ?? null
  }

  let inserted: typeof agentsTable.$inferSelect
  try {
    inserted = await getMigrateDb().transaction(async tx => {
      const rows = await tx.insert(agentsTable).values(insertValues).returning()
      // v1 snapshot, atomic with the agent insert.
      await recordAgentVersion(tx as unknown as Db, rows[0].id, {
        source: 'create',
        actor: user.id
      })
      return rows[0]
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to create agent'
      },
      { status: 500 }
    )
  }

  const agent = mapAgentDoc(toAgentRecord(inserted, tenantSlug))

  if (payload.fileKeys && payload.fileKeys.length > 0) {
    await createAgentFilesAndTriggerProcessing({
      agentId: agent.id,
      tenantId,
      userId: user.id,
      fileKeys: payload.fileKeys
    })
  }

  return NextResponse.json({ agent })
}
