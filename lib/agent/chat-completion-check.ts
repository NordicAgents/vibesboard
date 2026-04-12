/**
 * Pure-logic functions for client-side chat completion detection.
 *
 * Extracted from AgentChat component to enable testing without a React
 * rendering environment. The component delegates to these functions.
 */

// Completion signal markers (must match server-side and agent-chat.tsx)
const COMPLETION_MARKERS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]',
  CHAT_COMPLETE_REGEX: /<!--CHAT_COMPLETE:(\{.*?\})-->/
}

interface MinimalMessage {
  id: string
  role: string
  content: string
}

export interface CompletionCheckParams {
  messages: MinimalMessage[]
  isAgentDisabled: boolean
  /** Current value from the synchronous ref (not React state) */
  remainingResponses: number | null
  isCorrecting: boolean
}

export interface CompletionCheckResult {
  shouldComplete: boolean
  shouldClearCorrecting: boolean
}

/**
 * Determines whether the chat should be marked as complete.
 *
 * This is the pure-logic core of the checkForCompletion callback
 * in AgentChat. It reads remainingResponses synchronously (via ref)
 * and respects the isCorrecting guard.
 */
export function checkCompletion(params: CompletionCheckParams): CompletionCheckResult {
  const { messages, isAgentDisabled, remainingResponses, isCorrecting } = params

  if (isAgentDisabled) {
    return { shouldComplete: true, shouldClearCorrecting: false }
  }

  // During correction flow, skip the remaining-responses check —
  // only re-complete when the LLM emits a fresh completion marker.
  if (!isCorrecting && remainingResponses !== null && remainingResponses <= 0) {
    return { shouldComplete: true, shouldClearCorrecting: false }
  }

  const lastAssistantMessage = [...messages]
    .reverse()
    .find(m => m.role === 'assistant')

  if (lastAssistantMessage?.content) {
    const content = lastAssistantMessage.content
    if (
      content.includes(COMPLETION_MARKERS.COLLECTION_COMPLETE) ||
      content.includes(COMPLETION_MARKERS.INFO_COMPLETE) ||
      COMPLETION_MARKERS.CHAT_COMPLETE_REGEX.test(content)
    ) {
      // Check if CHAT_COMPLETE has chatComplete: false (agent handoff)
      const chatCompleteMatch = content.match(COMPLETION_MARKERS.CHAT_COMPLETE_REGEX)
      if (chatCompleteMatch) {
        try {
          const meta = JSON.parse(chatCompleteMatch[1])
          if (meta.chatComplete === false) {
            return { shouldComplete: false, shouldClearCorrecting: false }
          }
        } catch {
          // fall through to mark complete
        }
      }
      return { shouldComplete: true, shouldClearCorrecting: true }
    }
  }

  return { shouldComplete: false, shouldClearCorrecting: false }
}

/**
 * Determines whether this is a new collector-mode conversation that should
 * start with an empty message list (so the typing indicator shows while the
 * LLM generates the combined greeting + first question).
 */
export function isNewCollectorConversation(
  mode: string | undefined,
  initialConversationId: string | undefined,
  initialMessages: MinimalMessage[] | undefined
): boolean {
  return (
    mode === 'collector' &&
    !initialConversationId &&
    (!initialMessages || initialMessages.length === 0)
  )
}
