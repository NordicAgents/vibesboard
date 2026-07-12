import { type Message } from '@vibesboard/contracts'
import { OPENAI_CHAT_MODEL, completeText, isResponsesModel } from '@vibesboard/adapter-openai'
import { chatCompletion } from '@vibesboard/adapter-openai'
import { generateText } from 'ai'
import { resolveProviderSpec } from './tenant-llm-config.ts'
import { buildProviderModel } from './provider-registry.ts'

const SUMMARY_SYSTEM_PROMPT =
  'You write <=15 word neutral summaries for chat transcripts. Mention the agent topic if available.'

export async function summarizeConversation(
  messages: Message[],
  tenantId?: string
): Promise<string | null> {
  const recent = messages.slice(-8).map(message => ({
    role: (message.role === 'function' ? 'assistant' : message.role) as
      | 'system'
      | 'user'
      | 'assistant',
    content: truncate(message.content, 500)
  }))

  try {
    // Prefer tenant BYO-LLM config
    if (tenantId) {
      const spec = await resolveProviderSpec(tenantId, null, undefined, 'chat').catch(() => null)
      if (spec) {
        const { text } = await generateText({
          model: buildProviderModel(spec),
          messages: [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }, ...recent],
          maxTokens: 60,
          temperature: 0.2,
        })
        return text.trim() || null
      }
    }

    // Fall back to platform key
    if (!process.env.OPENAI_API_KEY) return null

    if (isResponsesModel(OPENAI_CHAT_MODEL)) {
      const prompt =
        `${SUMMARY_SYSTEM_PROMPT}\n\n` +
        recent.map(e => `${e.role.toUpperCase()}: ${e.content}`).join('\n\n')
      const completion = await completeText({ prompt })
      return completion.text?.trim() || null
    }

    const json = await chatCompletion({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 60,
      messages: [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }, ...recent]
    })
    return json?.choices?.[0]?.message?.content?.trim() ?? null
  } catch (error) {
    console.error('Failed to summarize conversation', error)
    return null
  }
}

const truncate = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length)}…` : value
