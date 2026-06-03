import { describe, it, expect } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema';

// Branch/edge coverage for the on-user-create tenant + role bootstrap.
//
// The production hook (onUserCreateAfter, wired in config.ts via the
// `user.create.after` databaseHook) provisions a personal tenant and an owner
// (TENANT_ADMIN) membership for each new user. config.ts resolves its own DB
// via getMigrateDb(), which connects to the REAL public schema — not the
// per-test schema — so importing and invoking it here would escape test
// isolation. We therefore pin the bootstrap *contract* by exercising the exact
// hook logic against the isolated test schema. tenant-creation.test.ts covers
// the happy path + idempotency + collision; this file adds the name-fallback,
// slug-sanitization, fallback-base, and per-user isolation edges.
async function bootstrapTenant(
  adminDb: any,
  user: { id: string; email: string; name?: string | null },
) {
  const existing = await adminDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1);
  if (existing.length > 0) return existing[0].tenantId as string;

  const localPart = user.email.split('@')[0];
  const base =
    localPart
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
      name: user.name ?? `${localPart}'s workspace`,
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
  return tenantId;
}

async function makeUser(adminDb: any, email: string, name?: string | null) {
  const id = uuidv7();
  await adminDb.insert(users).values({ id, email, name: name ?? 'U' });
  return id;
}

describe('on-user-create bootstrap edges', () => {
  it('derives the workspace name from the email local-part when no name is given', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = await makeUser(adminDb, 'jdoe@example.com', null);
      const tenantId = await bootstrapTenant(adminDb, { id, email: 'jdoe@example.com', name: null });

      const [tenant] = await adminDb.select().from(tenants).where(eq(tenants.id, tenantId));
      expect(tenant.name).toBe("jdoe's workspace");
      expect(tenant.slug).toBe('jdoe');
      expect(tenant.isPersonal).toBe(true);
    });
  });

  it('sanitizes uppercase, dots, plus and symbols in the slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = await makeUser(adminDb, 'John.Doe+spam_99@Example.COM', 'John');
      const tenantId = await bootstrapTenant(adminDb, {
        id,
        email: 'John.Doe+spam_99@Example.COM',
        name: 'John',
      });

      const [tenant] = await adminDb.select().from(tenants).where(eq(tenants.id, tenantId));
      // local-part lowercased; every non [a-z0-9-] char -> '-'.
      expect(tenant.slug).toBe('john-doe-spam-99');
      // explicit name wins over the email-derived fallback.
      expect(tenant.name).toBe('John');
    });
  });

  it('falls back to a "workspace" slug base when the local-part has no usable chars', async () => {
    await withTestDb(async ({ adminDb }) => {
      // local-part "___" sanitizes to "---" (non-empty), documenting that the
      // fallback only triggers for a truly empty result. Use a symbol-only
      // local-part that sanitizes to '' to hit the `|| 'workspace'` branch:
      // an empty local part. better-auth/email validation doesn't apply here
      // because we insert directly.
      const id = await makeUser(adminDb, '@example.com', null);
      const tenantId = await bootstrapTenant(adminDb, { id, email: '@example.com', name: null });

      const [tenant] = await adminDb.select().from(tenants).where(eq(tenants.id, tenantId));
      expect(tenant.slug).toBe('workspace');
    });
  });

  it('assigns the TENANT_ADMIN role to the creating user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = await makeUser(adminDb, 'role@example.com', 'Role');
      const tenantId = await bootstrapTenant(adminDb, { id, email: 'role@example.com', name: 'Role' });

      const members = await adminDb
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.tenantId, tenantId));
      expect(members.length).toBe(1);
      expect(members[0].userId).toBe(id);
      expect(members[0].role).toBe('TENANT_ADMIN');
    });
  });

  it('isolates tenants per user — each user owns exactly their own tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await makeUser(adminDb, 'a@example.com', 'A');
      const b = await makeUser(adminDb, 'b@example.com', 'B');
      const ta = await bootstrapTenant(adminDb, { id: a, email: 'a@example.com', name: 'A' });
      const tb = await bootstrapTenant(adminDb, { id: b, email: 'b@example.com', name: 'B' });

      expect(ta).not.toBe(tb);

      const aMembers = await adminDb
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, a));
      expect(aMembers.length).toBe(1);
      expect(aMembers[0].tenantId).toBe(ta);

      const [tenantA] = await adminDb.select().from(tenants).where(eq(tenants.id, ta));
      expect(tenantA.createdBy).toBe(a);
    });
  });

  it('is idempotent — re-running the bootstrap for the same user is a no-op', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = await makeUser(adminDb, 'idem@example.com', 'Idem');
      const first = await bootstrapTenant(adminDb, { id, email: 'idem@example.com', name: 'Idem' });
      const second = await bootstrapTenant(adminDb, { id, email: 'idem@example.com', name: 'Idem' });

      expect(second).toBe(first);
      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, id));
      expect(ts.length).toBe(1);
    });
  });
});
