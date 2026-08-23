import { describe, expect, it } from 'vitest'

import {
  createCompletionTransformStream,
  stripCompletionMarkers
} from './completion.ts'

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return output
    output += decoder.decode(value, { stream: true })
  }
}

describe('stripCompletionMarkers', () => {
  it('strips a model-emitted CHAT_COMPLETE marker with whitespace', () => {
    expect(
      stripCompletionMarkers(
        'Goodbye! <!--CHAT_COMPLETE:{"chatComplete":true,"reason":"info_complete"} -->'
      )
    ).toBe('Goodbye!')
  })

  it('holds and normalizes a model-emitted completion marker in a stream', async () => {
    const encoder = new TextEncoder()
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'Goodbye! <!--CHAT_COMPLETE:{"chatComplete":true,"reason":"info_complete"}'
          )
        )
        controller.enqueue(encoder.encode(' -->'))
        controller.close()
      }
    })

    const output = await readStream(
      input.pipeThrough(createCompletionTransformStream())
    )

    expect(output).toBe(
      'Goodbye! \n<!--CHAT_COMPLETE:{"chatComplete":true,"reason":"info_complete"}-->'
    )
  })
})
