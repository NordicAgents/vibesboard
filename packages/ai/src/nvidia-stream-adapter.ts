/**
 * NVIDIA Reasoning Model Stream Adapter
 *
 * NVIDIA's hosted reasoning/thinking models (Nemotron Ultra, DeepSeek V4 Pro,
 * Qwen3 Coder, etc.) separate their output into two fields:
 *   - delta.reasoning_content — internal scratchpad / chain-of-thought (hidden from users)
 *   - delta.content           — the actual answer to show users
 *
 * The Vercel AI SDK's Zod schema strips `reasoning_content` silently. For models
 * that produce a final `delta.content` answer after the thinking phase, this is fine:
 * the SDK receives the content chunks and works correctly.
 *
 * The only case we need to intervene is models that put their ENTIRE output in
 * `reasoning_content` and never emit `delta.content` at all. In that case we fall
 * back to promoting `reasoning_content` → `content` (collected over the full
 * stream so we don't include the thinking preamble).
 *
 * Strategy:
 *  1. Track whether any real `delta.content` was seen in the stream.
 *  2. Suppress all `reasoning_content`-only chunks (hide thinking from users).
 *  3. If the stream ends with zero content chunks seen, re-emit the last
 *     non-empty `reasoning_content` value as a synthetic content chunk so the
 *     SDK has something to work with.
 *
 * Still required on @ai-sdk/openai 1.x (AI SDK v4), which this workspace now
 * uses: the NVIDIA endpoint is registered with `compatibility: 'compatible'`,
 * and that chunk schema has no `reasoning_content` field, so the value is
 * dropped before the SDK sees it. Revisit if the nvidia factory moves to a
 * provider that parses the field natively (e.g. @ai-sdk/openai-compatible).
 * See packages/ai/src/provider-registry.ts.
 */

export function buildNvidiaFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const upstream = await fetch(input, init)

    if (
      !upstream.body ||
      !upstream.headers.get('content-type')?.includes('text/event-stream')
    ) {
      return upstream
    }

    const transformed = transformNvidiaSSE(upstream.body)
    const headers = new Headers(upstream.headers)
    return new Response(transformed, { status: upstream.status, headers })
  }
}

function transformNvidiaSSE(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  // State: did the model ever emit real content?
  let seenRealContent = false
  // Last non-empty reasoning_content seen (fallback for reasoning-only models)
  let lastReasoningContent = ''
  // Accumulate all raw lines so we can re-emit the fallback at the end
  const pendingLines: string[] = []

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = body.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // Flush remaining partial line
            if (buffer.trim()) {
              const result = processLine(buffer)
              if (result.type === 'real') seenRealContent = true
              if (result.type === 'reasoning') lastReasoningContent = result.text
              pendingLines.push(result.output + '\n')
            }

            // Emit all lines — suppress reasoning lines unless they're the only content
            for (const raw of pendingLines) {
              const suppressed = raw.startsWith('__SUPPRESS__')
              if (!suppressed) {
                controller.enqueue(encoder.encode(raw))
              } else if (!seenRealContent) {
                // Fallback: model only produced reasoning — emit it as content
                controller.enqueue(encoder.encode(raw.slice('__SUPPRESS__'.length)))
              }
            }

            // If the model produced nothing at all, emit a synthetic content chunk
            if (!seenRealContent && lastReasoningContent) {
              const fallback = {
                id: 'nvidia-fallback',
                object: 'chat.completion.chunk',
                model: 'nvidia',
                choices: [{ index: 0, delta: { content: lastReasoningContent }, finish_reason: null }],
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(fallback)}\n`))
            }

            controller.close()
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const result = processLine(line)
            if (result.type === 'real') {
              seenRealContent = true
              // Emit real content immediately
              controller.enqueue(encoder.encode(result.output + '\n'))
            } else if (result.type === 'reasoning') {
              lastReasoningContent = result.text
              // Suppress for now — will only emit if no real content comes
              pendingLines.push(`__SUPPRESS__${result.output}\n`)
            } else {
              // Non-data lines (empty lines, comments, event: headers)
              // Emit immediately — they're structural
              controller.enqueue(encoder.encode(result.output + '\n'))
            }
          }
        }
      } catch (err) {
        controller.error(err)
      }
    },

    // Propagate consumer aborts (user stops generation, client disconnects)
    // upstream, otherwise the NVIDIA connection stays open until the model
    // finishes generating the response nobody is reading any more.
    cancel(reason) {
      return reader?.cancel(reason) ?? body.cancel(reason)
    },
  })
}

type LineResult =
  | { type: 'real'; output: string }         // has delta.content
  | { type: 'reasoning'; output: string; text: string } // only reasoning_content
  | { type: 'passthrough'; output: string }  // non-data or [DONE]

function processLine(line: string): LineResult {
  if (!line.startsWith('data: ')) return { type: 'passthrough', output: line }
  const payload = line.slice(6).trim()
  if (!payload || payload === '[DONE]') return { type: 'passthrough', output: line }

  let chunk: any
  try {
    chunk = JSON.parse(payload)
  } catch {
    return { type: 'passthrough', output: line }
  }

  const choices = chunk?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return { type: 'passthrough', output: line }
  }

  // Check each choice
  let hasRealContent = false
  let hasReasoningOnly = false
  let reasoningText = ''

  for (const choice of choices) {
    const delta = choice?.delta
    if (!delta) continue

    const content: string | null | undefined = delta.content
    const reasoning: string | null | undefined = delta.reasoning_content

    if (content != null && content !== '') {
      hasRealContent = true
    } else if (reasoning != null && reasoning !== '') {
      hasReasoningOnly = true
      reasoningText += reasoning
    }
  }

  if (hasRealContent) {
    return { type: 'real', output: line }
  }
  if (hasReasoningOnly) {
    return { type: 'reasoning', output: line, text: reasoningText }
  }
  return { type: 'passthrough', output: line }
}
