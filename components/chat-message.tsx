import { Message } from 'ai'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/ui/codeblock'
import { MemoizedReactMarkdown } from '@/components/markdown'
import { IconOpenAI, IconUser } from '@/components/ui/icons'
import { ChatMessageActions } from '@/components/chat-message-actions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface ChatMessageProps {
  message: Message
}

const extractStructuredSections = (value: string) => {
  const text = value ?? ''
  const regex = /^#{2,3}\s+(overview|analysis|improvements?)\b.*$/gim
  const matches = Array.from(text.matchAll(regex)).map(match => ({
    key: match[1]?.toLowerCase() === 'improvement' ? 'improvements' : match[1]?.toLowerCase(),
    index: match.index ?? 0,
    headingLength: match[0].length
  }))

  if (!matches.length) return null

  matches.sort((a, b) => a.index - b.index)

  const sections: Partial<Record<'overview' | 'analysis' | 'improvements', string>> =
    {}

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
    const start = lineEnd === -1 ? current.index + current.headingLength : lineEnd + 1
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

const ChatMarkdown = ({ children }: { children: string }) => (
  <MemoizedReactMarkdown
    className="prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0"
    remarkPlugins={[remarkGfm, remarkMath]}
    components={{
      p({ children }) {
        return <p className="mb-2 last:mb-0">{children}</p>
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
            <code className={className} {...props}>
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

export function ChatMessage({ message, ...props }: ChatMessageProps) {
  const structured =
    message.role === 'assistant'
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
        'group relative mb-4 flex items-start',
        message.role === 'user' ? 'flex-row-reverse md:ml-12' : 'md:-ml-12'
      )}
      {...props}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-md border shadow',
          message.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-white dark:bg-primary text-primary-foreground'
        )}
      >
        {message.role === 'user' ? <IconUser /> : <IconOpenAI />}
      </div>
      <div className={cn(
        'flex-1 space-y-2 overflow-hidden px-1',
        message.role === 'user' ? 'mr-4' : 'ml-4'
      )}>
        {structured && defaultTab ? (
          <div className="rounded-xl border bg-muted/30 p-3">
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="w-full justify-start">
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
          <ChatMarkdown>{message.content}</ChatMarkdown>
        )}
        <ChatMessageActions message={message} />
      </div>
    </div>
  )
}
