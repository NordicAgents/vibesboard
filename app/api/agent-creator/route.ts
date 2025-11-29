import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { Configuration, OpenAIApi } from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import {
  BUILTIN_AGENT_TOOLS,
  createAgentSlug,
  ensureUniqueSlug
} from '@/lib/agents/db'
import { upsertAgentSchema } from '@/lib/agents/schema'
import { OPENAI_CHAT_MODEL, completeText, isResponsesModel } from '@/lib/openai'

export const runtime = 'nodejs'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const json = await req.json()
  const { messages = [], previewToken } = json ?? {}

  if (previewToken) {
    configuration.apiKey = previewToken
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const availableTools = Object.values(BUILTIN_AGENT_TOOLS).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description
  }))

  const systemPrompt = `You are an assistant that helps users create a "VibeAgent" by asking a few concise questions.
Ask only what is missing, be brief, and confirm before creating.

Fields to collect:
- name (short, friendly, 2-120 chars)
- instructions (clear guidance on tone, behavior, sources)
- allowAnonymous (true/false; default true)
- tools (zero or more from the available list of builtin tools by id)

Available tools (ids): ${availableTools
      .map(t => `${t.id} – ${t.name}: ${t.description}`)
      .join(' | ')}

When the user confirms creation, call the function create_agent with:
{
  name: string,
  instructions: string,
  allowAnonymous?: boolean,
  tools?: string[] (tool ids from the list),
  fileKeys?: string[] (optional; can be omitted)
}
If unsure, ask a clarifying question instead of assuming.`

  const initialMessages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(messages) ? messages : [])
  ]

  const functions = [
    {
      name: 'create_agent',
      description:
        'Create the agent with the collected fields and return its URLs.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          instructions: { type: 'string', minLength: 10 },
          allowAnonymous: { type: 'boolean' },
          tools: {
            type: 'array',
            items: {
              type: 'string',
              enum: Object.keys(BUILTIN_AGENT_TOOLS)
            },
            description: 'List of builtin tool ids to enable.'
          },
          fileKeys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional uploaded file keys to ground the agent.'
          }
        },
        required: ['name', 'instructions']
      }
    }
  ]

  const model = OPENAI_CHAT_MODEL
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null

  if (isResponsesModel(model)) {
    const history = initialMessages
      .map((m: any) => {
        if (m.role === 'system') {
          return `System: ${m.content}`
        }
        return `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${
          typeof m.content === 'string' ? m.content : ''
        }`
      })
      .join('\n\n')

    const prompt = history
    const completion = await completeText({ prompt, model, apiKey })
    const stream = stringToStream(completion)
    return new StreamingTextResponse(stream)
  }

  const response = await openai.createChatCompletion({
    model,
    stream: true,
    temperature: 0.2,
    messages: initialMessages as any,
    functions: functions as any,
    function_call: 'auto'
  } as any)

  const stream = OpenAIStream(response as any)

  return new StreamingTextResponse(stream)
}

const stringToStream = (value: string) => {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(value))
      controller.close()
    }
  })
}
