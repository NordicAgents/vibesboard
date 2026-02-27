'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/constants'
import {
  type AgentToolType,
  type QuickSuggestionsMode,
  type VibeAgentTool
} from '@/lib/types'
import { AgentBuilderHelper } from './agent-builder-helper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface AgentBuilderProps {
  userId: string
}

const helperText =
  'Give your agent a friendly name and explain how it should respond. Include tone, guardrails, and data sources.'

export function AgentBuilder({ userId }: AgentBuilderProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [allowAnonymous, setAllowAnonymous] = useState(true)
  const [selectedTools, setSelectedTools] = useState<AgentToolType[]>([])
  const [quickSuggestionsMode, setQuickSuggestionsMode] =
    useState<QuickSuggestionsMode>('smart')
  const [quickSuggestionsCount, setQuickSuggestionsCount] = useState<number>(4)
  const [fileKeys, setFileKeys] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const toolOptions = useMemo(
    () => Object.values(BUILTIN_AGENT_TOOLS),
    []
  )

  const toolsPayload: VibeAgentTool[] = selectedTools.map(tool => ({
    ...(BUILTIN_AGENT_TOOLS[tool as keyof typeof BUILTIN_AGENT_TOOLS] ?? {
      name: tool
    }),
    id: tool,
    type: tool
  }))

  const safeFileName = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setIsUploading(true)

    try {
      const uploads = await Promise.all(
        Array.from(files).map(async file => {
          const fileName = `${Date.now()}-${safeFileName(file.name)}`

          // Get a signed upload URL from the API
          const res = await fetch('/api/files/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName,
              contentType: file.type || 'application/octet-stream'
            })
          })

          if (!res.ok) {
            throw new Error('Failed to get upload URL')
          }

          const { uploadUrl, fileKey } = await res.json()

          // Upload the file directly to GCS
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type || 'application/octet-stream'
            },
            body: file
          })

          if (!uploadRes.ok) {
            throw new Error('Upload failed')
          }

          return fileKey
        })
      )
      setFileKeys(prev => Array.from(new Set([...prev, ...uploads])))
      toast.success('Files uploaded')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to upload files'
      toast.error(message)
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveFile = async (path: string) => {
    // Remove from local state; server-side cleanup happens when the agent is saved
    setFileKeys(prev => prev.filter(item => item !== path))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name || !instructions) {
      toast.error('Please add a name and instructions')
      return
    }
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          instructions,
          allowAnonymous,
          fileKeys,
          tools: toolsPayload,
          quickSuggestionsMode,
          quickSuggestionsCount
        })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error ?? 'Unable to save agent')
      }

      const json = await res.json()
      toast.success('Agent created')
      router.push(`/agents/${json.agent.id}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Feature flag to show/hide Tools & Context section in the builder
  const SHOW_TOOLS_AND_CONTEXT = true

  return (
    <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <Card className="rounded-3xl border-black-10 bg-purewhite-bg shadow-lg dark:border-border dark:bg-card">
          <CardHeader>
            <CardTitle className="font-switzer text-2xl font-bold text-black-primary dark:text-foreground">Agent basics</CardTitle>
            <CardDescription className="font-switzer text-gray-secondary">{helperText}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="font-switzer text-sm font-medium text-black-primary dark:text-foreground">Name</label>
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Studio Support Agent"
              />
            </div>
            <div className="space-y-2">
              <label className="font-switzer text-sm font-medium text-black-primary dark:text-foreground">Instructions</label>
              <Textarea
                value={instructions}
                onChange={event => setInstructions(event.target.value)}
                placeholder="Explain how the agent should introduce itself, tone, data usage..."
                rows={8}
              />
            </div>
            <div className="bg-beige-bg/30 flex flex-col gap-2 rounded-2xl border border-black-10 p-4 dark:border-border dark:bg-background/30 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-switzer text-sm font-medium text-black-primary dark:text-foreground">Allow anonymous chat</p>
                <p className="font-switzer text-xs text-gray-secondary">
                  Visitors can message this agent without signing in.
                </p>
              </div>
              <Switch
                checked={allowAnonymous}
                onCheckedChange={value => setAllowAnonymous(value)}
              />
            </div>
          </CardContent>
        </Card>

        {SHOW_TOOLS_AND_CONTEXT && (
          <Card className="rounded-3xl border-black-10 bg-purewhite-bg shadow-lg">
            <CardHeader>
              <CardTitle className="font-switzer text-2xl font-bold text-black-primary">Tools & context</CardTitle>
              <CardDescription className="font-switzer text-gray-secondary">
                Enable optional tools and upload files for RAG.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="font-switzer text-sm font-medium text-black-primary">Tools</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {toolOptions.map(tool => {
                    const checked = selectedTools.includes(tool.id as AgentToolType)
                    return (
                      <Badge
                        key={tool.id}
                        variant={checked ? 'default' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => {
                          setSelectedTools(prev =>
                            checked
                              ? prev.filter(item => item !== tool.id)
                              : [...prev, tool.id as AgentToolType]
                          )
                        }}
                      >
                        {tool.name}
                      </Badge>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <label className="font-switzer text-sm font-medium text-black-primary">Reference files</label>
                <input
                  type="file"
                  multiple
                  onChange={event => handleUpload(event.target.files)}
                  disabled={isUploading}
                  className="block w-full text-sm"
                />
                {fileKeys.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Upload transcripts, docs, or FAQs to ground responses.
                  </p>
                )}
                {fileKeys.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {fileKeys.map(key => (
                      <li
                        key={key}
                        className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="truncate">{key}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveFile(key)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-3xl border-black-10 bg-purewhite-bg shadow-lg dark:border-border dark:bg-card">
          <CardHeader>
            <CardTitle className="font-switzer text-2xl font-bold text-black-primary dark:text-foreground">
              Quick suggestions
            </CardTitle>
            <CardDescription className="font-switzer text-gray-secondary">
              Show 3–4 clickable suggestions to help users reply faster.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={
                  quickSuggestionsMode === 'off' ? 'default' : 'secondary'
                }
                className="cursor-pointer"
                onClick={() => setQuickSuggestionsMode('off')}
              >
                Off
              </Badge>
              <Badge
                variant={
                  quickSuggestionsMode === 'smart' ? 'default' : 'secondary'
                }
                className="cursor-pointer"
                onClick={() => setQuickSuggestionsMode('smart')}
              >
                Smart (Wisely)
              </Badge>
              <Badge
                variant={
                  quickSuggestionsMode === 'always' ? 'default' : 'secondary'
                }
                className="cursor-pointer"
                onClick={() => setQuickSuggestionsMode('always')}
              >
                Always
              </Badge>
            </div>

            {quickSuggestionsMode !== 'off' && (
              <div className="bg-beige-bg/30 flex items-center justify-between rounded-2xl border border-black-10 p-4 dark:border-border dark:bg-background/30 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-switzer text-sm font-medium text-black-primary dark:text-foreground">
                    Suggestions count
                  </p>
                  <p className="font-switzer text-xs text-gray-secondary">
                    Choose how many chips to show.
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={quickSuggestionsCount}
                  onChange={e =>
                    setQuickSuggestionsCount(
                      Math.max(1, Math.min(10, parseInt(e.target.value) || 4))
                    )
                  }
                  className="h-9 w-20 text-center"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Button type="submit" disabled={isSubmitting || isUploading} className="w-full rounded-full font-switzer sm:w-auto">
          {isSubmitting ? 'Creating...' : 'Create agent'}
        </Button>
      </form>
      <div className="space-y-4 self-start md:sticky md:top-24">
        <AgentBuilderHelper onUseSuggestion={setInstructions} />
      </div>
    </div>
  )
}
