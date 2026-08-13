'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { FileText, Search } from 'lucide-react'

import { cn } from '@vibesboard/utils'

interface SearchResult {
  slug: string
  title: string
  description: string
  matchedHeading?: string
}

export function DocsSearchTrigger() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen(value => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:border-accent-orange/40 flex h-9 w-full items-center gap-2 rounded-full border border-border-warm bg-bg-surface px-3.5 text-sm text-text-tertiary transition-colors sm:w-64"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">Search docs</span>
        <kbd className="hidden rounded border border-border-warm bg-bg-base px-1.5 py-0.5 font-mono text-[10px] sm:block">
          ⌘K
        </kbd>
      </button>
      <DocsSearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function DocsSearchDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
  }, [open])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    const id = ++requestId.current
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/docs/search?q=${encodeURIComponent(query)}`
        )
        const data = (await response.json()) as { results: SearchResult[] }
        if (id === requestId.current) setResults(data.results)
      } catch {
        if (id === requestId.current) setResults([])
      }
    }, 150)
    return () => window.clearTimeout(timeout)
  }, [query])

  function go(slug: string) {
    onOpenChange(false)
    router.push(slug ? `/docs/${slug}` : '/docs')
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[#111918]/45 p-4 pt-[15vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <Command
        shouldFilter={false}
        className={cn(
          'w-full max-w-lg overflow-hidden rounded-2xl border border-border-warm bg-bg-base shadow-md'
        )}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-warm px-4">
          <Search className="size-4 text-text-tertiary" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search the docs..."
            className="h-12 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
          />
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          {query.trim().length >= 2 && results.length === 0 && (
            <Command.Empty className="px-3 py-6 text-center text-sm text-text-tertiary">
              No results for &quot;{query}&quot;
            </Command.Empty>
          )}
          {results.map(result => (
            <Command.Item
              key={result.slug}
              value={result.slug || 'index'}
              onSelect={() => go(result.slug)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2.5 data-[selected=true]:bg-bg-hover"
            >
              <span className="flex items-center gap-2 font-medium text-text-primary">
                <FileText className="size-3.5 shrink-0 text-text-tertiary" />
                {result.title}
                {result.matchedHeading && (
                  <span className="text-text-tertiary">
                    &rsaquo; {result.matchedHeading}
                  </span>
                )}
              </span>
              <span className="pl-5.5 truncate text-xs text-text-tertiary">
                {result.description}
              </span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
