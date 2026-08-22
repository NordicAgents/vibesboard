// @vibesboard/ai — agent runtime, completion loop, tool execution,
// retrieval-augmented chat. The biggest package by file count (~31 files).
//
// Forms a tight cycle with @vibesboard/agents (CRUD + hooks) and
// @vibesboard/retrieval (RAG). The three landed as a single atomic
// commit (Phase 6.4) because each contains imports the others need.
//
// Subpath exports are open (`./*` and `./*.ts`) so consumers can import
// individual files via either '@vibesboard/ai/runtime' or
// '@vibesboard/ai/runtime.ts'. The shim layer in apps/web/lib/agent/
// uses these subpaths.
//
// Default barrel intentionally empty — the surface is too large to
// re-export everything cleanly. Consumers always use subpath imports.

export {}
