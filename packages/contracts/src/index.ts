// @vibesboard/contracts — pure TypeScript types and port interfaces.
//
// Three things live here:
//   1. Domain types  — Agent, Conversation, TenantDocument, Message, ...
//      Anyone in the monorepo can import these without picking up AI-SDK
//      runtime dependencies. (We do `import type` from those SDKs for
//      a couple of structural types; consumers never carry the runtime.)
//   2. Port interfaces — IDataStore, IAuth, IStorage, IAIProvider, ...
//      Feature packages declare what they need; adapters implement them.
//   3. Re-exports — index.ts is a barrel; nothing else.
//
// See docs/superpowers/specs/2026-05-16-monorepo-split-design.md.

export * from './domain-types.ts'
export * from './types.ts'
export type { Message } from './message.ts'

export * from './ports/index.ts'
