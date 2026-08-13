import { HybridEngram } from '@vibesboard/hybrid-memory'
import { PostgresHybridStore } from '@vibesboard/hybrid-memory/adapters/postgres'
import { OpenAILLMProvider, OpenAIEmbedder } from '@vibesboard/hybrid-memory/adapters/openai'
import type { EngineContext } from '@vibesboard/hybrid-memory'

const RECALL_TIMEOUT_MS = 5_000

function createEngine(db: any): HybridEngram {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  return new HybridEngram({
    store: new PostgresHybridStore(db),
    llm: new OpenAILLMProvider({ apiKey }),
    embedder: new OpenAIEmbedder({ apiKey }),
    options: { autoApprove: false, cooldownMs: 2 * 60 * 60 * 1000 },
  })
}

/**
 * Recall memories relevant to a query — never throws, returns '' on error or timeout.
 */
export async function recallMemory(
  db: any,
  query: string,
  ctx: EngineContext,
): Promise<string> {
  try {
    const engine = createEngine(db)
    const result = await Promise.race([
      engine.recall(query, ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('recall timeout')), RECALL_TIMEOUT_MS),
      ),
    ])
    return result.contextBlock ?? ''
  } catch {
    return ''
  }
}

/**
 * Ingest a message into memory — fire-and-forget, never throws.
 */
export function ingestMemory(
  db: any,
  messageId: string,
  content: string,
  ctx: EngineContext,
): void {
  const engine = createEngine(db)
  engine.ingest(messageId, content, ctx).catch(() => {})
}

/**
 * Run Stage 1 observation formation across all memory-enabled agents.
 * Called by the cron job.
 */
export async function runMemoryObserve(db: any): Promise<{ processed: number }> {
  try {
    const engine = createEngine(db)
    const results = await engine.observe()
    return { processed: results.reduce((n, r) => n + r.extracted, 0) }
  } catch {
    return { processed: 0 }
  }
}

/**
 * Run Stage 2 reconciliation across all pending observations.
 * Called by the cron job.
 */
export async function runMemoryReconcile(db: any): Promise<{ processed: number; mutated: number }> {
  try {
    const engine = createEngine(db)
    const result = await engine.reconcile()
    return { processed: result.processed, mutated: result.mutated }
  } catch {
    return { processed: 0, mutated: 0 }
  }
}
