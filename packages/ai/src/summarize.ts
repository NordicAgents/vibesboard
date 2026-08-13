import { type Message } from '@vibesboard/contracts'
import { OPENAI_CHAT_MODEL, completeText, isResponsesModel } from '@vibesboard/adapter-openai'
import { chatCompletion } from '@vibesboard/adapter-openai'
import { generateText } from 'ai'
import { resolveProviderSpec } from './tenant-llm-config.ts'
import { buildTenantProviderModel } from './provider-registry.ts'
import { shouldResolveTenantProvider } from './provider-routing.ts'

const SUMMARY_SYSTEM_PROMPT =
  'You write <=15 word neutral summaries for chat transcripts. Mention the agent topic if available.'

export async function summarizeConversation(
  messages: Message[],
  tenantId?: string
): Promise<string | null> {
  // ai v4's Message role union is system | user | assistant | data; the chat
  // completion APIs only accept the first three, so anything else (currently
  // just 'data') is folded into 'assistant'.
  const CHAT_ROLES = ['system', 'user', 'assistant'] as const
  const recent = messages.slice(-8).map(message => ({
    role: (CHAT_ROLES as readonly string[]).includes(message.role)
      ? (message.role as (typeof CHAT_ROLES)[number])
      : ('assistant' as const),
    content: truncate(message.content, 500)
  }))

  try {
    // Prefer tenant BYO-LLM config
    if (tenantId && shouldResolveTenantProvider({ tenantId })) {
      const spec = await resolveProviderSpec(tenantId, null, undefined, 'chat').catch(() => null)
      if (spec) {
        const { text } = await generateText({
          model: await buildTenantProviderModel(tenantId, spec),
          messages: [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }, ...recent],
          maxOutputTokens: 60,
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
