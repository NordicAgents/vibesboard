// Re-export shim — real implementation in @vibesboard/scheduling.
// Uses the './oauth-return' subpath to avoid pulling server-only modules
// (connections.ts -> firebase-admin -> google-auth-library) into client
// bundles, since this file is imported by client components.
// Deleted in Phase 12.
export * from '@vibesboard/scheduling/oauth-return'
