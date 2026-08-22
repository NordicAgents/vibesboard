import { COMPLETION_MARKERS } from './prompts.ts'

export type CompletionReason =
  | 'collection_complete'
  | 'info_complete'
  | 'handoff_to_human'
  | 'handoff_to_agent'
  | 'max_responses'
  | 'max_messages' // backward compat
  | null

const SUGGESTIONS_MARKER_REGEX = /<!--SUGGESTIONS:\s*(\{[\s\S]*?\})-->/g
const HANDOFF_TO_AGENT_REGEX = /\[HANDOFF_TO_AGENT:([a-zA-Z0-9_-]+)\]/
const CHAT_COMPLETE_MARKER_REGEX =
  /<!--CHAT_COMPLETE:\s*(\{[\s\S]*?\})\s*-->/g
const CHAT_COMPLETE_START = '<!--CHAT_COMPLETE:'

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
  const chatCompleteMatch = text.match(CHAT_COMPLETE_MARKER_REGEX)
  if (chatCompleteMatch) {
    try {
      const metadata = JSON.parse(
        chatCompleteMatch[0].match(
          /<!--CHAT_COMPLETE:\s*(\{[\s\S]*?\})\s*-->/
        )?.[1] ?? ''
      ) as { chatComplete?: boolean; reason?: CompletionReason }
      if (
        metadata.chatComplete !== false &&
        metadata.reason &&
        metadata.reason !== 'handoff_to_agent'
      ) {
        return metadata.reason
      }
    } catch {
      // Ignore malformed model-authored metadata.
    }
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
    .replace(CHAT_COMPLETE_MARKER_REGEX, '')
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
  // Hold back enough chars to cover short markers ([COLLECTION_COMPLETE] = 21 chars).
  // SUGGESTIONS markers are open-ended in length, so we detect their start explicitly.
  const HOLD_BACK = 30
  const SUGGESTIONS_START = '<!--SUGGESTIONS:'

  return new TransformStream({
    transform(chunk, controller) {
      // Decode and buffer the chunk
      const text = decoder.decode(chunk, { stream: true })
      buffer += text
      held += text

      // If SUGGESTIONS marker has started, hold everything from that point
      // so the full (potentially long) marker can be stripped at flush time.
      const suggestionsIdx = held.indexOf(SUGGESTIONS_START)
      if (suggestionsIdx !== -1) {
        if (suggestionsIdx > 0) {
          controller.enqueue(encoder.encode(held.slice(0, suggestionsIdx)))
          held = held.slice(suggestionsIdx)
        }
        return
      }

      // Hold model-authored completion metadata until the full marker is
      // available so its opening fragment cannot leak into the response.
      const completionIdx = held.indexOf(CHAT_COMPLETE_START)
      if (completionIdx !== -1) {
        if (completionIdx > 0) {
          controller.enqueue(encoder.encode(held.slice(0, completionIdx)))
          held = held.slice(completionIdx)
        }
        return
      }

      // Otherwise, release everything except the last HOLD_BACK chars to prevent
      // short completion markers from flashing on the client during streaming.
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
        maxResponses &&
        currentResponseCount &&
        currentResponseCount >= maxResponses

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
      const effectiveReason =
        completionReason || (maxResponsesReached ? 'max_responses' : null)
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
