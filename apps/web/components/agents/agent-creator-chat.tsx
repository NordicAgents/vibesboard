'use client'

import { useState, useCallback } from 'react'
import { useCompatChat } from '@/lib/hooks/use-compat-chat'
import { useRouter } from 'next/navigation'
import { ChatList } from '@/components/chat-list'
import { PromptForm, type AttachedFile } from '@/components/prompt-form'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { cn, nanoid } from '@vibesboard/utils'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import {
  IconPlus,
  IconSidebar,
  IconStop,
  IconSpinner
} from '@/components/ui/icons'
import {
  AgentBuilderFormPreview,
  type AgentFormData
} from './agent-builder-form-preview'
import { AgentCreationSuccess } from './agent-creation-success'
import { QuickSuggestions } from '@/components/quick-suggestions'
import { ACCEPTED_UPLOAD_FILE_TYPES } from '@/lib/file-upload'
import { extractWebsiteUrls } from '@/lib/website-url'

const STARTER_PROMPTS = [
  'Customer support agent for my business',
  'Lead collection bot that captures visitor info',
  'FAQ assistant that answers from my documents',
  'Feedback collection bot for visitor reviews'
]

const MAX_FILES = 5
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_FILE_TYPES = ACCEPTED_UPLOAD_FILE_TYPES

interface AgentCreatorChatProps {
  className?: string
  userId?: string
  initialChatId?: string
}

