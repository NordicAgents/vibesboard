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
import { OPENAI_CHAT_MODEL, isResponsesModel, streamText } from '@/lib/openai'

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

  const systemPrompt = `You are an assistant that helps users create a "VibeAgent" through a conversational, step-by-step process.

Your goal: Make agent creation easy and delightful. Guide users progressively through:
1. Understanding their needs (website URL or files + description)
2. Suggesting a friendly agent name
3. Formulating clear instructions
4. Creating a welcoming greeting message

**Available Tools:**
${availableTools
      .map(t => `- ${t.id}: ${t.name} – ${t.description}`)
      .join('\n')}

**Core Process:**

If user provides a **website URL**:
- Acknowledge you'll analyze it
- Based on the content (imagine fetching it), suggest a name, instructions, and greeting
- Ask if they want to adjust anything before creating

If user provides **files** (they'll be uploaded separately):
- Reference the uploaded files in your suggestions
- Suggest name, instructions, and greeting based on the file context

If user provides just a **description**:
- Ask clarifying questions to understand the agent's purpose
- Suggest name, instructions, and greeting accordingly

**Required fields to collect:**
- name (2-120 chars, friendly and clear)
- instructions (detailed guidance on behavior, tone, and purpose)
- greetingText (warm, welcoming first message users will see)
- allowAnonymous (default: true, ask only if relevant)
- tools (suggest relevant tools based on needs, use tool IDs from the list above)

**IMPORTANT - Form Updates:**
Whenever you suggest values for the agent, include them in a special JSON block like this:

~~~agentupdate
{
  "name": "suggested name",
  "instructions": "suggested instructions",
  "greetingText": "suggested greeting",
  "tools": ["builtin:web"]
}
~~~

This lets the UI update the form in real-time. Include this block AFTER your explanation.

**Functions to call:**

1. **create_agent** - When user confirms, create the agent with all fields
   Parameters: { name: string, instructions: string, greetingText: string, allowAnonymous?: boolean, tools?: string[], fileKeys?: string[] }

**Interaction style:**
- Be conversational and encouraging  
- Suggest values and include the agentupdate block so the form updates
- Be brief but helpful
- Confirm before calling create_agent`

  const initialMessages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(messages) ? messages : [])
  ]

  const functions = [
    {
      name: 'create_agent',
      description: 'Creates the agent with all collected fields when user confirms.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          instructions: { type: 'string', minLength: 10 },
          greetingText: { type: 'string' },
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
        required: ['name', 'instructions', 'greetingText']
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
        return `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${typeof m.content === 'string' ? m.content : ''
          }`
      })
      .join('\n\n')

    const prompt = history
    const stream = await streamText({ prompt, model, apiKey })
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
