import { type Message } from '@/lib/types/message'
import { OPENAI_CHAT_MODEL, completeText, isResponsesModel } from '@/lib/openai'
import { chatCompletion } from '@/lib/openai-compat'

const SUMMARY_SYSTEM_PROMPT =
  'You write <=15 word neutral summaries for chat transcripts. Mention the agent topic if available.'

export async function summarizeConversation(
  messages: Message[]
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }

  const recent = messages.slice(-8).map(message => ({
    role: (message.role === 'function' ? 'assistant' : message.role) as
      | 'system'
      | 'user'
      | 'assistant',
    content: truncate(message.content, 500)
  }))

  try {
    if (isResponsesModel(OPENAI_CHAT_MODEL)) {
      const prompt =
        `${SUMMARY_SYSTEM_PROMPT}\n\n` +
        recent
          .map(entry => `${entry.role.toUpperCase()}: ${entry.content}`)
          .join('\n\n')

      const completion = await completeText({ prompt })
      const trimmed = completion.text?.trim()
      return trimmed || null
    }

    const json = await chatCompletion({
      model: OPENAI_CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 60,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        ...recent
      ]
    })

    const content = json?.choices?.[0]?.message?.content?.trim()
    return content ?? null
  } catch (error) {
    console.error('Failed to summarize conversation', error)
    return null
  }
}

const truncate = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length)}…` : value