export function AgentCreatorChat({
  className,
  userId,
  initialChatId
}: AgentCreatorChatProps) {
  const router = useRouter()
  const [chatId, setChatId] = useState<string>(initialChatId || 'agent-creator')
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [formData, setFormData] = useState<AgentFormData>({
    allowAnonymous: true,
    quickSuggestionsMode: 'smart',
    quickSuggestionsCount: 4
  })
  const [isCreating, setIsCreating] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(true)
  const [mobileView, setMobileView] = useState<'chat' | 'form'>('chat')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])

  const { messages, append, reload, stop, isLoading, input, setInput } =
    useCompatChat({
      id: chatId,
      api: '/api/agent-creator',
      streamProtocol: 'text',
      body: {
        fileKeys: formData.fileKeys || [],
        fileNames: attachedFiles
          .filter(f => f.status === 'success')
          .map(f => ({ fileKey: f.fileKey, name: f.name }))
      },
      onResponse(res: Response) {
        if (res.ok) return
        if (res.status === 401) {
          toast.error('Please sign in to create an agent.')
          return
        }
        // Anything else used to fail silently — the assistant simply never
        // replied and the wizard looked stalled.
        res
          .clone()
          .json()
          .then(data => {
            toast.error(
              data?.message ?? 'The agent builder could not respond. Try again.'
            )
          })
          .catch(() => {
            toast.error('The agent builder could not respond. Try again.')
          })
      },

      onError() {
        toast.error('The connection dropped before the builder finished.')
      },

      onFinish(message: any) {
        // useCompatChat normalizes UIMessage to have content: string
        const content: string = message?.content ?? ''

        // Parse agentupdate blocks from the AI response
        try {
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
                ...(updates.instructions !== undefined && {
                  instructions: updates.instructions
                }),
                ...(updates.greetingText !== undefined && {
                  greetingText: updates.greetingText
                }),
                ...(updates.tools !== undefined && { tools: updates.tools }),
                ...(updates.allowAnonymous !== undefined && {
                  allowAnonymous: updates.allowAnonymous
                }),
                ...(updates.fileKeys !== undefined && {
                  fileKeys: updates.fileKeys
                }),
                ...(updates.mode !== undefined && { mode: updates.mode }),
                ...(updates.maxResponses !== undefined && {
                  maxResponses: updates.maxResponses
                }),
                ...(updates.maxAgentResponses !== undefined && {
                  maxAgentResponses: updates.maxAgentResponses
                }),
                ...(updates.quickSuggestionsMode !== undefined && {
                  quickSuggestionsMode: updates.quickSuggestionsMode
                }),
                ...(updates.quickSuggestionsCount !== undefined && {
                  quickSuggestionsCount: updates.quickSuggestionsCount
                }),
                ...(updates.sourceUrls !== undefined && {
                  sourceUrls: updates.sourceUrls
                }),
                ...(updates.bookingConfig !== undefined && {
                  bookingConfig: updates.bookingConfig
                })
              }))
            } catch (parseError) {
              console.log('Failed to parse agentupdate block:', parseError)
            }
          }
        } catch (error) {
          console.log('Error processing message:', error)
        }

        // Detect an agent creation completion marker from the API.
        try {
          const agentCreatedRegex = /~~~agentcreated\s*\n([\s\S]*?)\n~~~/g
          const matches = content.matchAll(agentCreatedRegex)

          for (const match of matches) {
            try {
              const jsonStr = match[1].trim()
              const created = JSON.parse(jsonStr) as { id?: string }

              if (created?.id && !createdAgentId) {
                setCreatedAgentId(created.id)
                setShowSuccess(true)
                break
              }
            } catch (parseError) {
              console.log('Failed to parse agentcreated block:', parseError)
            }
          }
        } catch (error) {
          console.log('Error processing agentcreated message:', error)
        }
      }
    })

  const handleNewChat = () => {
    if (isLoading) stop()
    setInput('')
    setChatId(`agent-creator-${nanoid()}`)
    setCreatedAgentId(null)
    setAttachedFiles([])
    setFormData({
      allowAnonymous: true,
      quickSuggestionsMode: 'smart',
      quickSuggestionsCount: 4
    })
  }

  const safeFileName = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const handleFileSelect = useCallback(
    async (files: FileList) => {
      if (!userId) {
        toast.error('Please sign in to upload files')
        return
      }

      const fileArray = Array.from(files)

      // Validate count
      const currentCount = attachedFiles.length
      if (currentCount + fileArray.length > MAX_FILES) {
        toast.error(
          `Maximum ${MAX_FILES} files allowed. You can add ${MAX_FILES - currentCount} more.`
        )
        return
      }

      // Validate sizes
      const oversized = fileArray.filter(f => f.size > MAX_FILE_SIZE)
      if (oversized.length > 0) {
        toast.error(
          `Files exceed 5MB limit: ${oversized.map(f => f.name).join(', ')}`
        )
        return
      }

      // Create placeholder entries
      const newFiles: AttachedFile[] = fileArray.map(file => ({
        id: nanoid(),
        name: file.name,
        fileKey: '',
        size: file.size,
        type: file.type || 'application/octet-stream',
        status: 'uploading' as const
      }))

      setAttachedFiles(prev => [...prev, ...newFiles])

      // Upload each file in parallel
      await Promise.all(
        fileArray.map(async (file, index) => {
          const fileEntry = newFiles[index]
          const fileName = `${Date.now()}-${safeFileName(file.name)}`

          try {
            const res = await fetch('/api/files/upload-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileName,
                contentType: file.type || 'application/octet-stream',
                fileSize: file.size
              })
            })

            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err.error || 'Failed to get upload URL')
            }

            const { uploadUrl, fileKey } = await res.json()

            const uploadRes = await fetch(uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': file.type || 'application/octet-stream'
              },
              body: file
            })

            if (!uploadRes.ok) {
              throw new Error('Upload to storage failed')
            }

            // Update file entry to success
            setAttachedFiles(prev =>
              prev.map(f =>
                f.id === fileEntry.id
                  ? { ...f, fileKey, status: 'success' as const }
                  : f
              )
            )

            // Add to formData.fileKeys
            setFormData(prev => ({
              ...prev,
              fileKeys: [...(prev.fileKeys || []), fileKey]
            }))
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Upload failed'
            setAttachedFiles(prev =>
              prev.map(f =>
                f.id === fileEntry.id
                  ? { ...f, status: 'error' as const, error: message }
                  : f
              )
            )
            toast.error(`Failed to upload ${file.name}`)
          }
        })
      )
    },
    [userId, attachedFiles.length]
  )

  const handleFileRemove = useCallback((fileId: string) => {
    setAttachedFiles(prev => {
      const file = prev.find(f => f.id === fileId)
      if (file?.fileKey) {
        // Remove from formData.fileKeys
        setFormData(fd => ({
          ...fd,
          fileKeys: (fd.fileKeys || []).filter(k => k !== file.fileKey)
        }))
      }
      return prev.filter(f => f.id !== fileId)
    })
  }, [])

  const isUploading = attachedFiles.some(f => f.status === 'uploading')

  const isReadyToCreate =
    !!formData.name &&
    formData.name.length >= 2 &&
    !!formData.instructions &&
    formData.instructions.length >= 10 &&
    !!formData.greetingText &&
    formData.greetingText.length > 0

  const handleCreateAgent = async () => {
    if (!formData.name || !formData.instructions || !formData.greetingText) {
      toast.error('Please complete all required fields')
      return
    }

    setIsCreating(true)

    try {
      // Auto-enable file_search when files are uploaded
      const effectiveTools = [...(formData.tools || [])]
      if (
        (formData.fileKeys || []).length > 0 &&
        !effectiveTools.includes('builtin:file_search')
      ) {
        effectiveTools.push('builtin:file_search')
      }

      const toolsPayload = effectiveTools.map(toolId => ({
        id: toolId,
        type: toolId,
        name: toolId.replace('builtin:', '')
      }))

      // Explicitly set mode and response limits
      const mode = formData.mode ?? 'provider'
      const maxResponses = formData.maxResponses ?? null
      const maxAgentResponses = formData.maxAgentResponses ?? null

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
          sourceUrls: formData.sourceUrls || [],
          tools: toolsPayload,
          mode,
          maxResponses,
          maxAgentResponses,
          quickSuggestionsMode: formData.quickSuggestionsMode ?? 'smart',
          quickSuggestionsCount: formData.quickSuggestionsCount ?? 4,
          ...(formData.bookingConfig !== undefined && {
            bookingConfig: formData.bookingConfig
          })
        })
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error ?? 'Unable to create agent')
      }

      const json = await res.json()
      setCreatedAgentId(json.agent.id)
      setShowSuccess(true)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create agent'
      )
    } finally {
      setIsCreating(false)
    }
  }

  const promptFormProps = {
    attachedFiles,
    onFileSelect: handleFileSelect,
    onFileRemove: handleFileRemove,
    maxFiles: MAX_FILES,
    acceptedFileTypes: ACCEPTED_FILE_TYPES
  }

  if (showSuccess && createdAgentId) {
    return (
      <AgentCreationSuccess
        agentId={createdAgentId}
        agentName={formData.name || 'Your Agent'}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex h-full flex-1 flex-col bg-[#f7f7f5] dark:bg-[#222f30] lg:flex-row',
        className
      )}
    >
      {/* Mobile View Switcher */}
      <div className="flex shrink-0 border-b border-[#e4e3e3] dark:border-[#344348] lg:hidden">
        <div className="m-2 flex w-full rounded-lg bg-[#e6ede6] p-1 dark:bg-[#344348]">
          <button
            onClick={() => setMobileView('chat')}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm font-medium transition-colors',
              mobileView === 'chat'
                ? 'bg-[#f5f8f7] text-[#222f30] shadow-sm dark:bg-[#192425] dark:text-[#f5f8f7]'
                : 'text-[#6f7f80] hover:bg-[#f5f8f7]/50 dark:text-[#7e8e8f] dark:hover:bg-[#192425]/50'
            )}
          >
            Chat
          </button>
          <button
            onClick={() => {
              setMobileView('form')
              setIsPreviewOpen(true)
            }}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm font-medium transition-colors',
              mobileView === 'form'
                ? 'bg-[#f5f8f7] text-[#222f30] shadow-sm dark:bg-[#192425] dark:text-[#f5f8f7]'
                : 'text-[#6f7f80] hover:bg-[#f5f8f7]/50 dark:text-[#7e8e8f] dark:hover:bg-[#192425]/50'
            )}
          >
            Form
          </button>
        </div>
      </div>

      {/* Left Side: Chat Interface (70%) */}
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden',
          mobileView === 'form' ? 'hidden lg:flex' : 'flex'
        )}
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {messages.length > 0 ? (
            <>
              {/* Compact header */}
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <p className="font-switzer text-xs font-medium uppercase tracking-[0.08em] text-[#6f7f80]">
                  Agent Builder
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleNewChat}
                    aria-label="New chat"
                    title="New chat"
                    className="size-8 p-0"
                  >
                    <IconPlus className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl">
                  <ChatList
                    messages={
                      (messages as any[]).map(msg => ({
                        ...msg,
                        // Remove agentupdate/agentcreated blocks from display
                        content: msg.content
                          .replace(/~~~agentupdate\s*\n[\s\S]*?\n~~~/g, '')
                          .replace(/~~~agentcreated\s*\n[\s\S]*?\n~~~/g, '')
                          .trim()
                      })) as any
                    }
                  />
                  {isLoading && (
                    <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-muted-foreground">
                      <IconSpinner className="size-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  )}
                  <ChatScrollAnchor trackVisibility={isLoading} />
                </div>
              </div>
            </>
          ) : (
            // Centered empty state
            <div className="flex flex-1 flex-col items-center justify-center px-4">
              <div className="w-full max-w-2xl space-y-8 text-center">
                <div className="space-y-3">
                  <h1 className="font-switzer text-4xl font-bold tracking-tight text-black-primary dark:text-[#f5f8f7] md:text-5xl">
                    Build Your Agent
                  </h1>
                  <p className="font-switzer text-lg text-gray-secondary">
                    Tell me about your agent or upload files to get started
                  </p>
                </div>

                {/* Starter prompts */}
                <div className="mx-auto w-full max-w-xl">
                  <QuickSuggestions
                    suggestions={STARTER_PROMPTS}
                    onSelect={async value => {
                      await append({
                        id: nanoid(),
                        content: value,
                        role: 'user'
                      })
                    }}
                    disabled={isLoading}
                    className="grid grid-cols-2 gap-2.5"
                  />
                </div>

                {/* Input centered below header */}
                <div className="w-full">
                  <PromptForm
                    onSubmit={async (value: string) => {
                      // Track URLs from user messages for sourceUrls
                      const detectedUrls = extractWebsiteUrls(value)
                      if (detectedUrls?.length) {
                        setFormData(prev => ({
                          ...prev,
                          sourceUrls: [
                            ...new Set([
                              ...(prev.sourceUrls ?? []),
                              ...detectedUrls
                            ])
                          ].slice(0, 5)
                        }))
                      }
                      await append({
                        id: nanoid(),
                        content: value,
                        role: 'user'
                      })
                    }}
                    input={input}
                    setInput={setInput}
                    isLoading={isLoading}
                    {...promptFormProps}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat Input - Fixed at bottom when messages exist */}
        {messages.length > 0 && (
          <div className="shrink-0">
            <div className="mx-auto max-w-3xl">
              {isLoading && (
                <div className="flex justify-center pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => stop()}
                    className="rounded-full border-[#e4e3e3] font-switzer text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] dark:border-[#344348] dark:text-[#6f7f80] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
                  >
                    <IconStop className="mr-2 size-4" />
                    Stop generating
                  </Button>
                </div>
              )}
              <div className="space-y-2 px-4 py-3">
                {!createdAgentId && isReadyToCreate && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e4e3e3] bg-[#e6ede6] px-3 py-2 text-xs text-[#222f30] dark:border-[#344348] dark:bg-[#344348] dark:text-[#f5f8f7]">
                    <p className="font-switzer">
                      Your agent draft is ready. Say &quot;create it&quot; or
                      click Create Agent.
                    </p>
                    <Button
                      size="sm"
                      aria-label="Create agent from chat draft"
                      onClick={handleCreateAgent}
                      disabled={isCreating}
                      className="shrink-0"
                    >
                      {isCreating ? 'Creating…' : 'Create Agent'}
                    </Button>
                  </div>
                )}
                <PromptForm
                  onSubmit={async (value: string) => {
                    // Track URLs from user messages for sourceUrls
                    const detectedUrls = extractWebsiteUrls(value)
                    if (detectedUrls?.length) {
                      setFormData(prev => ({
                        ...prev,
                        sourceUrls: [
                          ...new Set([
                            ...(prev.sourceUrls ?? []),
                            ...detectedUrls
                          ])
                        ].slice(0, 5)
                      }))
                    }
                    await append({
                      id: nanoid(),
                      content: value,
                      role: 'user'
                    })
                  }}
                  input={input}
                  setInput={setInput}
                  isLoading={isLoading}
                  {...promptFormProps}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Side: Form Preview (30%) */}
      {isPreviewOpen ? (
        <div
          className={cn(
            'transition-all duration-300 ease-in-out',
            mobileView === 'chat'
              ? 'hidden lg:block'
              : 'flex flex-1 lg:flex-none'
          )}
        >
          <AgentBuilderFormPreview
            formData={formData}
            onFormChange={setFormData}
            onCreateAgent={handleCreateAgent}
            isCreating={isCreating}
            isUploading={isUploading}
            userId={userId}
            className="w-full shrink-0 lg:w-[400px]"
            onClose={() => setIsPreviewOpen(false)}
          />
        </div>
      ) : (
        <div className="hidden w-12 shrink-0 items-center justify-center border-l border-[#e4e3e3] transition-all duration-300 ease-in-out dark:border-[#344348] lg:flex">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsPreviewOpen(true)}
            aria-label="Show preview"
            title="Show preview"
            className="size-full rounded-none"
          >
            <IconSidebar className="size-5" />
          </Button>
        </div>
      )}
    </div>
  )
}
