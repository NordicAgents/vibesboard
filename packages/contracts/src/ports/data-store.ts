// IDataStore — the abstraction every feature package uses for persistence.
// Phase 3 (adapter-firebase) implements this on top of Firestore; future
// adapters (Supabase, Postgres, ...) implement the same surface.
//
// Kept minimal in Phase 1. Methods get added by the adapter PR that needs
// them — design by demand, not by speculation.

export interface IDataStore {
  /** Reserved for adapter-specific extensions. */
  readonly kind: string
}
