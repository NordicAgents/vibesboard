#!/usr/bin/env node
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from './schema/index.ts'

// Promote a user to platform super admin by flipping users.is_super_admin.
// There is deliberately no API/UI for this (bootstrap-only privilege), so this
// script is the supported way to create the first — or any — super admin.
//
// Usage:
//   bun run db:make-admin you@example.com            # grant (default)
//   bun run db:make-admin you@example.com --revoke   # revoke

async function main() {
  const args = process.argv.slice(2)
  const revoke = args.includes('--revoke')
  const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase()

  if (!email) {
    console.error('[make-admin] Usage: bun run db:make-admin <email> [--revoke]')
    process.exit(1)
  }

  // Use the migrate role: it bypasses RLS and owns the users table.
  const url =
    process.env.DATABASE_MIGRATE_URL ??
    'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'
  const client = postgres(url, { max: 1, prepare: false })
  const db = drizzle(client, { schema })

  try {
    const updated = await db
      .update(schema.users)
      .set({ isSuperAdmin: !revoke })
      .where(eq(schema.users.email, email))
      .returning({ email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin })

    if (updated.length === 0) {
      console.error(
        `[make-admin] No user found with email "${email}". ` +
          'They must sign up first, then re-run this command.',
      )
      process.exit(1)
    }

    const verb = revoke ? 'Revoked super admin from' : 'Granted super admin to'
    console.log(`[make-admin] ${verb} ${updated[0].email} (is_super_admin=${updated[0].isSuperAdmin}).`)
  } finally {
    await client.end({ timeout: 1 })
  }
}

main().catch((err) => {
  console.error('[make-admin] Failed:', err)
  process.exit(1)
})
