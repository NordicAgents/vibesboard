'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { type VibeAgent, type AgentToolType } from '@/lib/types'
import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'
import { getBrowserSupabaseClient } from '@/lib/supabase/browser-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
    IconTrash,
    IconDownload,
    IconFile,
    IconUpload,
    IconCheck,
    IconX
} from '@/components/ui/icons'
import { cn } from '@/lib/utils'

interface ToolsFilesManagerProps {
    agent: VibeAgent
    onUpdate?: () => void
}

interface FileUploadProgress {
    name: string
    progress: number
    status: 'uploading' | 'success' | 'error'
    error?: string
}

export function ToolsFilesManager({ agent, onUpdate }: ToolsFilesManagerProps) {
    const router = useRouter()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [selectedTools, setSelectedTools] = useState<AgentToolType[]>(
        agent.tools.map(t => t.type)
    )
    const [fileKeys, setFileKeys] = useState<string[]>(agent.fileKeys)
    const [uploadProgress, setUploadProgress] = useState<FileUploadProgress[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [isDragging, setIsDragging] = useState(false)

    const toolOptions = Object.values(BUILTIN_AGENT_TOOLS)

    // Extract clean filename from storage path
    const getFileName = (path: string): string => {
        const parts = path.split('/')
        const filename = parts[parts.length - 1] || path
        // Remove timestamp prefix if it exists (e.g., "1234567890-file.pdf" -> "file.pdf")
        return filename.replace(/^\d+-/, '')
    }

    // Get file extension
    const getFileExtension = (filename: string): string => {
        const parts = filename.split('.')
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
    }

    // Get file icon based on extension
    const getFileIcon = (filename: string) => {
        const ext = getFileExtension(filename)
        const iconClass = 'h-4 w-4'

        // You can customize icons based on file type
        return <IconFile className={iconClass} />
    }

    const updateAgent = async (payload: Partial<VibeAgent>) => {
        setIsSaving(true)
        try {
            const res = await fetch(`/api/agents/${agent.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (!res.ok) {
                const error = await res.json().catch(() => ({}))
                throw new Error(error.error ?? 'Failed to update agent')
            }

            router.refresh()
            onUpdate?.()
            toast.success('Agent updated successfully')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Update failed')
            throw error
        } finally {
            setIsSaving(false)
        }
    }

    const handleToolToggle = (toolId: AgentToolType) => {
        setSelectedTools(prev =>
            prev.includes(toolId)
                ? prev.filter(id => id !== toolId)
                : [...prev, toolId]
        )
    }

    const handleSaveTools = async () => {
        try {
            await updateAgent({
                tools: selectedTools.map(type => ({
                    ...(BUILTIN_AGENT_TOOLS[type as keyof typeof BUILTIN_AGENT_TOOLS] ?? {
                        name: type
                    }),
                    id: type,
                    type
                }))
            })
        } catch {
            // Error already handled in updateAgent
        }
    }

    const safeFileName = (name: string) =>
        name
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')

    const handleFileUpload = useCallback(
        async (files: FileList | File[]) => {
            const fileArray = Array.from(files)
            const supabase = getBrowserSupabaseClient()

            // Validate files
            const maxSize = 10 * 1024 * 1024 // 10MB
            const invalidFiles = fileArray.filter(file => file.size > maxSize)

            if (invalidFiles.length > 0) {
                toast.error(`Some files exceed 10MB limit: ${invalidFiles.map(f => f.name).join(', ')}`)
                return
            }

            // Initialize progress tracking
            const progressItems: FileUploadProgress[] = fileArray.map(file => ({
                name: file.name,
                progress: 0,
                status: 'uploading'
            }))
            setUploadProgress(progressItems)

            try {
                const uploadPromises = fileArray.map(async (file, index) => {
                    try {
                        const path = `${agent.userId}/${Date.now()}-${safeFileName(file.name)}`

                        const { data, error } = await supabase.storage
                            .from('agent-files')
                            .upload(path, file, {
                                upsert: true,
                                contentType: file.type || 'application/octet-stream'
                            })

                        if (error || !data) {
                            throw error ?? new Error('Upload failed')
                        }

                        // Update progress to success
                        setUploadProgress(prev =>
                            prev.map((item, i) =>
                                i === index
                                    ? { ...item, progress: 100, status: 'success' }
                                    : item
                            )
                        )

                        return data.path
                    } catch (error) {
                        // Update progress to error
                        setUploadProgress(prev =>
                            prev.map((item, i) =>
                                i === index
                                    ? {
                                        ...item,
                                        status: 'error',
                                        error: error instanceof Error ? error.message : 'Upload failed'
                                    }
                                    : item
                            )
                        )
                        throw error
                    }
                })

                const results = await Promise.allSettled(uploadPromises)
                const successfulPaths = results
                    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
                    .map(r => r.value)

                if (successfulPaths.length > 0) {
                    const newFileKeys = Array.from(new Set([...fileKeys, ...successfulPaths]))
                    setFileKeys(newFileKeys)
                    await updateAgent({ fileKeys: newFileKeys })

                    toast.success(
                        `${successfulPaths.length} file${successfulPaths.length > 1 ? 's' : ''} uploaded successfully`
                    )
                }

                const failedCount = results.filter(r => r.status === 'rejected').length
                if (failedCount > 0) {
                    toast.error(`${failedCount} file${failedCount > 1 ? 's' : ''} failed to upload`)
                }
            } catch (error) {
                toast.error('File upload failed')
            } finally {
                // Clear progress after 3 seconds
                setTimeout(() => setUploadProgress([]), 3000)
            }
        },
        [agent.id, agent.userId, fileKeys]
    )

    const handleFileDelete = async (path: string) => {
        const supabase = getBrowserSupabaseClient()

        try {
            // Remove from storage
            await supabase.storage.from('agent-files').remove([path])

            // Update state and database
            const newFileKeys = fileKeys.filter(key => key !== path)
            setFileKeys(newFileKeys)
            await updateAgent({ fileKeys: newFileKeys })

            toast.success('File deleted successfully')
        } catch (error) {
            toast.error('Failed to delete file')
        }
    }

    const handleFileDownload = async (path: string) => {
        const supabase = getBrowserSupabaseClient()

        try {
            const { data, error } = await supabase.storage
                .from('agent-files')
                .download(path)

            if (error || !data) {
                throw error ?? new Error('Download failed')
            }

            // Create download link
            const url = URL.createObjectURL(data)
            const a = document.createElement('a')
            a.href = url
            a.download = getFileName(path)
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            toast.success('File downloaded')
        } catch (error) {
            toast.error('Failed to download file')
        }
    }

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setIsDragging(false)

            const files = e.dataTransfer.files
            if (files.length > 0) {
                handleFileUpload(files)
            }
        },
        [handleFileUpload]
    )

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Tools & Files</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Tools Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Available Tools</p>
                        <Button
                            size="sm"
                            onClick={handleSaveTools}
                            disabled={isSaving}
                        >
                            {isSaving ? 'Saving...' : 'Save Tools'}
                        </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {toolOptions.map(tool => {
                            const isSelected = selectedTools.includes(tool.id)
                            return (
                                <Badge
                                    key={tool.id}
                                    variant={isSelected ? 'default' : 'secondary'}
                                    className={cn(
                                        'cursor-pointer transition-all hover:scale-105',
                                        isSelected && 'ring-2 ring-primary ring-offset-2'
                                    )}
                                    onClick={() => handleToolToggle(tool.id)}
                                >
                                    {isSelected && <IconCheck className="mr-1 h-3 w-3" />}
                                    {tool.name}
                                </Badge>
                            )
                        })}
                    </div>

                    {toolOptions.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Click to enable/disable tools. Selected tools will be available to your agent.
                        </p>
                    )}
                </div>

                {/* Files Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Reference Files</p>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isSaving}
                        >
                            <IconUpload className="mr-2 h-4 w-4" />
                            Upload Files
                        </Button>
                    </div>

                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={e => {
                            if (e.target.files) {
                                handleFileUpload(e.target.files)
                            }
                            e.target.value = '' // Reset input
                        }}
                        className="hidden"
                        accept=".pdf,.txt,.doc,.docx,.md,.json,.csv"
                    />

                    {/* Drag and drop area */}
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={cn(
                            'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
                            isDragging
                                ? 'border-primary bg-primary/5'
                                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                        )}
                    >
                        <IconUpload className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">
                            Drag and drop files here, or click Upload Files
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Supported: PDF, TXT, DOC, DOCX, MD, JSON, CSV (Max 10MB)
                        </p>
                    </div>

                    {/* Upload progress */}
                    {uploadProgress.length > 0 && (
                        <div className="space-y-2">
                            {uploadProgress.map((item, index) => (
                                <div
                                    key={index}
                                    className="rounded-md border bg-muted/50 p-3 space-y-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium truncate flex-1">
                                            {item.name}
                                        </span>
                                        {item.status === 'success' && (
                                            <IconCheck className="h-4 w-4 text-green-600" />
                                        )}
                                        {item.status === 'error' && (
                                            <IconX className="h-4 w-4 text-red-600" />
                                        )}
                                    </div>
                                    {item.status === 'uploading' && (
                                        <Progress value={item.progress} className="h-1" />
                                    )}
                                    {item.status === 'error' && item.error && (
                                        <p className="text-xs text-red-600">{item.error}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Uploaded files list */}
                    {fileKeys.length > 0 ? (
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                                {fileKeys.length} file{fileKeys.length > 1 ? 's' : ''} uploaded
                            </p>
                            <ul className="space-y-2">
                                {fileKeys.map(key => (
                                    <li
                                        key={key}
                                        className="flex items-center justify-between gap-3 rounded-md border bg-card p-3 hover:bg-accent/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            {getFileIcon(getFileName(key))}
                                            <span className="text-sm truncate">
                                                {getFileName(key)}
                                            </span>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleFileDownload(key)}
                                                disabled={isSaving}
                                                title="Download file"
                                            >
                                                <IconDownload className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleFileDelete(key)}
                                                disabled={isSaving}
                                                title="Delete file"
                                                className="text-destructive hover:text-destructive"
                                            >
                                                <IconTrash className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground text-center py-4">
                            No files uploaded yet. Upload documents to help your agent provide better responses.
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
