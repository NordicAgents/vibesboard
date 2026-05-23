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

/**
 * Create a team (non-personal) workspace and make the creator TENANT_ADMIN.
 * Identity-adjacent: callers pass a BYPASSRLS migrate client because there is
 * no tenant GUC context at workspace-creation time.
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
      createdBy: row.createdBy as string,
      isPersonal: row.isPersonal,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  }
}
