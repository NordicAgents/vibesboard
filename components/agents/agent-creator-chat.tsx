'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import { useRouter } from 'next/navigation'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { PromptForm } from '@/components/prompt-form'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { cn, nanoid } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { IconPlus, IconLink, IconUpload } from '@/components/ui/icons'
import { Input } from '@/components/ui/input'
import { AgentBuilderFormPreview, type AgentFormData } from './agent-builder-form-preview'
import { getBrowserSupabaseClient } from '@/lib/supabase/browser-client'

interface AgentCreatorChatProps {
  className?: string
  userId?: string
}

export function AgentCreatorChat({ className, userId }: AgentCreatorChatProps) {
  const router = useRouter()
  const [chatId, setChatId] = useState<string>('agent-creator')
  const [formData, setFormData] = useState<AgentFormData>({
    allowAnonymous: true
  })
  const [isCreating, setIsCreating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const { messages, append, reload, stop, isLoading, input, setInput } =
    useChat({
      id: chatId,
      api: '/api/agent-creator',
      onResponse(res: Response) {
        if (res.status === 401) {
          toast.error('Please sign in to create an agent.')
        }
      },
      onFinish(message) {
        // Parse agentupdate blocks from the AI response
        try {
          const content = message.content
          // Look for ~~~agentupdate blocks
          const agentUpdateRegex = /~~~agentupdate\s*\n([\s\S]*?)\n~~~/g
          const matches = content.matchAll(agentUpdateRegex)

          for (const match of matches) {
            try {
              const jsonStr = match[1].trim()
              const updates = JSON.parse(jsonStr)

              // Update form data with any fields present in the update
              setFormData(prev => ({
                ...prev,
                ...(updates.name !== undefined && { name: updates.name }),
                ...(updates.instructions !== undefined && { instructions: updates.instructions }),
                ...(updates.greetingText !== undefined && { greetingText: updates.greetingText }),
                ...(updates.tools !== undefined && { tools: updates.tools }),
                ...(updates.allowAnonymous !== undefined && { allowAnonymous: updates.allowAnonymous })
              }))
            } catch (parseError) {
              console.log('Failed to parse agentupdate block:', parseError)
            }
          }
        } catch (error) {
          console.log('Error processing message:', error)
        }
      }
    })

  const handleNewChat = () => {
    if (isLoading) stop()
    setInput('')
    setChatId(`agent-creator-${nanoid()}`)
    setFormData({ allowAnonymous: true })
  }

  const handleAddWebsiteUrl = () => {
    setInput('Analyze this website: ')
  }

  const handleFileUpload = async (files: FileList | null) => {
    if (!files?.length || !userId) {
      toast.error('Please sign in to upload files')
      return
    }

    setIsUploading(true)
    const supabase = getBrowserSupabaseClient()

    try {
      const safeFileName = (name: string) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '')

      const uploads = await Promise.all(
        Array.from(files).map(async file => {
          const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`
          const { data, error } = await supabase.storage
            .from('agent-files')
            .upload(path, file, {
              upsert: true,
              contentType: file.type || 'application/octet-stream'
            })

          if (error || !data) {
            throw error ?? new Error('Upload failed')
          }

          return { path: data.path, name: file.name }
        })
      )

      const fileKeys = uploads.map(u => u.path)
      setFormData(prev => ({
        ...prev,
        fileKeys: [...(prev.fileKeys || []), ...fileKeys]
      }))

      const fileNames = uploads.map(u => u.name).join(', ')
      await append({
        id: nanoid(),
        content: `I've uploaded these files: ${fileNames}. Please help me create an agent based on these files.`,
        role: 'user'
      })

      toast.success('Files uploaded successfully')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to upload files'
      toast.error(message)
    } finally {
      setIsUploading(false)
    }
  }

  const handleCreateAgent = async () => {
    if (!formData.name || !formData.instructions || !formData.greetingText) {
      toast.error('Please complete all required fields')
      return
    }

    setIsCreating(true)

    try {
      const toolsPayload = (formData.tools || []).map(toolId => ({
        id: toolId,
        type: toolId,
        name: toolId.replace('builtin:', ''),
      }))

      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          instructions: formData.instructions,
          greetingText: formData.greetingText,
          allowAnonymous: formData.allowAnonymous ?? true,
          fileKeys: formData.fileKeys || [],
          tools: toolsPayload
        })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error ?? 'Unable to create agent')
      }

      const json = await res.json()
      toast.success('Agent created successfully!')
      router.push(`/agents/${json.agent.id}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create agent')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className={cn('flex min-h-[calc(100vh-4rem)] flex-1 bg-beige-bg dark:bg-background', className)}>
      {/* Left Side: Chat Interface (70%) */}
      <div className="flex flex-1 flex-col">
        <div className="relative flex flex-1 flex-col">
          {messages.length > 0 ? (
            <>
              {/* Simple header when messages exist */}
              <div className="border-b border-black-10 bg-purewhite-bg p-4 dark:bg-card dark:border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-switzer text-sm font-semibold uppercase tracking-[0.4em] text-black-primary dark:text-white">
                      Conversation Agent Builder
                    </p>
                    <p className="mt-1 font-switzer text-sm text-gray-secondary">Build an agent via chat</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleNewChat}
                    aria-label="New chat"
                    title="New chat"
                  >
                    <IconPlus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pb-36 pt-4">
                <ChatList messages={messages.map(msg => ({
                  ...msg,
                  // Remove agentupdate blocks from display
                  content: msg.content.replace(/~~~agentupdate\s*\n[\s\S]*?\n~~~/g, '').trim()
                }))} />
                <ChatScrollAnchor trackVisibility={isLoading} />
              </div>
            </>
          ) : (
            // Centered empty state
            <div className="flex flex-1 flex-col items-center justify-center px-4">
              <div className="w-full max-w-2xl space-y-8 text-center">
                <div className="space-y-3">
                  <h1 className="font-switzer text-4xl font-bold tracking-tight text-black-primary md:text-5xl dark:text-white">
                    Build Your Agent
                  </h1>
                  <p className="font-switzer text-lg text-gray-secondary">
                    Tell me about your agent, share a website URL, or upload files
                  </p>
                </div>

                {/* Input centered below header */}
                <div className="w-full">
                  <div className="rounded-3xl border border-black-10 bg-purewhite-bg px-4 py-3 shadow-lg dark:bg-card dark:border-border">
                    <PromptForm
                      onSubmit={async (value: string) => {
                        await append({
                          id: nanoid(),
                          content: value,
                          role: 'user'
                        })
                      }}
                      input={input}
                      setInput={setInput}
                      isLoading={isLoading}
                    />
                  </div>

                  {/* Action buttons below input */}
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAddWebsiteUrl}
                      className="gap-2"
                    >
                      <IconLink className="h-4 w-4" />
                      Add Website
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('file-upload')?.click()}
                      disabled={isUploading || !userId}
                      className="gap-2"
                    >
                      <IconUpload className="h-4 w-4" />
                      {isUploading ? 'Uploading...' : 'Upload Files'}
                    </Button>
                    <input
                      id="file-upload"
                      type="file"
                      multiple
                      className="hidden"
                      onChange={e => handleFileUpload(e.target.files)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat Input - Only show at bottom when messages exist */}
        {messages.length > 0 && (
          <div className="border-t border-black-10 bg-purewhite-bg dark:bg-card dark:border-border">
            <div className="mx-auto max-w-4xl">
              <div className="px-4 py-4">
                <PromptForm
                  onSubmit={async (value: string) => {
                    await append({
                      id: nanoid(),
                      content: value,
                      role: 'user'
                    })
                  }}
                  input={input}
                  setInput={setInput}
                  isLoading={isLoading}
                />
                {/* Action buttons in chat panel */}
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAddWebsiteUrl}
                    className="gap-1 text-xs"
                  >
                    <IconLink className="h-3 w-3" />
                    Website
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => document.getElementById('file-upload-chat')?.click()}
                    disabled={isUploading || !userId}
                    className="gap-1 text-xs"
                  >
                    <IconUpload className="h-3 w-3" />
                    {isUploading ? 'Uploading...' : 'Files'}
                  </Button>
                  <input
                    id="file-upload-chat"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => handleFileUpload(e.target.files)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Side: Form Preview (30%) */}
      <AgentBuilderFormPreview
        formData={formData}
        onFormChange={setFormData}
        onCreateAgent={handleCreateAgent}
        onFileUpload={handleFileUpload}
        isCreating={isCreating}
        isUploading={isUploading}
        userId={userId}
        className="w-[400px] shrink-0"
      />
    </div>
  )
}
