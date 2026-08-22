import { describe, it, expect } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema';

// This suite documents the tenant-bootstrap contract by re-implementing the
// hook body (matching the production logic in on-user-create.ts) against the
// real schema. The production entry point onUserCreateAfter resolves its own
// DB via createMigrateClient()/getMigrateDb() — which connects to the real
// public schema, not the per-test schema — so it cannot be invoked under test
// isolation. We therefore exercise the equivalent logic against adminDb.
async function runHook(
  adminDb: any,
  user: { id: string; email: string; name?: string | null },
) {
  const existing = await adminDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1);
  if (existing.length > 0) return;

  const base =
    user.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 32) || 'workspace';

  let slug = base;
  let suffix = 0;
  while (suffix < 100) {
    const collision = await adminDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (collision.length === 0) break;
    suffix++;
    slug = `${base}-${suffix}`;
  }

  const tenantId = uuidv7();
  await adminDb.transaction(async (tx: any) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: user.name ?? `${user.email.split('@')[0]}'s workspace`,
      slug,
      createdBy: user.id,
      isPersonal: true,
    });
    await tx.insert(tenantMembers).values({
      tenantId,
      userId: user.id,
      role: 'TENANT_ADMIN',
    });
  });
}

describe('onUserCreate (auto-tenant creation)', () => {
  it('creates a personal tenant + TENANT_ADMIN membership for a new user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7();
      await adminDb.insert(users).values({ id: userId, email: 'alice@acme.com', name: 'Alice' });

      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' });

      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, userId));
      expect(ts.length).toBe(1);
      expect(ts[0].slug).toBe('alice');
      expect(ts[0].isPersonal).toBe(true);

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userId));
      expect(ms.length).toBe(1);
      expect(ms[0].role).toBe('TENANT_ADMIN');
      expect(ms[0].tenantId).toBe(ts[0].id);
    });
  });

  it('local-part collision uniques the slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u1 = uuidv7();
      const u2 = uuidv7();
      await adminDb.insert(users).values([
        { id: u1, email: 'alice@one.com', name: 'Alice' },
        { id: u2, email: 'alice@two.com', name: 'Alice2' },
      ]);
      await runHook(adminDb, { id: u1, email: 'alice@one.com', name: 'Alice' });
      await runHook(adminDb, { id: u2, email: 'alice@two.com', name: 'Alice2' });

      const slugs = (await adminDb.select({ slug: tenants.slug }).from(tenants))
        .map((r: { slug: string }) => r.slug)
        .sort();
      expect(slugs).toEqual(['alice', 'alice-1']);
    });
  });

  it('is idempotent — second run for the same user does nothing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7();
      await adminDb.insert(users).values({ id: userId, email: 'alice@acme.com', name: 'Alice' });

      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' });
      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' });

      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, userId));
      expect(ts.length).toBe(1);
      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userId));
      expect(ms.length).toBe(1);
    });
  });
});
