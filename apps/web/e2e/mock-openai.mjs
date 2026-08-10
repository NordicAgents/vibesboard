// Deterministic mock OpenAI server for Playwright E2E.
//
// The app's OpenAI client (packages/adapter-openai/src/openai.ts) reads
// OPENAI_BASE_URL, so the Playwright webServer points it at this process.
// Server-side fetch from the Next server cannot be intercepted by Playwright's
// page.route(), which is why we redirect at the network/env boundary instead.
//
// Responds to:
//   POST /v1/responses    -> OpenAI Responses API shape (canned reply, also SSE)
//   POST /v1/embeddings   -> 1536-dim deterministic embedding
//   GET  /healthz         -> 200 ok
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4010)
const REPLY =
  process.env.MOCK_OPENAI_REPLY ??
  'This is a deterministic E2E stubbed reply from the mock model.'

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const embedding = Array.from({ length: 1536 }, (_, i) => (i % 7) / 7)

function responsesJson() {
  return {
    id: 'resp_e2e_stub',
    object: 'response',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: REPLY }],
      },
    ],
    output_text: REPLY,
    usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
  }
}

function writeSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  // Minimal Responses-API streaming sequence for @ai-sdk/openai@4.x.
  // The output_text.delta schema requires item_id (non-optional).
  // The completed event response requires input_tokens + output_tokens.
  res.write(
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: 'response.output_text.delta',
      item_id: 'item_e2e_001',
      output_index: 0,
      delta: REPLY,
    })}\n\n`,
  )
  res.write(
    `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: {
        ...responsesJson(),
        usage: { input_tokens: 12, output_tokens: 8 },
      },
    })}\n\n`,
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

/**
 * Responses-API streaming for one function call. @ai-sdk/openai@4.x targets
 * /v1/responses (not /chat/completions), so this — not writeToolCallSSE — is
 * what actually drives the agent-creator's create_agent tool in E2E.
 */
function writeResponsesToolCallSSE(res, name, args) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const send = (type, payload) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`)

  const argsJson = JSON.stringify(args)
  const item = {
    id: 'fc_e2e_001',
    type: 'function_call',
    call_id: 'call_e2e_001',
    name,
    arguments: '',
    status: 'in_progress',
  }

  send('response.output_item.added', { output_index: 0, item })
  send('response.function_call_arguments.delta', {
    item_id: item.id,
    output_index: 0,
    delta: argsJson,
  })
  send('response.function_call_arguments.done', {
    item_id: item.id,
    output_index: 0,
    arguments: argsJson,
  })
  send('response.output_item.done', {
    output_index: 0,
    item: { ...item, arguments: argsJson, status: 'completed' },
  })
  send('response.completed', {
    response: {
      id: 'resp_e2e_tool',
      object: 'response',
      output: [{ ...item, arguments: argsJson, status: 'completed' }],
      usage: { input_tokens: 12, output_tokens: 8 },
    },
  })
  res.write('data: [DONE]\n\n')
  res.end()
}

function chatCompletionsJson() {
  return {
    id: 'chatcmpl-e2e-stub',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: REPLY },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  }
}

// A request whose conversation contains this phrase makes the mock emit a
// `create_agent` tool call instead of plain text. Without it, the only code
// path that persists an agent from the creator chat
// (app/api/agent-creator/route.ts) is unreachable in E2E: the stub never asks
// for a tool, so `execute()` never runs. Any other prompt still gets REPLY, so
// existing specs are unaffected.
export const TOOL_CALL_TRIGGER = 'E2E_TRIGGER_CREATE_AGENT'

function collectText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  return messages
    .map((m) =>
      typeof m?.content === 'string'
        ? m.content
        : Array.isArray(m?.content)
          ? m.content.map((p) => p?.text ?? '').join(' ')
          : '',
    )
    .join('\n')
}

/** Minimal OpenAI streaming shape for one function/tool call. */
function writeToolCallSSE(res, name, args) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-tool',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`

  // Name first, then the arguments as a single JSON string delta — the shape
  // the OpenAI provider assembles tool calls from.
  res.write(
    chunk({
      tool_calls: [
        { index: 0, id: 'call_e2e_1', type: 'function', function: { name, arguments: '' } },
      ],
    }),
  )
  res.write(
    chunk({
      tool_calls: [
        { index: 0, function: { arguments: JSON.stringify(args) } },
      ],
    }),
  )
  res.write(chunk({}, 'tool_calls'))
  // @ai-sdk/openai@4.x sends stream_options.include_usage=true and expects a
  // final usage chunk before [DONE], same as writeChatSSE below.
  res.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-tool',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    })}\n\n`,
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

function writeChatSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  // Vercel AI SDK / @ai-sdk/openai@4.x streaming chat.completion.chunk format.
  // @ai-sdk/openai@4.x sends stream_options.include_usage=true in the request
  // and expects a final usage chunk before [DONE].
  res.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-stub',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { role: 'assistant', content: REPLY }, finish_reason: null }],
    })}\n\n`,
  )
  res.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-stub',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
  // Usage chunk required by stream_options.include_usage=true (@ai-sdk/openai@4.x)
  res.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-e2e-stub',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    })}\n\n`,
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

const server = createServer(async (req, res) => {
  const url = req.url ?? ''
  if (req.method === 'GET' && url.startsWith('/healthz')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  // Chat Completions API (Vercel AI SDK / streamText)
  if (req.method === 'POST' && url.includes('/chat/completions')) {
    const body = await readBody(req)

    // Tool-call path: only when the caller opted in AND the tool is on offer.
    const wantsToolCall = collectText(body).includes(TOOL_CALL_TRIGGER)
    const offersCreateAgent = (body?.tools ?? []).some(
      (t) => t?.function?.name === 'create_agent',
    )
    if (wantsToolCall && offersCreateAgent) {
      writeToolCallSSE(res, 'create_agent', {
        name: `E2E Tool-Created Agent ${Date.now()}`,
        instructions:
          'Created through the agent-creator create_agent tool during E2E.',
        greetingText: 'Hello from the tool-created agent.',
        tools: [],
      })
      return
    }

    if (body && body.stream === true) {
      writeChatSSE(res)
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(chatCompletionsJson()))
    return
  }

  if (req.method === 'POST' && url.includes('/responses')) {
    const body = await readBody(req)

    // Tool-call path — same opt-in contract as /chat/completions above. The
    // Responses API names tools flat ({ type:'function', name }) rather than
    // nesting them under `function`.
    const responsesText = JSON.stringify(body?.input ?? body?.messages ?? '')
    const offersCreateAgentR = (body?.tools ?? []).some(
      (t) => (t?.name ?? t?.function?.name) === 'create_agent',
    )
    if (responsesText.includes(TOOL_CALL_TRIGGER) && offersCreateAgentR) {
      writeResponsesToolCallSSE(res, 'create_agent', {
        name: `E2E Tool-Created Agent ${Date.now()}`,
        instructions:
          'Created through the agent-creator create_agent tool during E2E.',
        greetingText: 'Hello from the tool-created agent.',
        tools: [],
      })
      return
    }

    if (body && body.stream === true) {
      writeSSE(res)
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(responsesJson()))
    return
  }

  if (req.method === 'POST' && url.includes('/embeddings')) {
    await readBody(req)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    )
    return
  }

  // Default: empty 200 so nothing hits the real network.
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end('{}')
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-openai] listening on http://localhost:${PORT}`)
})
