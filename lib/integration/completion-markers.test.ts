/**
 * Tests for completion marker detection and TransformStream logic.
 *
 * These are pure-logic tests — no external dependencies.
 * Source module: lib/agent/completion.ts
 *
 * Run:
 *   node --experimental-strip-types --test lib/integration/completion-markers.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'

// Replicate constants and functions inline since @/ path aliases
// don't resolve in the Node test runner. Must match lib/agent/completion.ts.

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

const SUGGESTIONS_MARKER_REGEX = /<!--SUGGESTIONS:(\{[\s\S]*?\})-->/g
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

  return new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true })
      buffer += text
      held += text

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
        maxResponses && currentResponseCount && currentResponseCount >= maxResponses

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

// Helper: create a ReadableStream from a string
function stringToStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    }
  })
}

// Helper: consume a stream to string
async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<string> {
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

// -------------------------------------------------------------------
// 1. detectCompletionMarker
// -------------------------------------------------------------------
describe('detectCompletionMarker', () => {
  test('detects [COLLECTION_COMPLETE]', () => {
    const result = detectCompletionMarker('Thank you for the info. [COLLECTION_COMPLETE]')
    assert.strictEqual(result, 'collection_complete')
  })

  test('detects [INFO_COMPLETE]', () => {
    const result = detectCompletionMarker('All done! [INFO_COMPLETE]')
    assert.strictEqual(result, 'info_complete')
  })

  test('detects [HANDOFF_TO_HUMAN]', () => {
    const result = detectCompletionMarker('Let me transfer you. [HANDOFF_TO_HUMAN]')
    assert.strictEqual(result, 'handoff_to_human')
  })

  test('detects [HANDOFF_TO_AGENT:id-123]', () => {
    const result = detectCompletionMarker('Transferring... [HANDOFF_TO_AGENT:id-123]')
    assert.strictEqual(result, 'handoff_to_agent')
  })

  test('returns null for plain text', () => {
    const result = detectCompletionMarker('Just a regular response with no markers.')
    assert.strictEqual(result, null)
  })

  test('returns null for empty string', () => {
    assert.strictEqual(detectCompletionMarker(''), null)
  })

  test('returns first matching marker when multiple present', () => {
    // COLLECTION_COMPLETE is checked first
    const result = detectCompletionMarker('[COLLECTION_COMPLETE] [INFO_COMPLETE]')
    assert.strictEqual(result, 'collection_complete')
  })
})

// -------------------------------------------------------------------
// 2. extractHandoffTarget
// -------------------------------------------------------------------
describe('extractHandoffTarget', () => {
  test('extracts agent ID from marker', () => {
    const result = extractHandoffTarget('Transferring... [HANDOFF_TO_AGENT:abc-123]')
    assert.strictEqual(result, 'abc-123')
  })

  test('extracts agent ID with underscores', () => {
    const result = extractHandoffTarget('[HANDOFF_TO_AGENT:my_agent_42]')
    assert.strictEqual(result, 'my_agent_42')
  })

  test('returns null when no marker present', () => {
    assert.strictEqual(extractHandoffTarget('No marker here'), null)
  })

  test('returns null for empty string', () => {
    assert.strictEqual(extractHandoffTarget(''), null)
  })
})

// -------------------------------------------------------------------
// 3. stripCompletionMarkers
// -------------------------------------------------------------------
describe('stripCompletionMarkers', () => {
  test('removes [COLLECTION_COMPLETE]', () => {
    const result = stripCompletionMarkers('Thanks! [COLLECTION_COMPLETE]')
    assert.strictEqual(result, 'Thanks!')
  })

  test('removes [INFO_COMPLETE]', () => {
    const result = stripCompletionMarkers('Done. [INFO_COMPLETE]')
    assert.strictEqual(result, 'Done.')
  })

  test('removes [HANDOFF_TO_HUMAN]', () => {
    const result = stripCompletionMarkers('Transferring. [HANDOFF_TO_HUMAN]')
    assert.strictEqual(result, 'Transferring.')
  })

  test('removes [HANDOFF_TO_AGENT:id]', () => {
    const result = stripCompletionMarkers('Going to agent. [HANDOFF_TO_AGENT:agent-x]')
    assert.strictEqual(result, 'Going to agent.')
  })

  test('removes <!--SUGGESTIONS:...-->', () => {
    const result = stripCompletionMarkers('Hello <!--SUGGESTIONS:{"items":["a","b"]}-->')
    assert.strictEqual(result, 'Hello')
  })

  test('removes all marker types at once', () => {
    const input = 'Text [COLLECTION_COMPLETE] [INFO_COMPLETE] [HANDOFF_TO_HUMAN] <!--SUGGESTIONS:{"a":1}-->'
    const result = stripCompletionMarkers(input)
    assert.strictEqual(result, 'Text')
  })

  test('trims whitespace', () => {
    const result = stripCompletionMarkers('  Hello  [COLLECTION_COMPLETE]  ')
    assert.strictEqual(result, 'Hello')
  })

  test('returns empty string when text is only markers', () => {
    const result = stripCompletionMarkers('[COLLECTION_COMPLETE]')
    assert.strictEqual(result, '')
  })
})

// -------------------------------------------------------------------
// 4. createCompletionTransformStream — hold-back buffer
// -------------------------------------------------------------------
describe('createCompletionTransformStream hold-back buffer', () => {
  test('holds back last 30 chars until flush', async () => {
    const input = 'Hello, world! This is a test message.'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream()
    const output = await consumeStream(stream.pipeThrough(transformStream))

    // No markers → output should match input exactly
    assert.strictEqual(output, input)
  })

  test('handles text shorter than 30 chars', async () => {
    const input = 'Short text'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream()
    const output = await consumeStream(stream.pipeThrough(transformStream))

    assert.strictEqual(output, input)
  })
})

// -------------------------------------------------------------------
// 5. createCompletionTransformStream — marker stripping
// -------------------------------------------------------------------
describe('createCompletionTransformStream marker handling', () => {
  test('strips [COLLECTION_COMPLETE] and appends CHAT_COMPLETE metadata', async () => {
    const input = 'Thank you for providing all the info. [COLLECTION_COMPLETE]'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream()
    const output = await consumeStream(stream.pipeThrough(transformStream))

    assert.ok(!output.includes('[COLLECTION_COMPLETE]'), 'Marker should be stripped')
    assert.ok(output.includes('Thank you for providing all the info.'), 'Text should be preserved')
    assert.ok(output.includes('<!--CHAT_COMPLETE:'), 'Should have completion metadata')

    const metaMatch = output.match(/<!--CHAT_COMPLETE:(.+?)-->/)
    assert.ok(metaMatch, 'Metadata should be parseable')
    const meta = JSON.parse(metaMatch![1])
    assert.strictEqual(meta.chatComplete, true)
    assert.strictEqual(meta.reason, 'collection_complete')
  })

  test('strips [INFO_COMPLETE] and appends metadata', async () => {
    const input = 'Here is the information. [INFO_COMPLETE]'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream()
    const output = await consumeStream(stream.pipeThrough(transformStream))

    assert.ok(!output.includes('[INFO_COMPLETE]'))
    assert.ok(output.includes('<!--CHAT_COMPLETE:'))

    const metaMatch = output.match(/<!--CHAT_COMPLETE:(.+?)-->/)
    const meta = JSON.parse(metaMatch![1])
    assert.strictEqual(meta.reason, 'info_complete')
  })

  test('emits AGENT_HANDOFF metadata for handoff markers', async () => {
    const input = 'Let me transfer you to our sales team. [HANDOFF_TO_AGENT:sales-bot-1]'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream(
      undefined, undefined,
      { 'sales-bot-1': 'Sales Bot' }
    )
    const output = await consumeStream(stream.pipeThrough(transformStream))

    assert.ok(!output.includes('[HANDOFF_TO_AGENT:'), 'Handoff marker should be stripped')
    assert.ok(output.includes('<!--AGENT_HANDOFF:'), 'Should have handoff metadata')

    const handoffMatch = output.match(/<!--AGENT_HANDOFF:(.+?)-->/)
    assert.ok(handoffMatch)
    const handoffMeta = JSON.parse(handoffMatch![1])
    assert.strictEqual(handoffMeta.targetAgentId, 'sales-bot-1')
    assert.strictEqual(handoffMeta.targetAgentName, 'Sales Bot')
  })

  test('sets chatComplete: false for handoff_to_agent', async () => {
    const input = 'Transferring. [HANDOFF_TO_AGENT:other-agent]'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream()
    const output = await consumeStream(stream.pipeThrough(transformStream))

    const metaMatch = output.match(/<!--CHAT_COMPLETE:(.+?)-->/)
    assert.ok(metaMatch)
    const meta = JSON.parse(metaMatch![1])
    assert.strictEqual(meta.chatComplete, false, 'Handoffs should not mark chat as complete')
    assert.strictEqual(meta.reason, 'handoff_to_agent')
  })

  test('handles maxResponses threshold without marker', async () => {
    const input = 'Just a normal response.'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream(5, 5) // at limit
    const output = await consumeStream(stream.pipeThrough(transformStream))

    assert.ok(output.includes('Just a normal response.'))
    assert.ok(output.includes('<!--CHAT_COMPLETE:'), 'Should emit completion at max responses')

    const metaMatch = output.match(/<!--CHAT_COMPLETE:(.+?)-->/)
    const meta = JSON.parse(metaMatch![1])
    assert.strictEqual(meta.reason, 'max_responses')
    assert.strictEqual(meta.chatComplete, true)
  })

  test('no metadata appended for plain text without markers or limits', async () => {
    const input = 'Just a regular reply with no special markers at all.'
    const stream = stringToStream(input)
    const transformStream = createCompletionTransformStream()
    const output = await consumeStream(stream.pipeThrough(transformStream))

    assert.strictEqual(output, input)
    assert.ok(!output.includes('<!--CHAT_COMPLETE:'), 'Should not have completion metadata')
    assert.ok(!output.includes('<!--AGENT_HANDOFF:'), 'Should not have handoff metadata')
  })

  test('emits only ONE CHAT_COMPLETE when LLM marker and maxResponses collide', async () => {
    const input = 'Thanks for the info! [COLLECTION_COMPLETE]'
    const stream = stringToStream(input)
    // currentResponseCount (5) >= maxResponses (5) AND LLM emitted marker
    const transformStream = createCompletionTransformStream(5, 5)
    const output = await consumeStream(stream.pipeThrough(transformStream))

    const matches = output.match(/<!--CHAT_COMPLETE:/g)
    assert.strictEqual(matches?.length, 1, 'Should emit exactly one CHAT_COMPLETE marker')

    const metaMatch = output.match(/<!--CHAT_COMPLETE:(.+?)-->/)
    const meta = JSON.parse(metaMatch![1])
    // The LLM completion reason should take priority over max_responses
    assert.strictEqual(meta.reason, 'collection_complete')
    assert.strictEqual(meta.chatComplete, true)
  })
})

// -------------------------------------------------------------------
// 6. wrapStreamWithCompletionDetection — end-to-end
// -------------------------------------------------------------------
describe('wrapStreamWithCompletionDetection', () => {
  test('pipes stream through transform correctly', async () => {
    const input = 'Great, all info collected! [COLLECTION_COMPLETE]'
    const stream = stringToStream(input)
    const wrapped = wrapStreamWithCompletionDetection(stream)
    const output = await consumeStream(wrapped)

    assert.ok(!output.includes('[COLLECTION_COMPLETE]'))
    assert.ok(output.includes('Great, all info collected!'))
    assert.ok(output.includes('<!--CHAT_COMPLETE:'))
  })

  test('passes through handoff target names', async () => {
    const input = 'Redirecting. [HANDOFF_TO_AGENT:support-bot]'
    const stream = stringToStream(input)
    const wrapped = wrapStreamWithCompletionDetection(
      stream, undefined, undefined,
      { 'support-bot': 'Support Team Bot' }
    )
    const output = await consumeStream(wrapped)

    const handoffMatch = output.match(/<!--AGENT_HANDOFF:(.+?)-->/)
    assert.ok(handoffMatch)
    const meta = JSON.parse(handoffMatch![1])
    assert.strictEqual(meta.targetAgentName, 'Support Team Bot')
  })

  test('uses agent ID as fallback name when not in map', async () => {
    const input = 'Going. [HANDOFF_TO_AGENT:unknown-bot]'
    const stream = stringToStream(input)
    const wrapped = wrapStreamWithCompletionDetection(stream)
    const output = await consumeStream(wrapped)

    const handoffMatch = output.match(/<!--AGENT_HANDOFF:(.+?)-->/)
    assert.ok(handoffMatch)
    const meta = JSON.parse(handoffMatch![1])
    assert.strictEqual(meta.targetAgentName, 'unknown-bot')
  })
})
