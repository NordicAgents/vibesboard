import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { Configuration, OpenAIApi } from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { z } from 'zod'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import {
  BUILTIN_AGENT_TOOLS,
  createAgentSlug,
  ensureUniqueSlug
} from '@/lib/agents/db'
import { upsertAgentSchema } from '@/lib/agents/schema'
import { getUserActiveTenant } from '@/lib/permissions'
import { ensurePersonalTenant } from '@/lib/tenant-context'
import { OPENAI_CHAT_MODEL, isResponsesModel } from '@/lib/openai'

export const runtime = 'nodejs'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

const DEFAULT_AGENT_CREATOR_MODEL = 'gpt-4o-mini'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const json = await req.json()
  const { messages = [], previewToken } = json ?? {}

  configuration.apiKey = previewToken ?? process.env.OPENAI_API_KEY
  if (!configuration.apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured.' },
      { status: 500 }
    )
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
  "tools": ["builtin:search"]
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

  const createAgentTool = {
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
          description: "Optional uploaded file keys to ground the agent's knowledge."
        }
      },
      required: ['name', 'instructions', 'greetingText']
    }
  }

  const tools = [
    {
      type: 'function',
      function: createAgentTool
    }
  ]

  const modelFromEnv = process.env.OPENAI_AGENT_CREATOR_MODEL?.trim()
  const preferredModel = modelFromEnv?.length ? modelFromEnv : OPENAI_CHAT_MODEL
  const model = isResponsesModel(preferredModel)
    ? DEFAULT_AGENT_CREATOR_MODEL
    : preferredModel

  const createAgentArgsSchema = z.object({
    name: z.string().min(2).max(120),
    instructions: z.string().min(10),
    greetingText: z.string().min(1),
    allowAnonymous: z.boolean().optional(),
    tools: z.array(z.string()).optional(),
    fileKeys: z.array(z.string()).optional()
  })

  const response = await openai.createChatCompletion({
    model,
    stream: true,
    temperature: 0.2,
    messages: initialMessages as any,
    tools: tools as any,
    tool_choice: 'auto'
  } as any)

  const stream = OpenAIStream(response as any, {
    async experimental_onToolCall(toolCallPayload) {
      const createAgentCall = toolCallPayload.tools.find(
        tool => tool.type === 'function' && tool.func?.name === 'create_agent'
      )

      if (!createAgentCall) {
        return
      }

      let args: unknown = createAgentCall.func.arguments
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args)
        } catch {
          // Leave as-is; validation will fail below.
        }
      }

      const parsed = createAgentArgsSchema.safeParse(args)
      if (!parsed.success) {
        const errorText = parsed.error.issues.map(i => i.message).join('; ')
        return `I couldn't create the agent automatically (${errorText}). Please review the form and click “Create Agent”.`
      }

      const sanitizedToolIds = (parsed.data.tools ?? []).filter(
        (toolId): toolId is keyof typeof BUILTIN_AGENT_TOOLS =>
          toolId in BUILTIN_AGENT_TOOLS
      )

      const toolsPayload = sanitizedToolIds.map(toolId => ({
        id: toolId,
        type: toolId,
        name: BUILTIN_AGENT_TOOLS[toolId].name,
        description: BUILTIN_AGENT_TOOLS[toolId].description
      }))

      const payload = upsertAgentSchema.parse({
        name: parsed.data.name,
        instructions: parsed.data.instructions,
        greetingText: parsed.data.greetingText,
        allowAnonymous: parsed.data.allowAnonymous ?? true,
        fileKeys: parsed.data.fileKeys ?? [],
        tools: toolsPayload
      })

      // Resolve the tenant the new agent should belong to.
      let tenantId = await getUserActiveTenant(session.user.id)
      if (!tenantId) {
        try {
          tenantId = await ensurePersonalTenant(session.user.id)
        } catch (error) {
          console.error('Failed to ensure personal tenant:', error)
        }
      }

      if (!tenantId) {
        return 'I could not create the agent because no workspace/tenant is available. Please create a tenant/workspace and try again.'
      }

      const slug = await ensureUniqueSlug(createAgentSlug(payload.name), supabase)

      const { data, error } = await supabase
        .from('vibe_agents')
        .insert({
          user_id: session.user.id,
          tenant_id: tenantId,
          name: payload.name,
          instructions: payload.instructions,
          file_keys: payload.fileKeys,
          tools: payload.tools,
          allow_anonymous: payload.allowAnonymous,
          agent_url: slug,
          ...(payload.greetingText !== undefined
            ? { greeting_text: payload.greetingText }
            : {})
        })
        .select('id')
        .single()

      if (error || !data) {
        console.error('Failed to create agent:', error)
        return `I couldn't create the agent automatically (${error?.message ?? 'Unknown error'}). Please click “Create Agent” in the preview panel.`
      }

      return `Done — your agent is created.\n\n~~~agentupdate\n${JSON.stringify(
        {
          name: payload.name,
          instructions: payload.instructions,
          greetingText: payload.greetingText ?? '',
          tools: sanitizedToolIds,
          allowAnonymous: payload.allowAnonymous,
          fileKeys: payload.fileKeys
        },
        null,
        2
      )}\n~~~\n\n~~~agentcreated\n${JSON.stringify({ id: data.id })}\n~~~`
    }
  })

  return new StreamingTextResponse(stream)
}
