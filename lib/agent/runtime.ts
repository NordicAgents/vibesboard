import { OpenAIStream } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'
import { type Message } from 'ai'

import { buildAgentSystemPrompt } from './prompts'
import { type VibeAgent } from '@/lib/types'
import { buildToolKit, type ToolExecutionContext } from './tools'
import { runAgentGraph } from './graph'

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

  if (toolkit.functions.length) {
    const finalMessages = await runAgentGraph({
      openai,
      agent,
      context,
      messages,
      functions: toolkit.functions,
      executors: toolkit.executors,
      temperature
    })

    const completionMessage = [...finalMessages]
      .reverse()
      .find(message => message.role === 'assistant')

    const completion = completionMessage?.content ?? ''

    if (onCompletion) {
      await onCompletion(completion)
    }

    return stringToStream(completion)
  }

  const systemPrompt = buildAgentSystemPrompt(agent, context)
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
    model: 'gpt-4o-mini',
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

const stringToStream = (value: string) => {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(value))
      controller.close()
    }
  })
}
