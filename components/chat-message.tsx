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
      'prose prose-sm max-w-none break-words prose-p:leading-relaxed prose-pre:p-0',
      isUser
        ? 'prose-invert'
        : 'dark:prose-invert prose-headings:font-sans prose-headings:font-medium'
    )}
    remarkPlugins={[remarkGfm, remarkMath]}
    components={{
      p({ children }) {
        return <p className="mb-1.5 leading-[1.65] last:mb-0">{children}</p>
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
                'rounded-[4px] px-1.5 py-0.5 font-mono text-xs',
                isUser
                  ? 'bg-white/20 text-white'
                  : 'bg-[#f5f8f7] text-[#222f30] dark:bg-[#222f30] dark:text-[#f5f8f7]'
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
  agentAvatarGradient = 'from-[#cef79e] to-[#a7e26e]',
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
        <div className="max-w-[88%] rounded-[18px] bg-[#f5f8f7] px-4 py-2.5 text-[15px] leading-[1.65] text-[#222f30] dark:bg-[#222f30] dark:text-[#f5f8f7] sm:max-w-[72%]">
          <ChatMarkdown>{message.content}</ChatMarkdown>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-3" {...props}>
      {/* AI avatar */}
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e4e3e3] bg-[#f5f8f7] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-[#344348] dark:bg-[#192425]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_1.png" alt="agent" className="size-5 object-contain" />
      </div>

      {/* AI content — no bubble */}
      <div className="min-w-0 flex-1">
        {structured && defaultTab ? (
          <div className="rounded-none border border-[#e4e3e3] bg-[#f5f8f7] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-[#344348] dark:bg-[#192425]">
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="mb-3 w-full justify-start bg-[#e6ede6] dark:bg-[#253435]">
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
          <div className="text-[15px] leading-[1.65] text-[#222f30] dark:text-[#f5f8f7]">
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
