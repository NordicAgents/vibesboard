import type { Embedder } from '../interfaces/embedder.ts'
import type { HybridStore } from '../interfaces/store.ts'
import type { EngineContext } from '../types.ts'

/**
 * Indiscriminate capture — embed every message asynchronously.
 * Cheap, non-blocking, forms the evidence base for Stage 2 reconciliation.
 */
export async function captureMessage(
  messageId: string,
  content: string,
  ctx: EngineContext,
  deps: { embedder: Embedder; store: HybridStore },
): Promise<void> {
  const embedding = await deps.embedder.embed(content)
  await deps.store.saveMessageEmbedding(messageId, content, embedding, ctx)
}
