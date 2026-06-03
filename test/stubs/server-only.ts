// Test stub for the `server-only` package.
//
// In production, `server-only` resolves (via the `react-server` export
// condition) to a no-op, and otherwise throws to prevent importing server code
// into a Client Component. Vitest does not set the `react-server` condition, so
// we alias `server-only` to this empty module in the Vitest config to let
// server modules be imported directly in tests.
export {}
