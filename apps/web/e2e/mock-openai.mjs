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
  // Minimal Responses-API streaming sequence.
  res.write(
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: 'response.output_text.delta',
      delta: REPLY,
    })}\n\n`,
  )
  res.write(
    `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: responsesJson(),
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

  if (req.method === 'POST' && url.includes('/responses')) {
    const body = await readBody(req)
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
