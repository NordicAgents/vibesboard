// IDataStore — the abstraction every feature package uses for persistence.
// Implemented on top of Postgres (Drizzle) via the adapter packages; the
// same surface can back future adapters.
//
// Kept minimal in Phase 1. Methods get added by the adapter PR that needs
// them — design by demand, not by speculation.

export interface IDataStore {
  /** Reserved for adapter-specific extensions. */
  readonly kind: string
}
