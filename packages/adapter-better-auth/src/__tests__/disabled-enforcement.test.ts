import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import { users } from '@vibesboard/adapter-postgres/schema';
import { isUserDisabled } from '../risc-effects.ts';

describe('isUserDisabled', () => {
  it('true for a disabled user, false otherwise, false for missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = randomUUID();
      await adminDb
        .insert(users)
        .values({ id, email: `u${id}@a.com`, name: 'U', disabled: true });
      expect(await isUserDisabled(id, adminDb)).toBe(true);
      await adminDb.update(users).set({ disabled: false }).where(eq(users.id, id));
      expect(await isUserDisabled(id, adminDb)).toBe(false);
      expect(await isUserDisabled(randomUUID(), adminDb)).toBe(false);
    });
  });
});
