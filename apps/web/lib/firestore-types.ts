// Re-export shim — the real types now live in @vibesboard/contracts.
// This file stays as a stable import path during the monorepo migration
// (Phases 1-11) and gets deleted in Phase 12.
//
// See docs/superpowers/specs/2026-05-16-monorepo-split-design.md.
export * from '@vibesboard/contracts'
