import * as React from 'react'
import Textarea from 'react-textarea-autosize'
import type { UseChatHelpers } from 'ai/react'

import { useEnterSubmit } from '@/lib/hooks/use-enter-submit'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import {
  IconArrowUp,
  IconPlus,
  IconMicrophone,
  IconImage
} from '@/components/ui/icons'
import { cn } from '@/lib/utils'

export interface PromptProps extends Pick<
  UseChatHelpers,
  'input' | 'setInput'
> {
  onSubmit: (value: string) => Promise<void>
  isLoading: boolean
  placeholder?: string
}

export function PromptForm({
  onSubmit,
  input,
  setInput,
  isLoading,
  placeholder = 'Send a message.'
}: PromptProps) {
  const { formRef, onKeyDown } = useEnterSubmit()
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  return (
    <form
      onSubmit={async e => {
        e.preventDefault()
        if (!input?.trim()) {
          return
        }
        setInput('')
        await onSubmit(input)
      }}
      ref={formRef}
    >
      <div className="relative flex max-h-60 w-full grow flex-col overflow-hidden bg-background px-4 py-3 sm:rounded-2xl sm:border border-input">
        <Textarea
          ref={inputRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          rows={1}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="min-h-[20px] w-full resize-none bg-transparent px-0 py-2 focus-within:outline-none sm:text-sm placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center justify-end pt-2">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  size="icon"
                  disabled={isLoading || input === ''}
                  className={cn(
                    'h-8 w-8 rounded-full transition-all duration-200',
                    input
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <IconArrowUp className="h-4 w-4" />
                  <span className="sr-only">Send message</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send message</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </form>
  )
}
