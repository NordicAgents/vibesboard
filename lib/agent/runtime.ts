import { OpenAIStream } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'
import { type Message } from 'ai'

import { buildAgentSystemPrompt } from './prompts'
import { type VibeAgent } from '@/lib/types'

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
}

export async function runAgentStream({
  agent,
  messages,
  context,
  previewToken,
  temperature = 0.1,
  onCompletion
}: RunAgentStreamArgs) {
  if (previewToken) {
    configuration.apiKey = previewToken
  }

  const systemPrompt = buildAgentSystemPrompt(agent, context)
  const payload = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(message => ({
      role: message.role,
      content: message.content
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
