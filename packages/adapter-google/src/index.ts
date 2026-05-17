// @vibesboard/adapter-google — Google-API touchpoints.
//
// Phase 5 only wraps RISC (Cross-Account Protection) token handling. Google
// Calendar OAuth and the calendar provider live under apps/web/lib/scheduling
// today; they move into the scheduling feature package in Phase 9, and the
// pure-OAuth pieces can land here as additional subpath exports at that
// point (e.g. './calendar', './oauth').

export * from './risc.ts'
