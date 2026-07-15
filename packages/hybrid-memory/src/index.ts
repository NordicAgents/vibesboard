// ─── Main engine ──────────────────────────────────────────────────────────────
export { HybridEngram } from './engine.ts'
export type { HybridEngramConfig } from './engine.ts'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  HybridMemory,
  NewHybridMemory,
  Observation,
  NewObservation,
  ObservationStatus,
  MemoryMutation,
  PendingMutation,
  MutationOperation,
  MutationApprover,
  MutationStatus,
  RecallResult,
  EngineContext,
  HybridEngramOptions,
  PresenceClass,
  MemoryScope,
  MemoryCategory,
  ConversationRef,
  MessageChunk,
} from './types.ts'

// ─── Interfaces (implement these for your backend) ────────────────────────────
export type { HybridStore, MemoryFilter, MutationFilter } from './interfaces/store.ts'
export type { LLMProvider, LLMOptions } from './interfaces/llm.ts'
export type { Embedder } from './interfaces/embedder.ts'

// ─── Built-in stores ──────────────────────────────────────────────────────────
export { InMemoryHybridStore } from './stores/in-memory.ts'

// ─── Utilities (for custom integrations) ─────────────────────────────────────
export { serializeTreeToC } from './serializer.ts'
export { runObservationFormation } from './pipeline/observe.ts'
export { runReconciliation } from './pipeline/reconcile.ts'
