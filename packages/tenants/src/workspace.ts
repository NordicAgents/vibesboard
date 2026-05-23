import { uuidv7 } from 'uuidv7'
import { and, eq, count } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/** Maximum non-personal workspaces a user can create. */
export const MAX_TEAM_WORKSPACES = 5

export interface CreateTeamWorkspaceInput {
  userId: string
  name: string
  slug: string
}

export interface CreatedTenant {
  id: string
  name: string
  slug: string
  status: string
  createdBy: string
  isPersonal: boolean
  createdAt: string
  updatedAt: string
}

export type CreateTeamWorkspaceResult =
  | { ok: true; tenant: CreatedTenant }
  | { ok: false; code: 'LIMIT' | 'SLUG_TAKEN' }

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505'
}

/**
 * Create a team (non-personal) workspace and make the creator TENANT_ADMIN.
 * Identity-adjacent: callers pass a BYPASSRLS migrate client because there is
 * no tenant GUC context at workspace-creation time.
 *
 * The caller is responsible for ensuring `input.userId` references an existing
 * user — a non-existent user id will surface as a thrown FK error, not a typed
 * result.
 */
export async function createTeamWorkspace(
  db: Db,
  input: CreateTeamWorkspaceInput,
): Promise<CreateTeamWorkspaceResult> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(and(eq(tenantMembers.userId, input.userId), eq(tenants.isPersonal, false)))
  if (Number(n) >= MAX_TEAM_WORKSPACES) {
    return { ok: false, code: 'LIMIT' }
  }

  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, input.slug))
    .limit(1)
  if (existing.length > 0) {
    return { ok: false, code: 'SLUG_TAKEN' }
  }

  const tenantId = uuidv7()
  try {
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(tenants)
        .values({
          id: tenantId,
          name: input.name,
          slug: input.slug,
          status: 'pending',
          createdBy: input.userId,
          isPersonal: false,
        })
        .returning()
      await tx.insert(tenantMembers).values({
        tenantId,
        userId: input.userId,
        role: 'TENANT_ADMIN',
      })
      return inserted[0]
    })

    return {
      ok: true,
      tenant: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        createdBy: row.createdBy ?? input.userId,
        isPersonal: row.isPersonal,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, code: 'SLUG_TAKEN' }
    }
    throw err
  }
}
