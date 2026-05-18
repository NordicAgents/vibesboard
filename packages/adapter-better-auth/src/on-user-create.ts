import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { createMigrateClient } from '@vibesboard/adapter-postgres/client'
import { tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'

/**
 * After-create hook. Better Auth has just inserted a new `users` row.
 * Auto-create a personal tenant + TENANT_ADMIN tenant_members row so the
 * user lands in a usable workspace on first sign-in.
 *
 * Idempotent: if the user already has any tenant_members row (retry after
 * partial failure), do nothing. Uses the migrate client (BYPASSRLS) because
 * at this point the auth flow has no tenant context to set.
 */
export async function onUserCreateAfter(
  user: { id: string; email: string; name?: string | null },
): Promise<void> {
  const db = createMigrateClient()

  const existing = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1)
  if (existing.length > 0) return

  // Slug from email local-part with collision suffix.
  const base = user.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 32) || 'workspace'

  let slug = base
  let suffix = 0
  while (suffix < 100) {
    const collision = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
    if (collision.length === 0) break
    suffix++
    slug = `${base}-${suffix}`
  }

  const tenantId = uuidv7()
  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: user.name ?? `${user.email.split('@')[0]}'s workspace`,
      slug,
      createdBy: user.id,
      isPersonal: true,
    })
    await tx.insert(tenantMembers).values({
      tenantId,
      userId: user.id,
      role: 'TENANT_ADMIN',
    })
  })
}
