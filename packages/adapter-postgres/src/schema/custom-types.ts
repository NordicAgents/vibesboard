import { customType } from 'drizzle-orm/pg-core'

// tsvector — Postgres full-text search type. Drizzle has no built-in; we read
// it as a string and write via to_tsvector() in SQL helpers. The column itself
// is populated by an UPDATE trigger or by inserts via raw SQL.
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector'
  },
})

// pgvector — Drizzle 0.36 has `vector()` built into pg-core, but we re-export
// here so schema files can import everything Drizzle-Postgres-specific from
// one module if they want to.
export { vector } from 'drizzle-orm/pg-core'
