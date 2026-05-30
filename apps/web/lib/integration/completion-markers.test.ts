/**
 * Tests for completion marker detection and TransformStream logic.
 *
 * Pure-logic tests — no external dependencies. Constants and functions are
 * replicated inline to match @vibesboard/ai/completion (the source module
 * pulls in server-only deps not importable in a node test environment).
 */
import { describe, it, expect } from 'vitest'

const COMPLETION_MARKERS = {
  COLLECTION_COMPLETE: '[COLLECTION_COMPLETE]',
  INFO_COMPLETE: '[INFO_COMPLETE]',
  HANDOFF_TO_HUMAN: '[HANDOFF_TO_HUMAN]',
  HANDOFF_TO_AGENT_PREFIX: '[HANDOFF_TO_AGENT:'
} as const

type CompletionReason =
  | 'collection_complete'
  | 'info_complete'
  | 'handoff_to_human'
  | 'handoff_to_agent'
  | 'max_responses'
  | 'max_messages'
  | null

const SUGGESTIONS_MARKER_REGEX = /<!--SUGGESTIONS:\s*(\{[\s\S]*?\})-->/g
const HANDOFF_TO_AGENT_REGEX = /\[HANDOFF_TO_AGENT:([a-zA-Z0-9_-]+)\]/

function detectCompletionMarker(text: string): CompletionReason {
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

function extractHandoffTarget(text: string): string | null {
  const match = text.match(HANDOFF_TO_AGENT_REGEX)
  return match ? match[1] : null
}

function stripCompletionMarkers(text: string): string {
  return text
    .replace(COMPLETION_MARKERS.COLLECTION_COMPLETE, '')
    .replace(COMPLETION_MARKERS.INFO_COMPLETE, '')
    .replace(COMPLETION_MARKERS.HANDOFF_TO_HUMAN, '')
    .replace(HANDOFF_TO_AGENT_REGEX, '')
    .replace(SUGGESTIONS_MARKER_REGEX, '')
    .trim()
}

function createCompletionTransformStream(
  maxResponses?: number | null,
  currentResponseCount?: number,
  handoffTargetNames?: Record<string, string>
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let held = ''
  const HOLD_BACK = 30
  const SUGGESTIONS_START = '<!--SUGGESTIONS:'

  return new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true })
      buffer += text
      held += text

      const suggestionsIdx = held.indexOf(SUGGESTIONS_START)
      if (suggestionsIdx !== -1) {
        if (suggestionsIdx > 0) {
          controller.enqueue(encoder.encode(held.slice(0, suggestionsIdx)))
          held = held.slice(suggestionsIdx)
        }
        return
      }

      if (held.length > HOLD_BACK) {
        const toRelease = held.slice(0, held.length - HOLD_BACK)
        controller.enqueue(encoder.encode(toRelease))
        held = held.slice(held.length - HOLD_BACK)
      }
    },
    flush(controller) {
      const completionReason = detectCompletionMarker(buffer)

      if (held) {
        const cleanedHeld = stripCompletionMarkers(held)
        if (cleanedHeld) {
          controller.enqueue(encoder.encode(cleanedHeld))
        }
      }

      const maxResponsesReached =
        maxResponses &&
        currentResponseCount &&
        currentResponseCount >= maxResponses

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

function wrapStreamWithCompletionDetection(
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

function stringToStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    }
  })
}

async function consumeStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

describe('detectCompletionMarker', () => {
  it('detects [COLLECTION_COMPLETE]', () => {
    expect(
      detectCompletionMarker('Thank you for the info. [COLLECTION_COMPLETE]')
    ).toBe('collection_complete')
  })

  it('detects [INFO_COMPLETE]', () => {
    expect(detectCompletionMarker('All done! [INFO_COMPLETE]')).toBe(
      'info_complete'
    )
  })

  it('detects [HANDOFF_TO_HUMAN]', () => {
    expect(detectCompletionMarker('Let me transfer you. [HANDOFF_TO_HUMAN]')).toBe(
      'handoff_to_human'
    )
  })

  it('detects [HANDOFF_TO_AGENT:id-123]', () => {
    expect(
      detectCompletionMarker('Transferring... [HANDOFF_TO_AGENT:id-123]')
    ).toBe('handoff_to_agent')
  })

  it('returns null for plain text', () => {
    expect(
      detectCompletionMarker('Just a regular response with no markers.')
    ).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(detectCompletionMarker('')).toBe(null)
  })

  it('returns first matching marker when multiple present', () => {
    expect(
      detectCompletionMarker('[COLLECTION_COMPLETE] [INFO_COMPLETE]')
    ).toBe('collection_complete')
  })
})

