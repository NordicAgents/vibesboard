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
      className={cn(
        'flex gap-2 overflow-x-auto pb-0.5 scrollbar-none',
        className
      )}
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
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
          transition={{ delay: idx * 0.05, duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          whileTap={{ scale: 0.96 }}
          className={cn(
            'shrink-0 rounded-full border border-[#E2DDD4] bg-[#FDFAF5] px-3.5 py-1.5 text-xs font-medium text-[#6B6560]',
            'shadow-[0_1px_3px_rgba(26,25,21,0.06)] transition-all duration-150',
            'hover:border-[#D97757]/30 hover:bg-[#EDE8DE] hover:text-[#1A1915]',
            'active:scale-[0.97]',
            'dark:border-[#2E2B25] dark:bg-[#221F1A] dark:text-[#9D9790]',
            'dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  )
}
