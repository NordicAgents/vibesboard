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
        return <p className="mb-1.5 last:mb-0 leading-[1.65]">{children}</p>
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

  if (isUser) {
    return (
      <div className="flex justify-end" {...props}>
        <div className="max-w-[82%] sm:max-w-[72%] rounded-[18px] bg-[#EDE8DE] px-4 py-2.5 text-[15px] leading-[1.65] text-[#1A1915] dark:bg-[#2E2B25] dark:text-[#E8E3D8]">
          <ChatMarkdown>{message.content}</ChatMarkdown>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-3" {...props}>
      {/* AI avatar */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E2DDD4] bg-[#FDFAF5] shadow-[0_1px_3px_rgba(26,25,21,0.06)] overflow-hidden dark:border-[#2E2B25] dark:bg-[#221F1A]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo_1.png"
          alt="agent"
          className="h-5 w-5 object-contain"
        />
      </div>

      {/* AI content — no bubble */}
      <div className="min-w-0 flex-1">
        {structured && defaultTab ? (
          <div className="rounded-2xl border border-[#E2DDD4] bg-[#FDFAF5] p-4 shadow-[0_1px_3px_rgba(26,25,21,0.06)] dark:border-[#2E2B25] dark:bg-[#221F1A]">
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
        ) : (
          <div className="text-[15px] leading-[1.65] text-[#1A1915] dark:text-[#E8E3D8]">
            <ChatMarkdown>{message.content}</ChatMarkdown>
          </div>
        )}

        {/* Copy action — appears below on hover */}
        <div className="mt-1.5 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <ChatMessageActions
            message={message}
            className="static opacity-100 md:static md:opacity-100"
          />
        </div>
      </div>
    </div>
  )
}
