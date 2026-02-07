import { NextResponse } from 'next/server'
import { StreamingTextResponse, type Message } from 'ai'

import { runAgentStream } from '@/lib/agent/runtime'
import { type VibeAgent } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'file'
  // Minimal in-memory agent with built-in tools enabled
  const agent: VibeAgent = {
    id: 'smoke-agent',
    userId: 'smoke-user',
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
        id: 'builtin:search',
        type: 'builtin:search',
        name: 'Search',
        description: 'Web search via DuckDuckGo.'
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
              'Call the web_search tool with query "OpenAI". After receiving the tool result, reply with ONLY the first 8 words of the tool output.'
          }
        ]
      : [
          {
            id: 'm1',
            role: 'user',
            // Strongly nudge the model to call the tool
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

    return new StreamingTextResponse(stream)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Smoke test failed' },
      { status: 500 }
    )
  }
}
