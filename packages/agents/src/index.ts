// @vibesboard/agents — agent CRUD, hooks, permissions, notifications,
// limits, conversation lifecycle.
//
// Companion to @vibesboard/ai (the runtime). agents/ holds the data-shape
// layer that the runtime invokes (db.ts, schema.ts, conversations.ts,
// permissions.ts) plus the lifecycle code that doesn't belong inside the
// completion loop (hooks.ts, hook-jobs.ts, notifications.ts).
//
// Subpath exports are open (`./*` and `./*.ts`) — same pattern as
// @vibesboard/ai. Shims in apps/web/lib/agents/ resolve through here.

export {}
