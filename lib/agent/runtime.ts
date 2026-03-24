import { OpenAIStream } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'
import { type Message } from 'ai'

import { buildAgentSystemPrompt } from './prompts'
import { type VibeAgent } from '@/lib/types'
import { buildToolKit, type ToolExecutionContext, type ToolKit } from './tools'
import { OPENAI_CHAT_MODEL, completeText, isResponsesModel, streamText } from '@/lib/openai'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

interface RunAgentStreamArgs {
  agent: VibeAgent
  messages: Message[]
  context?: string | null
  previewToken?: string | null
  temperature?: number
  onCompletion?: (completion: string) => Promise<void> | void
  toolContext?: ToolExecutionContext
}

export async function runAgentStream({
  agent,
  messages,
  context,
  previewToken,
  temperature = 0.1,
  onCompletion,
  toolContext
}: RunAgentStreamArgs) {
  if (previewToken) {
    configuration.apiKey = previewToken
  } else if (process.env.OPENAI_API_KEY) {
    configuration.apiKey = process.env.OPENAI_API_KEY
  }

  const toolkit = buildToolKit(agent, {
    fileContext: toolContext?.fileContext ?? context
  })

  const model = OPENAI_CHAT_MODEL
  const isResponses = isResponsesModel(model)

  if (toolkit.functions.length) {
    const stream = await runResponsesAgentWithTools({
      agent,
      messages,
      context,
      toolkit,
      model,
      previewToken,
      onCompletion,
      toolContext
    })
    return stream
  }

  const systemPrompt = buildAgentSystemPrompt(agent, context)
  if (isResponses) {
    const conversation = messages
      .map(
        message =>
          `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${
            typeof message.content === 'string' ? message.content : ''
          }`
      )
      .join('\n\n')

    const prompt = `${systemPrompt}\n\n${
      conversation ? `Conversation so far:\n${conversation}` : ''
    }`

    const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null
    const stream = await streamText({
      prompt,
      model,
      apiKey,
      async onDone(completion) {
        if (onCompletion) {
          await onCompletion(completion)
        }
      }
    })

    return stream
  }

  const payload = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(message => ({
      role: message.role,
      content: message.content,
      name: message.name,
      function_call: message.function_call
    }))
  ]

  const response = await openai.createChatCompletion({
    model,
    stream: true,
    temperature,
    messages: payload as any
  })

  return OpenAIStream(response, {
    async onCompletion(completion) {
      if (onCompletion) {
        await onCompletion(completion)
      }
    }
  })
}

interface ResponsesAgentWithToolsArgs {
  agent: VibeAgent
  messages: Message[]
  context?: string | null
  toolkit: ToolKit
  model: string
  previewToken?: string | null
  onCompletion?: (completion: string) => Promise<void> | void
  toolContext?: ToolExecutionContext
}

const runResponsesAgentWithTools = async ({
  agent,
  messages,
  context,
  toolkit,
  model,
  previewToken,
  onCompletion,
  toolContext
}: ResponsesAgentWithToolsArgs) => {
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null

  const systemPrompt = buildAgentSystemPrompt(agent, context)

  const toolsDescription = toolkit.functions
    .map(fn => {
      const params =
        fn.parameters && Object.keys(fn.parameters).length
          ? JSON.stringify(fn.parameters)
          : '{}'
      return `- ${fn.name}: ${fn.description ?? 'No description.'} Params: ${params}`
    })
    .join('\n')

  const conversation = messages
    .map(
      message =>
        `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${
          typeof message.content === 'string' ? message.content : ''
        }`
    )
    .join('\n\n')

  const planningPrompt =
    `${systemPrompt}\n\n` +
    `You have access to the following tools:\n${toolsDescription || 'No tools.'}\n\n` +
    `Tool usage protocol:\n` +
    `- Decide whether you need exactly one tool call to answer the user.\n` +
    `- If you need a tool, respond with STRICT JSON on a single line with this shape:\n` +
    `  {"tool": "<tool_name>", "arguments": { ... }}\n` +
    `- If you do not need any tool, respond with:\n` +
    `  {"tool": null, "arguments": {}}\n` +
    `Do not include any other text.\n\n` +
    `Conversation so far:\n` +
    (conversation || '(no prior messages).')

  const decisionText = await completeText({
    prompt: planningPrompt,
    model,
    apiKey
  })

  let chosenTool: string | null = null
  let toolArgs: Record<string, any> = {}

  try {
    const parsed = JSON.parse(decisionText.trim())
    if (
      parsed &&
      typeof parsed === 'object' &&
      Object.prototype.hasOwnProperty.call(parsed, 'tool')
    ) {
      if (typeof parsed.tool === 'string' && toolkit.executors[parsed.tool]) {
        chosenTool = parsed.tool
        if (parsed.arguments && typeof parsed.arguments === 'object') {
          toolArgs = parsed.arguments as Record<string, any>
        }
      } else {
        chosenTool = null
      }
    }
  } catch {
    chosenTool = null
    toolArgs = {}
  }

  let toolResult: string | null = null
  if (chosenTool) {
    const executor = toolkit.executors[chosenTool]
    try {
      toolResult = await executor(toolArgs, {
        fileContext: toolContext?.fileContext ?? context
      })
    } catch (error) {
      toolResult = `Tool ${chosenTool} failed: ${error}`
    }
  }

  const finalPromptParts: string[] = [
    systemPrompt,
    '',
    'Conversation so far:',
    conversation || '(no prior messages).'
  ]

  if (chosenTool && toolResult !== null) {
    finalPromptParts.push(
      '',
      `Tool used: ${chosenTool}`,
      `Tool arguments (JSON): ${JSON.stringify(toolArgs)}`,
      'Tool result:',
      toolResult,
      '',
      'Now answer the user. Do not mention internal tool JSON.'
    )
  } else {
    finalPromptParts.push(
      '',
      'You decided that no tools are required. Answer the user directly based on the conversation.'
    )
  }

  const finalPrompt = finalPromptParts.join('\n')

  const stream = await streamText({
    prompt: finalPrompt,
    model,
    apiKey,
    async onDone(completion) {
      if (onCompletion) {
        await onCompletion(completion)
      }
    }
  })

  return stream
}
