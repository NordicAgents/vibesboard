import { COMPLETION_MARKERS } from './prompts'

export type CompletionReason =
  | 'collection_complete'
  | 'info_complete'
  | 'handoff_to_human'
  | 'handoff_to_agent'
  | 'max_responses'
  | 'max_messages' // backward compat
  | null

const SUGGESTIONS_MARKER_REGEX = /<!--SUGGESTIONS:(\{[\s\S]*?\})-->/g
const HANDOFF_TO_AGENT_REGEX = /\[HANDOFF_TO_AGENT:([a-zA-Z0-9_-]+)\]/

/**
 * Detects completion markers in text and returns the reason
 */
export function detectCompletionMarker(text: string): CompletionReason {
  if (text.includes(COMPLETION_MARKERS.COLLECTION_COMPLETE)) {
    return 'collection_complete'
  }
  if (text.includes(COMPLETION_MARKERS.INFO_COMPLETE)) {
    return 'info_complete'
  }
  if (text.includes(COMPLETION_MARKERS.HANDOFF_TO_HUMAN)) {
    return 'handoff_to_human'
  }
  if (HANDOFF_TO_AGENT_REGEX.test(text)) {
    return 'handoff_to_agent'
  }
  return null
}

/**
 * Extracts the target agent ID from a [HANDOFF_TO_AGENT:id] marker.
 * Returns null if no marker is found.
 */
export function extractHandoffTarget(text: string): string | null {
  const match = text.match(HANDOFF_TO_AGENT_REGEX)
  return match ? match[1] : null
}

/**
 * Strips completion markers from text
 */
export function stripCompletionMarkers(text: string): string {
  return text
    .replace(COMPLETION_MARKERS.COLLECTION_COMPLETE, '')
    .replace(COMPLETION_MARKERS.INFO_COMPLETE, '')
    .replace(COMPLETION_MARKERS.HANDOFF_TO_HUMAN, '')
    .replace(HANDOFF_TO_AGENT_REGEX, '')
    .replace(SUGGESTIONS_MARKER_REGEX, '')
    .trim()
}

/**
 * Creates a TransformStream that buffers the entire response,
 * strips completion markers, and appends completion metadata.
 *
 * When a handoff_to_agent marker is detected, it also emits
 * AGENT_HANDOFF metadata with the target agent info.
 */
export function createCompletionTransformStream(
  maxResponses?: number | null,
  currentResponseCount?: number,
  handoffTargetNames?: Record<string, string>
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let held = ''
  // Hold back enough chars to cover the longest marker ([COLLECTION_COMPLETE] = 21 chars)
  const HOLD_BACK = 30

  return new TransformStream({
    transform(chunk, controller) {
      // Decode and buffer the chunk
      const text = decoder.decode(chunk, { stream: true })
      buffer += text
      held += text

      // Release everything except the last HOLD_BACK chars to prevent
      // completion markers from flashing on the client during streaming
      if (held.length > HOLD_BACK) {
        const toRelease = held.slice(0, held.length - HOLD_BACK)
        controller.enqueue(encoder.encode(toRelease))
        held = held.slice(held.length - HOLD_BACK)
      }
    },
    flush(controller) {
      // After stream completes, check for completion markers
      const completionReason = detectCompletionMarker(buffer)

      // Release the held tail, stripped of any completion markers
      if (held) {
        const cleanedHeld = stripCompletionMarkers(held)
        if (cleanedHeld) {
          controller.enqueue(encoder.encode(cleanedHeld))
        }
      }

      // Check max responses threshold
      const maxResponsesReached =
        maxResponses && currentResponseCount && currentResponseCount >= maxResponses

      // Emit handoff metadata if an agent-to-agent handoff is detected
      if (completionReason === 'handoff_to_agent') {
        const targetId = extractHandoffTarget(buffer)
        if (targetId) {
          const meta = {
            targetAgentId: targetId,
            targetAgentName: handoffTargetNames?.[targetId] ?? targetId
          }
          const handoffStr = `\n<!--AGENT_HANDOFF:${JSON.stringify(meta)}-->`
          controller.enqueue(encoder.encode(handoffStr))
        }
      }

      // Emit completion metadata — at most ONE CHAT_COMPLETE block.
      // LLM completion reason takes priority over max_responses.
      const effectiveReason = completionReason || (maxResponsesReached ? 'max_responses' : null)
      if (effectiveReason) {
        const metadata = {
          chatComplete: effectiveReason !== 'handoff_to_agent',
          reason: effectiveReason
        }
        const metadataStr = `\n<!--CHAT_COMPLETE:${JSON.stringify(metadata)}-->`
        controller.enqueue(encoder.encode(metadataStr))
      }
    }
  })
}

/**
 * Wraps a ReadableStream to transform completion markers
 */
export function wrapStreamWithCompletionDetection(
  stream: ReadableStream<Uint8Array>,
  maxResponses?: number | null,
  currentResponseCount?: number,
  handoffTargetNames?: Record<string, string>
): ReadableStream<Uint8Array> {
  const transformStream = createCompletionTransformStream(
    maxResponses,
    currentResponseCount,
    handoffTargetNames
  )
  return stream.pipeThrough(transformStream)
}
