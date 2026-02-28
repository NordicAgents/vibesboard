'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { useAtBottom } from '@/lib/hooks/use-at-bottom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { IconArrowDown } from '@/components/ui/icons'

export function ButtonScrollToBottom({ className, ...props }: ButtonProps) {
  const isAtBottom = useAtBottom()

  return (
    <Button
      variant="outline"
      size="icon"
      className={cn(
        'fixed bottom-24 right-6 z-10 size-8 rounded-full border border-[#E2DDD4] bg-[#FDFAF5] shadow-md transition-all duration-300 hover:bg-[#EDE8DE] dark:border-[#2E2B25] dark:bg-[#221F1A] dark:hover:bg-[#2E2B25]',
        isAtBottom ? 'pointer-events-none opacity-0' : 'opacity-100',
        className
      )}
      onClick={() => {
        const scrollContainer = document.querySelector('[data-chat-scroll]')
        if (scrollContainer) {
          scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' })
        }
      }}
      {...props}
    >
      <IconArrowDown />
      <span className="sr-only">Scroll to bottom</span>
    </Button>
  )
}
