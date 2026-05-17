'use client'

import * as React from 'react'

import { cn } from '@vibesboard/utils'
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
        'fixed bottom-24 right-6 z-10 size-8 rounded-full border border-[#e4e3e3] bg-[#f5f8f7] shadow-md transition-all duration-300 hover:bg-[#e6ede6] dark:border-[#344348] dark:bg-[#192425] dark:hover:bg-[#344348]',
        isAtBottom ? 'pointer-events-none opacity-0' : 'opacity-100',
        className
      )}
      onClick={() => {
        const scrollContainer = document.querySelector('[data-chat-scroll]')
        if (scrollContainer) {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
          })
        }
      }}
      {...props}
    >
      <IconArrowDown />
      <span className="sr-only">Scroll to bottom</span>
    </Button>
  )
}
