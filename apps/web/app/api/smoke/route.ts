import { NextResponse } from 'next/server'
import { type Message } from '@vibesboard/contracts'
import { timingSafeEqual } from 'node:crypto'

import { runAgentStream } from '@vibesboard/ai/runtime'
import { type VibeAgent } from '@vibesboard/contracts'

export const runtime = 'nodejs'

function isAuthorized(req: Request): boolean {
  const expected = process.env.SMOKE_TEST_SECRET
  if (!expected || expected.length < 32) return false

  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false
  const supplied = authorization.slice('Bearer '.length)

  const expectedBytes = Buffer.from(expected)
  const suppliedBytes = Buffer.from(supplied)
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  )
}

export async function GET(req: Request) {
  // The endpoint invokes the platform fallback model and therefore must never
  // be a public health check. A missing/short secret disables it entirely.
  if (!isAuthorized(req)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'file'
  // Minimal in-memory agent with built-in tools enabled
  // These must be UUID-shaped: the runtime resolves per-tenant LLM routing and
  // feature flags by querying uuid columns with them, so the previous
  // 'smoke-tenant' / 'smoke-user' / 'smoke-agent' strings made Postgres throw
  // ("invalid input syntax for type uuid") and this route always returned 500.
  // Sentinel values that match no row, so every lookup falls back to defaults.
  const agent: VibeAgent = {
    id: '00000000-0000-4000-8000-000000005a9e',
    userId: '00000000-0000-4000-8000-000000005115',
    tenantId: '00000000-0000-4000-8000-0000000005e0',
    name: 'SmokeTest Agent',
    instructions:
      'Follow directions. When the user explicitly asks to call a tool, do so. Keep the final answer concise.',
    fileKeys: [],
    agentUrl: 'smoke',
    tools: [
      {
        id: 'builtin:file_search',
        type: 'builtin:file_search',
        name: 'File Search',
        description: 'Search uploaded files for matching text.'
      },
      {
        id: 'builtin:web_fetch',
        type: 'builtin:web_fetch',
        name: 'Web Fetch',
        description: 'Fetches web page content from a given URL.'
      }
    ],
    allowAnonymous: true,
    mode: 'provider',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  // Mock file context to exercise the file_search tool deterministically.
  const fileContext = [
    'This is a local test context.',
    'We include a special VibeTestToken for lookup.',
    'End of context.'
  ].join('\n')

  const messages: Message[] =
    mode === 'web'
      ? [
          {
            id: 'm1',
            role: 'user',
            content:
              'Call the web_fetch tool with url "https://example.com". After receiving the tool result, reply with ONLY the page title.'
          }
        ]
      : [
          {
            id: 'm1',
            role: 'user',
            content:
              'Please call the file_search tool with query "VibeTestToken" and then reply only with the matching line.'
          }
        ]

  try {
    const stream = await runAgentStream({
      agent,
      messages,
      context: mode === 'web' ? null : fileContext,
      toolContext: { fileContext: mode === 'web' ? null : fileContext },
      temperature: 0
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  } catch (error) {
    console.error('[smoke] Model smoke test failed', {
      error: error instanceof Error ? error.name : 'UnknownError'
    })
    return NextResponse.json({ error: 'Smoke test failed' }, { status: 500 })
  }
}
