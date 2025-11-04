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

export const runtime = 'nodejs'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

export async function POST(req: Request) {
  const cookieStore = cookies()
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
    cookies: () => cookieStore
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

  const response = await openai.createChatCompletion({
    model: 'gpt-4o-mini',
    stream: true,
    temperature: 0.2,
    messages: initialMessages as any,
    functions: functions as any,
    function_call: 'auto'
  } as any)

  const stream = OpenAIStream(response as any, {
    experimental_onFunctionCall: async (
      call: any,
      createFunctionCallMessages: (result: any) => any[]
    ) => {
      if (call.name !== 'create_agent') return

      let args: any = {}
      try {
        if (typeof call.arguments === 'string') {
          args = call.arguments ? JSON.parse(call.arguments) : {}
        } else if (call.arguments && typeof call.arguments === 'object') {
          args = call.arguments
        } else {
          args = {}
        }
      } catch (_error) {
        args = {}
      }

      const name: string = typeof args.name === 'string' ? args.name : undefined as any
      const instructions: string =
        typeof args.instructions === 'string' ? args.instructions : undefined as any
      let allowAnonymous: boolean = true
      if (typeof args.allowAnonymous === 'boolean') {
        allowAnonymous = args.allowAnonymous
      } else if (typeof args.allowAnonymous === 'string') {
        const v = args.allowAnonymous.toLowerCase().trim()
        allowAnonymous = v === 'true' || v === 'yes' || v === 'y'
      }
      const toolIdsRaw: any[] = Array.isArray(args.tools) ? args.tools : []
      const toolIds: string[] = toolIdsRaw
        .map((t: any) => (typeof t === 'string' ? t : null))
        .filter(Boolean) as string[]
      const fileKeys: string[] = Array.isArray(args.fileKeys)
        ? args.fileKeys
        : []

      const normalizeId = (val: string) => {
        const base = val.toLowerCase().trim().replace(/[\s-]+/g, '_')
        const withPrefix = base.startsWith('builtin:') ? base : `builtin:${base}`
        return withPrefix
      }

      const tools = toolIds
        .map(id => {
          const norm = normalizeId(id)
          const def = (BUILTIN_AGENT_TOOLS as any)[norm]
          if (!def) return null
          return {
            id: norm,
            type: norm,
            name: def.name,
            description: def.description
          }
        })
        .filter(Boolean)

      // Validate payload via schema for safety (be tolerant and guide the model)
      const validation = upsertAgentSchema.safeParse({
        name,
        instructions,
        fileKeys,
        tools,
        allowAnonymous
      })

      if (!validation.success) {
        const issues = validation.error.issues?.map(i => ({
          path: i.path?.join('.') ?? '',
          message: i.message
        }))

        const newMessages = createFunctionCallMessages({
          ok: false,
          error:
            'Missing or invalid fields. Please ask the user to provide/fix them and then call create_agent again.',
          issues
        })

        return openai.createChatCompletion({
          model: 'gpt-4o-mini',
          stream: true,
          temperature: 0.2,
          messages: [...(initialMessages as any), ...newMessages],
          functions: functions as any,
          function_call: 'auto'
        } as any)
      }

      const parsed = validation.data

      // Generate unique slug for agent_url
      const slug = await ensureUniqueSlug(createAgentSlug(parsed.name), supabase)

      const { data, error } = await supabase
        .from('vibe_agents')
        .insert({
          user_id: session.user.id,
          name: parsed.name,
          instructions: parsed.instructions,
          file_keys: parsed.fileKeys,
          tools: parsed.tools as any,
          allow_anonymous: parsed.allowAnonymous,
          agent_url: slug
        })
        .select('*')
        .single()

      if (error || !data) {
        const newMessages = createFunctionCallMessages({
          ok: false,
          error: error?.message ?? 'Unable to create agent.'
        })
        return openai.createChatCompletion({
          model: 'gpt-4o-mini',
          stream: true,
          temperature: 0.2,
          messages: [...(initialMessages as any), ...newMessages],
          functions: functions as any,
          function_call: 'auto'
        } as any)
      }

      const dashboardUrl = `/agents/${data.id}`
      const publicUrl = `/a/${data.agent_url}`

      const newMessages = createFunctionCallMessages({
        ok: true,
        agentId: data.id,
        dashboardUrl,
        publicUrl
      })

      return openai.createChatCompletion({
        model: 'gpt-4o-mini',
        stream: true,
        temperature: 0.2,
        messages: [...(initialMessages as any), ...newMessages],
        functions: functions as any,
        function_call: 'auto'
      } as any)
    }
  })

  return new StreamingTextResponse(stream)
}
