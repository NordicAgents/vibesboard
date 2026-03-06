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
        'fixed bottom-24 right-6 z-10 size-8 rounded-full border border-[#E5E5E5] bg-[#F7F7F5] shadow-md transition-all duration-300 hover:bg-[#EFEFED] dark:border-[#2A2A2A] dark:bg-[#141414] dark:hover:bg-[#2A2A2A]',
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
