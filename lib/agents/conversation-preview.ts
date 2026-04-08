import { type Message } from '@/lib/types/message'

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

const LOW_SIGNAL_PATTERN =
  /^(hi|hello|hey|yo|sup|howdy|hiya|good\s*(morning|afternoon|evening|day)|greetings|what'?s?\s*up)[\s!?.,:;]*$/i

const cleanPreviewText = (value?: string | null) => {
  const cleaned = (value ?? '')
    .replace(UUID_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null
  return cleaned
}

const isLowSignal = (text: string) => LOW_SIGNAL_PATTERN.test(text.trim())

export function getConversationPreview(
  messages: Message[],
  summary?: string | null,
  fallback = 'Visitor conversation'
) {
  const userMessages = messages.filter(
    message => message.role === 'user' && cleanPreviewText(message.content)
  )
  const substantiveUserMessage = userMessages.find(
    m => !isLowSignal(m.content)
  )
  const firstUserMessage = substantiveUserMessage ?? userMessages[0]

  const latestMessageWithContent = [...messages]
    .reverse()
    .find(message => cleanPreviewText(message.content))

  const label =
    cleanPreviewText(summary) ??
    cleanPreviewText(firstUserMessage?.content) ??
    cleanPreviewText(latestMessageWithContent?.content)

  if (!label) return fallback
  if (label.length <= 110) return label

  const truncated = label.slice(0, 110)
  const lastWordBoundary = truncated.lastIndexOf(' ')
  if (lastWordBoundary > 60) {
    return `${truncated.slice(0, lastWordBoundary)}…`
  }

  return `${truncated}…`
}
