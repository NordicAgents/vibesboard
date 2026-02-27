import { Message } from 'ai'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/ui/codeblock'
import { MemoizedReactMarkdown } from '@/components/markdown'
import { ChatMessageActions } from '@/components/chat-message-actions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface ChatMessageProps {
  message: Message
  agentAvatarGradient?: string
  agentAvatarInitial?: string
  isLastMessage?: boolean
}

const extractStructuredSections = (value: string) => {
  const text = value ?? ''
  const regex = /^#{2,3}\s+(overview|analysis|improvements?)\b.*$/gim
  const matches = Array.from(text.matchAll(regex)).map(match => ({
    key:
      match[1]?.toLowerCase() === 'improvement'
        ? 'improvements'
        : match[1]?.toLowerCase(),
    index: match.index ?? 0,
    headingLength: match[0].length
  }))

  if (!matches.length) return null

  matches.sort((a, b) => a.index - b.index)

  const sections: Partial<
    Record<'overview' | 'analysis' | 'improvements', string>
  > = {}

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    if (
      current.key !== 'overview' &&
      current.key !== 'analysis' &&
      current.key !== 'improvements'
    ) {
      continue
    }

    const lineEnd = text.indexOf('\n', current.index + current.headingLength)
    const start =
      lineEnd === -1 ? current.index + current.headingLength : lineEnd + 1
    const end = matches[i + 1]?.index ?? text.length
    const body = text.slice(start, end).trim()
    if (!body) continue

    if (!sections[current.key]) {
      sections[current.key] = body
    }
  }

  if (!sections.overview || !sections.analysis || !sections.improvements) {
    return null
  }

  return sections
}

const ChatMarkdown = ({
  children,
  isUser
}: {
  children: string
  isUser?: boolean
}) => (
  <MemoizedReactMarkdown
    className={cn(
      'prose break-words prose-p:leading-relaxed prose-pre:p-0 prose-sm max-w-none',
      isUser
        ? 'prose-invert'
        : 'dark:prose-invert prose-headings:font-serif prose-headings:font-normal'
    )}
    remarkPlugins={[remarkGfm, remarkMath]}
    components={{
      p({ children }) {
        return <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>
      },
      code({ node, inline, className, children, ...props }) {
        if (children.length) {
          if (children[0] == '▍') {
            return <span className="mt-1 animate-pulse cursor-default">▍</span>
          }
          children[0] = (children[0] as string).replace('`▍`', '▍')
        }

        const match = /language-(\w+)/.exec(className || '')

        if (inline) {
          return (
            <code
              className={cn(
                'rounded-[4px] px-1.5 py-0.5 text-xs font-mono',
                isUser
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EDE8DE] text-[#1A1915] dark:bg-[#2E2B25] dark:text-[#E8E3D8]'
              )}
              {...props}
            >
              {children}
            </code>
          )
        }

        return (
          <CodeBlock
            key={Math.random()}
            language={(match && match[1]) || ''}
            value={String(children).replace(/\n$/, '')}
            {...props}
          />
        )
      }
    }}
  >
    {children}
  </MemoizedReactMarkdown>
)

export function ChatMessage({
  message,
  agentAvatarGradient = 'from-[#D97757] to-[#CC785C]',
  agentAvatarInitial = 'A',
  isLastMessage,
  ...props
}: ChatMessageProps) {
  const isUser = message.role === 'user'
  const structured = !isUser
    ? extractStructuredSections(message.content ?? '')
    : null

  const defaultTab = structured?.overview
    ? 'overview'
    : structured?.analysis
      ? 'analysis'
      : structured?.improvements
        ? 'improvements'
        : null

  return (
    <div
      className={cn(
        'flex w-full gap-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
      {...props}
    >
      {/* AI avatar */}
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center self-start mt-1 rounded-full border border-[#E2DDD4] bg-[#FDFAF5] shadow-[0_1px_3px_rgba(26,25,21,0.06)] overflow-hidden dark:border-[#2E2B25] dark:bg-[#221F1A]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo_1.png"
            alt="agent"
            className="h-5 w-5 object-contain"
          />
        </div>
      )}

      {/* Message content */}
      <div
        className={cn(
          'group relative max-w-[85%] sm:max-w-[75%]',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {structured && defaultTab ? (
          /* Structured tabs view */
          <div className="rounded-2xl rounded-bl-sm border border-[#E2DDD4] bg-[#FDFAF5] p-4 shadow-[0_1px_3px_rgba(26,25,21,0.06)] dark:border-[#2E2B25] dark:bg-[#221F1A]">
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="mb-3 w-full justify-start bg-[#EDE8DE] dark:bg-[#2E2B25]">
                {structured.overview && (
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                )}
                {structured.analysis && (
                  <TabsTrigger value="analysis">Analysis</TabsTrigger>
                )}
                {structured.improvements && (
                  <TabsTrigger value="improvements">Improvements</TabsTrigger>
                )}
              </TabsList>
              {structured.overview && (
                <TabsContent value="overview">
                  <ChatMarkdown>{structured.overview}</ChatMarkdown>
                </TabsContent>
              )}
              {structured.analysis && (
                <TabsContent value="analysis">
                  <ChatMarkdown>{structured.analysis}</ChatMarkdown>
                </TabsContent>
              )}
              {structured.improvements && (
                <TabsContent value="improvements">
                  <ChatMarkdown>{structured.improvements}</ChatMarkdown>
                </TabsContent>
              )}
            </Tabs>
          </div>
        ) : isUser ? (
          /* User bubble — warm surface */
          <div className="rounded-2xl rounded-br-sm bg-[#FDFAF5] px-4 py-3 text-sm text-[#1A1915] shadow-[0_1px_3px_rgba(26,25,21,0.08)] border border-[#E2DDD4] dark:border-[#2E2B25] dark:bg-[#221F1A] dark:text-[#E8E3D8]">
            <ChatMarkdown isUser={false}>{message.content}</ChatMarkdown>
          </div>
        ) : (
          /* AI response — clean text, no bubble */
          <div className="py-1 text-sm text-[#1A1915] dark:text-[#E8E3D8]">
            <ChatMarkdown>{message.content}</ChatMarkdown>
          </div>
        )}

        {/* Copy action for AI messages */}
        {!isUser && (
          <div className="mt-1 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <ChatMessageActions
              message={message}
              className="static opacity-100 md:static md:opacity-100"
            />
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full border border-[#E2DDD4] bg-[#EDE8DE] shadow-[0_1px_3px_rgba(26,25,21,0.06)] dark:border-[#2E2B25] dark:bg-[#2E2B25]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 text-[#9D9790]"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </div>
  )
}
