'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'
import { type AgentToolType, type VibeAgentTool } from '@/lib/types'
import { getBrowserSupabaseClient } from '@/lib/supabase/browser-client'
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

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setIsUploading(true)
    const supabase = getBrowserSupabaseClient()

    try {
      const uploads = await Promise.all(
        Array.from(files).map(async file => {
          const path = `${userId}/${Date.now()}-${file.name}`
          const { data, error } = await supabase.storage
            .from('agent-files')
            .upload(path, file, {
              upsert: true
            })

          if (error || !data) {
            throw error ?? new Error('Upload failed')
          }

          return data.path
        })
      )
      setFileKeys(prev => Array.from(new Set([...prev, ...uploads])))
      toast.success('Files uploaded')
    } catch (error) {
      toast.error('Failed to upload files')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveFile = async (path: string) => {
    const supabase = getBrowserSupabaseClient()
    await supabase.storage.from('agent-files').remove([path])
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
          tools: toolsPayload
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

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <form className="space-y-6" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Agent basics</CardTitle>
            <CardDescription>{helperText}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Studio Support Agent"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Instructions</label>
              <Textarea
                value={instructions}
                onChange={event => setInstructions(event.target.value)}
                placeholder="Explain how the agent should introduce itself, tone, data usage..."
                rows={8}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Allow anonymous chat</p>
                <p className="text-xs text-muted-foreground">
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

        <Card>
          <CardHeader>
            <CardTitle>Tools & context</CardTitle>
            <CardDescription>
              Enable optional tools and upload files for RAG.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Tools</p>
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
              <label className="text-sm font-medium">Reference files</label>
              <input
                type="file"
                multiple
                onChange={event => handleUpload(event.target.files)}
                disabled={isUploading}
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
                      className="flex items-center justify-between rounded-md border px-3 py-1"
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

        <Button type="submit" disabled={isSubmitting || isUploading}>
          {isSubmitting ? 'Creating...' : 'Create agent'}
        </Button>
      </form>
      <div className="space-y-4">
        <AgentBuilderHelper onUseSuggestion={setInstructions} />
      </div>
    </div>
  )
}
