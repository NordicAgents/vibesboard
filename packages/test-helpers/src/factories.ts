// Seed factories for integration tests.
//
// These insert minimal valid rows using the BYPASSRLS admin connection
// (`adminDb` from withTestDb). They return the generated ids so tests can wire
// up relationships. Columns mirror the Drizzle schema in
// packages/adapter-postgres/src/schema. Pass overrides to customise any field.
import { uuidv7 } from 'uuidv7'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'

// `adminDb` is the Drizzle client from withTestDb; typed loosely to avoid
// coupling the helpers package to drizzle generics.
type AdminDb = any

export interface SeededUser {
  userId: string
  email: string
}

export async function seedUser(
  adminDb: AdminDb,
  overrides: Partial<{ id: string; email: string; name: string; isSuperAdmin: boolean }> = {},
): Promise<SeededUser> {
  const id = overrides.id ?? uuidv7()
  const email = overrides.email ?? `user-${id}@test.local`
  await adminDb.insert(users).values({
    id,
    email,
    name: overrides.name ?? 'Test User',
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  })
  return { userId: id, email }
}

export interface SeededTenant {
  tenantId: string
  slug: string
  createdBy: string
}

export async function seedTenant(
  adminDb: AdminDb,
  overrides: Partial<{
    id: string
    name: string
    slug: string
    createdBy: string
    isPersonal: boolean
  }> = {},
): Promise<SeededTenant> {
  const createdBy = overrides.createdBy ?? (await seedUser(adminDb)).userId
  const id = overrides.id ?? uuidv7()
  const slug = overrides.slug ?? `tenant-${id}`.slice(0, 40)
  await adminDb.insert(tenants).values({
    id,
    name: overrides.name ?? 'Test Tenant',
    slug,
    createdBy,
    isPersonal: overrides.isPersonal ?? false,
  })
  return { tenantId: id, slug, createdBy }
}

export interface SeededAgent {
  agentId: string
  tenantId: string
  userId: string
  slug: string
}

export async function seedAgent(
  adminDb: AdminDb,
  overrides: Partial<{
    id: string
    tenantId: string
    userId: string
    name: string
    slug: string
    instructions: string
  }> = {},
): Promise<SeededAgent> {
  let tenantId = overrides.tenantId
  let userId = overrides.userId
  if (!tenantId) {
    const t = await seedTenant(adminDb)
    tenantId = t.tenantId
    userId = userId ?? t.createdBy
  }
  if (!userId) userId = (await seedUser(adminDb)).userId
  const id = overrides.id ?? uuidv7()
  const slug = overrides.slug ?? `agent-${id}`.slice(0, 40)
  await adminDb.insert(agents).values({
    id,
    tenantId,
    userId,
    name: overrides.name ?? 'Test Agent',
    slug,
    instructions: overrides.instructions ?? '',
  })
  return { agentId: id, tenantId, userId, slug }
}

/** Convenience: a full tenant + owner + agent in one call. */
export async function seedTenantWithAgent(adminDb: AdminDb): Promise<{
  userId: string
  tenantId: string
  agentId: string
}> {
  const user = await seedUser(adminDb)
  const tenant = await seedTenant(adminDb, { createdBy: user.userId })
  const agent = await seedAgent(adminDb, {
    tenantId: tenant.tenantId,
    userId: user.userId,
  })
  return { userId: user.userId, tenantId: tenant.tenantId, agentId: agent.agentId }
}
