/**
 * Embedder interface — bring your own embedding model.
 * text-embedding-3-small, voyage-3, Ollama nomic-embed-text — all work.
 */
export interface Embedder {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}
