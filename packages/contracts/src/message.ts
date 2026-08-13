/**
 * Shared chat message type used across server routes and components.
 *
 * This used to be `export type { Message } from 'ai'`. AI SDK v5 removed that
 * export — the UI-facing message became `UIMessage`, which carries a `parts`
 * array instead of a `content` string — so once this package moved to
 * `ai@^7`, the re-export stopped resolving.
 *
 * Aliasing `Message` to `UIMessage` would not have been a fix: roughly sixty
 * call sites read `message.content`, and `apps/web/lib/hooks/use-compat-chat.ts`
 * exists specifically to translate between this shape and the SDK's. That hook
 * is the single place that talks to the SDK's types; everything else speaks
 * this contract.
 *
 * So the shape is declared here rather than borrowed. It is the app's own
 * contract, and pinning it means an SDK major no longer reaches every consumer
 * of a chat message.
 */
export interface Message {
  id: string
  role: 'system' | 'user' | 'assistant' | 'data'
  /** Plain text. `use-compat-chat` flattens SDK `parts` into this. */
  content: string
  createdAt?: Date
  /**
   * Present on messages that came straight from the SDK before normalisation.
   * Prefer `content`; this is here so such values still satisfy the type.
   */
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>
}
