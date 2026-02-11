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
      isUser ? 'prose-invert' : 'dark:prose-invert'
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
                'rounded px-1 py-0.5 text-xs font-mono',
                isUser ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
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
  agentAvatarGradient = 'from-violet-400 to-purple-500',
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
        'flex w-full gap-2.5',
        isUser ? 'justify-end' : 'justify-start'
      )}
      {...props}
    >
      {/* AI avatar */}
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center self-start mt-1 rounded-full border border-border/50 bg-background shadow-sm overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo_1.png"
            alt="agent"
            className="h-5 w-5 object-contain"
          />
        </div>
      )}

      {/* Bubble */}
      <div
        className={cn(
          'group relative max-w-[85%] sm:max-w-[75%]',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {structured && defaultTab ? (
          <div className="rounded-2xl rounded-bl-sm border border-border/50 bg-muted/40 p-3 shadow-sm">
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="w-full justify-start mb-2">
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
        ) : (
          <div
            className={cn(
              'rounded-2xl px-4 py-2.5 text-sm shadow-sm',
              isUser
                ? 'rounded-br-sm bg-primary text-primary-foreground'
                : 'rounded-bl-sm border border-border/40 bg-muted/50 text-foreground dark:bg-muted/30'
            )}
          >
            <ChatMarkdown isUser={isUser}>{message.content}</ChatMarkdown>
          </div>
        )}
        {/* Copy action for AI messages */}
        {!isUser && (
          <div className="mt-0.5 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <ChatMessageActions
              message={message}
              className="static opacity-100 md:static md:opacity-100"
            />
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full bg-muted border border-border/50 shadow-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 text-muted-foreground"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </div>
  )
}
