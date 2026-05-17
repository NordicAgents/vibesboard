'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface QuickSuggestionsProps {
  suggestions: string[]
  onSelect: (value: string) => void
  disabled?: boolean
  className?: string
}

export function QuickSuggestions({
  suggestions,
  onSelect,
  disabled = false,
  className
}: QuickSuggestionsProps) {
  if (!suggestions.length) {
    return null
  }

  return (
    <div
      className={cn('flex flex-wrap justify-center gap-2', className)}
      aria-label="Quick suggestions"
    >
      {suggestions.map((suggestion, idx) => (
        <motion.button
          key={`${idx}-${suggestion}`}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(suggestion)}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: idx * 0.05,
            duration: 0.2,
            ease: [0.16, 1, 0.3, 1]
          }}
          whileTap={{ scale: 0.96 }}
          className={cn(
            'rounded-full border border-[#e4e3e3] bg-[#f5f8f7] px-3.5 py-1.5 text-xs font-medium text-[#445e5f]',
            'shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-150',
            'hover:border-[#a7e26e]/30 hover:bg-[#e6ede6] hover:text-[#222f30]',
            'active:scale-[0.97]',
            'dark:border-[#344348] dark:bg-[#192425] dark:text-[#c9cbbe]',
            'dark:hover:bg-[#253435] dark:hover:text-[#f5f8f7]',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  )
}
