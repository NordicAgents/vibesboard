'use client'

import { useState } from 'react'
import { toast } from 'react-hot-toast'
import { FileText, Search, Terminal } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { cn } from '@vibesboard/utils'
import { type RetrievalStrategy } from '@vibesboard/contracts'

interface AgentRetrievalSettingsProps {
  agentId: string
  current: RetrievalStrategy
  canEdit: boolean
}

const STRATEGIES: {
  value: RetrievalStrategy
  label: string
  description: string
  hint: string
  Icon: React.ElementType
}[] = [
  {
    value: 'direct',
    label: 'Direct',
    description: 'Load full file content into every conversation.',
    hint: 'Best for small files and documents under 30k characters.',
    Icon: FileText
  },
  {
    value: 'rag',
    label: 'RAG',
    description: 'Search relevant sections on demand using vector search.',
    hint: 'Best for large files or many documents.',
    Icon: Search
  },
  {
    value: 'bash',
    label: 'Bash',
    description: 'Give the agent shell commands to analyze files in a sandbox.',
    hint: 'Best for CSV, JSON, YAML, and structured data.',
    Icon: Terminal
  }
]

export function AgentRetrievalSettings({
  agentId,
  current,
  canEdit
}: AgentRetrievalSettingsProps) {
  const [strategy, setStrategy] = useState<RetrievalStrategy>(current)
  const [saving, setSaving] = useState(false)

  const handleSelect = async (value: RetrievalStrategy) => {
    if (!canEdit || value === strategy) return
    setSaving(true)
    const previous = strategy
    setStrategy(value)
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retrievalStrategy: value })
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success('Retrieval strategy updated')
    } catch {
      setStrategy(previous)
      toast.error('Failed to update retrieval strategy')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">File Retrieval Strategy</CardTitle>
        <CardDescription className="mt-0.5 text-xs">
          Controls how this agent reads its uploaded files during conversations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {STRATEGIES.map(({ value, label, description, hint, Icon }) => {
          const selected = strategy === value
          return (
            <button
              key={value}
              disabled={!canEdit || saving}
              onClick={() => handleSelect(value)}
              className={cn(
                'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-muted-foreground/30 hover:bg-muted/40',
                (!canEdit || saving) && 'cursor-not-allowed opacity-60'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-primary' : 'border-muted-foreground/40'
                )}
              >
                {selected && <div className="size-2 rounded-full bg-primary" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                  {hint}
                </p>
              </div>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}
