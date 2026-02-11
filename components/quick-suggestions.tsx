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
          transition={{ delay: idx * 0.05, duration: 0.2, ease: 'easeOut' }}
          whileTap={{ scale: 0.96 }}
          className={cn(
            'shrink-0 rounded-full border border-border/60 bg-background px-3.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors',
            'hover:bg-muted hover:border-border active:bg-muted/80',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  )
}
