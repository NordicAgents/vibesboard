import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATE_URL ?? 'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev',
  },
  strict: true,
  verbose: true,
})
