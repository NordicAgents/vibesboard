import { COMPLETION_MARKERS } from './prompts'

export type CompletionReason =
  | 'collection_complete'
  | 'info_complete'
  | 'max_messages'
  | null

const SUGGESTIONS_MARKER_REGEX = /<!--SUGGESTIONS:(\{[\s\S]*?\})-->/g

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
  return null
}

/**
 * Strips completion markers from text
 */
export function stripCompletionMarkers(text: string): string {
  return text
    .replace(COMPLETION_MARKERS.COLLECTION_COMPLETE, '')
    .replace(COMPLETION_MARKERS.INFO_COMPLETE, '')
    .replace(SUGGESTIONS_MARKER_REGEX, '')
    .trim()
}

/**
 * Creates a TransformStream that buffers the entire response,
 * strips completion markers, and appends completion metadata
 */
export function createCompletionTransformStream(
  maxMessages?: number | null,
  currentMessageCount?: number
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new TransformStream({
    transform(chunk, controller) {
      // Decode and buffer the chunk
      buffer += decoder.decode(chunk, { stream: true })

      // Stream the chunk as-is for now (we'll handle markers at flush)
      controller.enqueue(chunk)
    },
    flush(controller) {
      // After stream completes, check for completion markers
      const completionReason = detectCompletionMarker(buffer)

      // Check max messages threshold
      const maxMessagesReached =
        maxMessages && currentMessageCount && currentMessageCount >= maxMessages

      // If there's a completion signal, append metadata
      if (completionReason || maxMessagesReached) {
        const metadata = {
          chatComplete: true,
          reason: completionReason || 'max_messages'
        }
        // Append a special delimiter and metadata
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
  maxMessages?: number | null,
  currentMessageCount?: number
): ReadableStream<Uint8Array> {
  const transformStream = createCompletionTransformStream(
    maxMessages,
    currentMessageCount
  )
  return stream.pipeThrough(transformStream)
}
