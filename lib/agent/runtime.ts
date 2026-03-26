import { OpenAIStream } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'
import { type Message } from 'ai'

import { buildAgentSystemPrompt } from './prompts'
import { buildAgentContext } from './context-builder'
import { type VibeAgent } from '@/lib/types'
import { type ToolExecutionContext, type ToolKit } from './tools'
import {
  OPENAI_CHAT_MODEL,
  completeText,
  isResponsesModel,
  streamText,
  type ResponsesApiTool
} from '@/lib/openai'

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

  const model = OPENAI_CHAT_MODEL
  const isResponses = isResponsesModel(model)

  // Build context by pre-loading file content and source URLs.
  // This also prunes the toolkit (removes file_search if all files fit in context).
  // NOTE: dispose() must be called after the stream completes — not before — so
  // that retriever-owned sandboxes (e.g. BashRetriever) remain live during tool execution.
  const agentContext = await buildAgentContext(agent, toolContext)
  const effectiveContext = agentContext.contextText || context || null
  const toolkit = agentContext.toolkit

  if (isResponses && toolkit.functions.length) {
    return runResponsesAgentWithTools({
      agent,
      messages,
      context: effectiveContext,
      toolkit,
      model,
      previewToken,
      onCompletion: async (completion) => {
        await agentContext.dispose()
        if (onCompletion) await onCompletion(completion)
      },
      toolContext,
      hasFileOverflow: agentContext.hasFileOverflow
    })
  }

  const systemPrompt = buildAgentSystemPrompt(agent, effectiveContext, {
    hasFileOverflow: agentContext.hasFileOverflow
  })

  if (isResponses) {
    const conversation = formatConversation(messages)
    const prompt = `${systemPrompt}\n\n${
      conversation ? `Conversation so far:\n${conversation}` : ''
    }`

    const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null
    const stream = await streamText({
      prompt,
      model,
      apiKey,
      async onDone(completion) {
        await agentContext.dispose()
        if (onCompletion) await onCompletion(completion)
      }
    })

    return stream
  }

  const systemPromptLegacy = buildAgentSystemPrompt(agent, effectiveContext)
  const payload = [
    { role: 'system' as const, content: systemPromptLegacy },
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
      await agentContext.dispose()
      if (onCompletion) await onCompletion(completion)
    }
  })
}

function formatConversation(messages: Message[]): string {
  return messages
    .map(
      message =>
        `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${
          typeof message.content === 'string' ? message.content : ''
        }`
    )
    .join('\n\n')
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
  hasFileOverflow?: boolean
}

/**
 * Use native OpenAI Responses API tool calling.
 * 1. Call completeText() with tools — the API decides whether to call a tool.
 * 2. If a tool was called, execute it and build a follow-up prompt.
 * 3. Stream the final answer via streamText().
 */
const runResponsesAgentWithTools = async ({
  agent,
  messages,
  context,
  toolkit,
  model,
  previewToken,
  onCompletion,
  toolContext,
  hasFileOverflow
}: ResponsesAgentWithToolsArgs) => {
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null
  const systemPrompt = buildAgentSystemPrompt(agent, context, { hasFileOverflow })
  const conversation = formatConversation(messages)

  // Convert toolkit functions to Responses API tool format
  const tools: ResponsesApiTool[] = toolkit.functions.map(fn => ({
    type: 'function' as const,
    name: fn.name,
    description: fn.description ?? 'No description.',
    parameters: fn.parameters && Object.keys(fn.parameters).length
      ? fn.parameters
      : { type: 'object', properties: {} }
  }))

  const prompt =
    `${systemPrompt}\n\n` +
    `Conversation so far:\n` +
    (conversation || '(no prior messages).')

  // Step 1: Call with native tools — model decides whether to use a tool
  const decision = await completeText({
    prompt,
    model,
    apiKey,
    tools
  })

  // Step 2: If model chose a tool, execute it
  let toolResult: string | null = null
  let chosenTool: string | null = null
  let toolArgs: Record<string, any> = {}

  if (decision.toolCalls.length > 0) {
    const call = decision.toolCalls[0]
    chosenTool = call.name
    toolArgs = call.arguments
    const executor = toolkit.executors[chosenTool]

    if (executor) {
      try {
        toolResult = await executor(toolArgs, {
          fileContext: toolContext?.fileContext ?? context
        })
      } catch (error) {
        toolResult = `Tool ${chosenTool} failed: ${error}`
      }
    }
  }

  // Step 3: Build final prompt and stream the answer
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
      'Now answer the user based on the tool result. Do not mention internal tool details.'
    )
  } else {
    finalPromptParts.push(
      '',
      'Answer the user directly based on the conversation.'
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
