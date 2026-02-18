'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { type VibeAgent } from '@/lib/types'
import { deriveToolToggles, buildToolsPayload } from '@/lib/agents/tooling'
import { getBrowserSupabaseClient } from '@/lib/supabase/browser-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
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

    const toggles = deriveToolToggles(agent.tools)
    const [useWeb, setUseWeb] = useState(toggles.useWeb)
    const [fileSearchEnabled, setFileSearchEnabled] = useState(toggles.fileSearch)
    const [fileKeys, setFileKeys] = useState<string[]>(agent.fileKeys)
    const [uploadProgress, setUploadProgress] = useState<FileUploadProgress[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [isIndexing, setIsIndexing] = useState(false)

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

    const handleSaveTools = async () => {
        try {
            const tools = buildToolsPayload({
                useWeb,
                fileSearch: fileSearchEnabled
            })

            await updateAgent({ tools })
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

                        return { path: data.path, file }
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
                const successfulUploads = results
                    .filter((r): r is PromiseFulfilledResult<{ path: string; file: File }> => r.status === 'fulfilled')
                    .map(r => r.value)

                if (successfulUploads.length > 0) {
                    const newFileKeys = Array.from(new Set([...fileKeys, ...successfulUploads.map(item => item.path)]))
                    setFileKeys(newFileKeys)
                    await updateAgent({ fileKeys: newFileKeys })

                    toast.success(
                        `${successfulUploads.length} file${successfulUploads.length > 1 ? 's' : ''} uploaded successfully`
                    )

                    // Trigger ingestion for RAG search (fire and forget).
                    setIsIndexing(true)
                    const ingestionResults = await Promise.allSettled(
                        successfulUploads.map(async ({ path, file }) => {
                            const res = await fetch(`/api/agents/${agent.id}/files/ingest`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    fileKey: path,
                                    fileName: file.name,
                                    mimeType: file.type || undefined
                                })
                            })
                            if (!res.ok) {
                                const payload = await res.json().catch(() => ({}))
                                throw new Error(payload.error ?? 'Ingestion failed')
                            }
                        })
                    )
                    const ingested = ingestionResults.filter(r => r.status === 'fulfilled').length
                    const failedIngest = ingestionResults.filter(r => r.status === 'rejected').length
                    if (ingested > 0) {
                        toast.success(`Indexed ${ingested} file${ingested > 1 ? 's' : ''} for search`)
                    }
                    if (failedIngest > 0) {
                        toast.error(`${failedIngest} file${failedIngest > 1 ? 's' : ''} failed to index`)
                    }
                    setIsIndexing(false)
                }

                const failedCount = results.filter(r => r.status === 'rejected').length
                if (failedCount > 0) {
                    toast.error(`${failedCount} file${failedCount > 1 ? 's' : ''} failed to upload`)
                }
            } catch (error) {
                setIsIndexing(false)
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
                        <div>
                            <p className="text-sm font-medium">Tools</p>
                            <p className="text-xs text-muted-foreground">
                                Control whether the agent can reach the web or search uploaded files.
                            </p>
                        </div>
                        <Button
                            size="sm"
                            onClick={handleSaveTools}
                            disabled={isSaving || isIndexing}
                        >
                            {isSaving ? 'Saving...' : isIndexing ? 'Indexing...' : 'Save Tools'}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
                            <div className="pr-4">
                                <p className="text-sm font-medium">Use web</p>
                                <p className="text-xs text-muted-foreground">
                                    Let the agent fetch provided URLs or search when it needs extra context.
                                </p>
                            </div>
                            <Switch
                                checked={useWeb}
                                disabled={isSaving}
                                onCheckedChange={value => setUseWeb(value)}
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
                            <div className="pr-4">
                                <p className="text-sm font-medium">File search</p>
                                <p className="text-xs text-muted-foreground">
                                    Allow the agent to ground responses in the files you upload here.
                                </p>
                            </div>
                            <Switch
                                checked={fileSearchEnabled}
                                disabled={isSaving}
                                onCheckedChange={value => setFileSearchEnabled(value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Files Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Reference Files</p>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isSaving || isIndexing}
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
                        accept=".pdf,.txt,.doc,.docx,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.tiff,.tif,.svg,.xlsx,.xls,.ppt,.pptx,.html,.htm"
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
                        {isIndexing && (
                            <p className="mt-2 text-xs text-muted-foreground">
                                Indexing uploads for file search…
                            </p>
                        )}
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