describe('extractHandoffTarget', () => {
  it('extracts agent ID from marker', () => {
    expect(
      extractHandoffTarget('Transferring... [HANDOFF_TO_AGENT:abc-123]')
    ).toBe('abc-123')
  })

  it('extracts agent ID with underscores', () => {
    expect(extractHandoffTarget('[HANDOFF_TO_AGENT:my_agent_42]')).toBe(
      'my_agent_42'
    )
  })

  it('returns null when no marker present', () => {
    expect(extractHandoffTarget('No marker here')).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(extractHandoffTarget('')).toBe(null)
  })
})

describe('stripCompletionMarkers', () => {
  it('removes [COLLECTION_COMPLETE]', () => {
    expect(stripCompletionMarkers('Thanks! [COLLECTION_COMPLETE]')).toBe('Thanks!')
  })

  it('removes [INFO_COMPLETE]', () => {
    expect(stripCompletionMarkers('Done. [INFO_COMPLETE]')).toBe('Done.')
  })

  it('removes [HANDOFF_TO_HUMAN]', () => {
    expect(stripCompletionMarkers('Transferring. [HANDOFF_TO_HUMAN]')).toBe(
      'Transferring.'
    )
  })

  it('removes [HANDOFF_TO_AGENT:id]', () => {
    expect(
      stripCompletionMarkers('Going to agent. [HANDOFF_TO_AGENT:agent-x]')
    ).toBe('Going to agent.')
  })

  it('removes <!--SUGGESTIONS:...-->', () => {
    expect(
      stripCompletionMarkers('Hello <!--SUGGESTIONS:{"items":["a","b"]}-->')
    ).toBe('Hello')
  })

  it('removes <!--SUGGESTIONS: ...-> with space after colon (LLM often adds space)', () => {
    expect(
      stripCompletionMarkers(
        'Hello <!--SUGGESTIONS: {"suggestions":["Check availability","Make a new booking"]}-->'
      )
    ).toBe('Hello')
  })

  it('removes all marker types at once', () => {
    const input =
      'Text [COLLECTION_COMPLETE] [INFO_COMPLETE] [HANDOFF_TO_HUMAN] <!--SUGGESTIONS:{"a":1}-->'
    expect(stripCompletionMarkers(input)).toBe('Text')
  })

  it('trims whitespace', () => {
    expect(stripCompletionMarkers('  Hello  [COLLECTION_COMPLETE]  ')).toBe(
      'Hello'
    )
  })

  it('returns empty string when text is only markers', () => {
    expect(stripCompletionMarkers('[COLLECTION_COMPLETE]')).toBe('')
  })
})

describe('createCompletionTransformStream hold-back buffer', () => {
  it('holds back last 30 chars until flush', async () => {
    const input = 'Hello, world! This is a test message.'
    const stream = stringToStream(input)
    const output = await consumeStream(
      stream.pipeThrough(createCompletionTransformStream())
    )
    expect(output).toBe(input)
  })

  it('handles text shorter than 30 chars', async () => {
    const input = 'Short text'
    const stream = stringToStream(input)
    const output = await consumeStream(
      stream.pipeThrough(createCompletionTransformStream())
    )
    expect(output).toBe(input)
  })
})

