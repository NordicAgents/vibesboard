import { Button } from '@/components/ui/button'
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
      className={cn('flex gap-2 overflow-x-auto pb-1', className)}
      aria-label="Quick suggestions"
    >
      {suggestions.map((suggestion, idx) => (
        <Button
          key={`${idx}-${suggestion}`}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(suggestion)}
          className="whitespace-nowrap rounded-full px-3 py-1 text-xs"
        >
          {suggestion}
        </Button>
      ))}
    </div>
  )
}