describe('createCompletionTransformStream marker handling', () => {
  it('strips [COLLECTION_COMPLETE] and appends CHAT_COMPLETE metadata', async () => {
    const input = 'Thank you for providing all the info. [COLLECTION_COMPLETE]'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream())
    )

    expect(output.includes('[COLLECTION_COMPLETE]')).toBe(false)
    expect(output.includes('Thank you for providing all the info.')).toBeTruthy()
    expect(output.includes('<!--CHAT_COMPLETE:')).toBeTruthy()

    const metaMatch = output.match(/<!--CHAT_COMPLETE:(.+?)-->/)
    expect(metaMatch).toBeTruthy()
    const meta = JSON.parse(metaMatch![1])
    expect(meta.chatComplete).toBe(true)
    expect(meta.reason).toBe('collection_complete')
  })

  it('strips [INFO_COMPLETE] and appends metadata', async () => {
    const input = 'Here is the information. [INFO_COMPLETE]'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream())
    )

    expect(output.includes('[INFO_COMPLETE]')).toBe(false)
    expect(output.includes('<!--CHAT_COMPLETE:')).toBeTruthy()

    const meta = JSON.parse(output.match(/<!--CHAT_COMPLETE:(.+?)-->/)![1])
    expect(meta.reason).toBe('info_complete')
  })

  it('emits AGENT_HANDOFF metadata for handoff markers', async () => {
    const input =
      'Let me transfer you to our sales team. [HANDOFF_TO_AGENT:sales-bot-1]'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(
        createCompletionTransformStream(undefined, undefined, {
          'sales-bot-1': 'Sales Bot'
        })
      )
    )

    expect(output.includes('[HANDOFF_TO_AGENT:')).toBe(false)
    expect(output.includes('<!--AGENT_HANDOFF:')).toBeTruthy()

    const handoffMeta = JSON.parse(
      output.match(/<!--AGENT_HANDOFF:(.+?)-->/)![1]
    )
    expect(handoffMeta.targetAgentId).toBe('sales-bot-1')
    expect(handoffMeta.targetAgentName).toBe('Sales Bot')
  })

  it('sets chatComplete: false for handoff_to_agent', async () => {
    const input = 'Transferring. [HANDOFF_TO_AGENT:other-agent]'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream())
    )
    const meta = JSON.parse(output.match(/<!--CHAT_COMPLETE:(.+?)-->/)![1])
    expect(meta.chatComplete).toBe(false)
    expect(meta.reason).toBe('handoff_to_agent')
  })

  it('handles maxResponses threshold without marker', async () => {
    const input = 'Just a normal response.'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream(5, 5))
    )

    expect(output.includes('Just a normal response.')).toBeTruthy()
    expect(output.includes('<!--CHAT_COMPLETE:')).toBeTruthy()

    const meta = JSON.parse(output.match(/<!--CHAT_COMPLETE:(.+?)-->/)![1])
    expect(meta.reason).toBe('max_responses')
    expect(meta.chatComplete).toBe(true)
  })

  it('no metadata appended for plain text without markers or limits', async () => {
    const input = 'Just a regular reply with no special markers at all.'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream())
    )
    expect(output).toBe(input)
    expect(output.includes('<!--CHAT_COMPLETE:')).toBe(false)
    expect(output.includes('<!--AGENT_HANDOFF:')).toBe(false)
  })

  it('strips <!--SUGGESTIONS:...-> without leaking it during streaming', async () => {
    const input =
      'Here is my response. <!--SUGGESTIONS:{"suggestions":["Option A","Option B"]}-->'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream())
    )
    expect(output.includes('<!--SUGGESTIONS:')).toBe(false)
    expect(output.includes('Here is my response.')).toBeTruthy()
  })

  it('strips <!--SUGGESTIONS: ...-> with space after colon without leaking', async () => {
    const input =
      'Here is my response. <!--SUGGESTIONS: {"suggestions":["Check availability","Make a new booking","Edit an existing booking","Contact support"]}-->'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream())
    )
    expect(output.includes('<!--SUGGESTIONS:')).toBe(false)
    expect(output.includes('Here is my response.')).toBeTruthy()
  })

  it('emits only ONE CHAT_COMPLETE when LLM marker and maxResponses collide', async () => {
    const input = 'Thanks for the info! [COLLECTION_COMPLETE]'
    const output = await consumeStream(
      stringToStream(input).pipeThrough(createCompletionTransformStream(5, 5))
    )

    const matches = output.match(/<!--CHAT_COMPLETE:/g)
    expect(matches?.length).toBe(1)

    const meta = JSON.parse(output.match(/<!--CHAT_COMPLETE:(.+?)-->/)![1])
    expect(meta.reason).toBe('collection_complete')
    expect(meta.chatComplete).toBe(true)
  })
})

describe('wrapStreamWithCompletionDetection', () => {
  it('pipes stream through transform correctly', async () => {
    const input = 'Great, all info collected! [COLLECTION_COMPLETE]'
    const output = await consumeStream(
      wrapStreamWithCompletionDetection(stringToStream(input))
    )
    expect(output.includes('[COLLECTION_COMPLETE]')).toBe(false)
    expect(output.includes('Great, all info collected!')).toBeTruthy()
    expect(output.includes('<!--CHAT_COMPLETE:')).toBeTruthy()
  })

  it('passes through handoff target names', async () => {
    const input = 'Redirecting. [HANDOFF_TO_AGENT:support-bot]'
    const output = await consumeStream(
      wrapStreamWithCompletionDetection(stringToStream(input), undefined, undefined, {
        'support-bot': 'Support Team Bot'
      })
    )
    const meta = JSON.parse(output.match(/<!--AGENT_HANDOFF:(.+?)-->/)![1])
    expect(meta.targetAgentName).toBe('Support Team Bot')
  })

  it('uses agent ID as fallback name when not in map', async () => {
    const input = 'Going. [HANDOFF_TO_AGENT:unknown-bot]'
    const output = await consumeStream(
      wrapStreamWithCompletionDetection(stringToStream(input))
    )
    const meta = JSON.parse(output.match(/<!--AGENT_HANDOFF:(.+?)-->/)![1])
    expect(meta.targetAgentName).toBe('unknown-bot')
  })
})
