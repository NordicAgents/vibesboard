'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue
} from '@/components/ui/select'
import { RefreshCw, PlayCircle, AlertCircle, CheckCircle, Clock, Loader2 } from 'lucide-react'

interface FileRecord {
 id: string
 agentId: string
 agentName: string
 fileName: string
 fileSize: number
 mimeType: string
 status: 'pending' | 'processing' | 'indexed' | 'failed'
 chunkCount: number | null
 totalTokens: number | null
 error: string | null
 processingStartedAt: string | null
 processingCompletedAt: string | null
 createdAt: string
}

interface StatusStats {
 total: number
 pending: number
 processing: number
 indexed: number
 failed: number
}

export function AdminFileMonitor() {
 const [files, setFiles] = useState<FileRecord[]>([])
 const [stats, setStats] = useState<StatusStats>({
 total: 0,
 pending: 0,
 processing: 0,
 indexed: 0,
 failed: 0
 })
 const [statusFilter, setStatusFilter] = useState<string>('all')
 const [isLoading, setIsLoading] = useState(true)
 const [isProcessing, setIsProcessing] = useState(false)
 const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

 const fetchFiles = async () => {
 setIsLoading(true)
 try {
 const params = new URLSearchParams()
 if (statusFilter !== 'all') {
 params.set('status', statusFilter)
 }
 params.set('limit', '100')

 const res = await fetch(`/api/admin/files/process?${params}`)
 if (!res.ok) throw new Error('Failed to fetch files')

 const data = await res.json()
 setFiles(data.files)
 setStats(data.stats)
 } catch (error) {
 toast.error('Failed to load files')
 console.error(error)
 } finally {
 setIsLoading(false)
 }
 }

 useEffect(() => {
 fetchFiles()
 }, [statusFilter])

 const handleProcessFiles = async (type: 'pending' | 'failed' | 'selected') => {
 setIsProcessing(true)
 try {
 const body: any = { concurrency: 5 }

 if (type === 'selected') {
 if (selectedFiles.size === 0) {
 toast.error('No files selected')
 return
 }
 body.fileIds = Array.from(selectedFiles)
 } else {
 body.status = type
 body.limit = 50
 }

 const res = await fetch('/api/admin/files/process', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body)
 })

 if (!res.ok) throw new Error('Processing failed')

 const data = await res.json()
 toast.success(
 `Processed ${data.processed} files: ${data.successCount} success, ${data.failedCount} failed`
 )

 // Refresh list
 setSelectedFiles(new Set())
 await fetchFiles()
 } catch (error) {
 toast.error('Failed to process files')
 console.error(error)
 } finally {
 setIsProcessing(false)
 }
 }

 const toggleFileSelection = (fileId: string) => {
 const newSelection = new Set(selectedFiles)
 if (newSelection.has(fileId)) {
 newSelection.delete(fileId)
 } else {
 newSelection.add(fileId)
 }
 setSelectedFiles(newSelection)
 }

 const formatFileSize = (bytes: number) => {
 if (bytes < 1024) return `${bytes} B`
 if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
 return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
 }

 const formatDate = (dateStr: string | null) => {
 if (!dateStr) return 'N/A'
 const date = new Date(dateStr)
 return date.toLocaleString()
 }

 const getStatusBadge = (status: string) => {
 switch (status) {
 case 'indexed':
 return <Badge variant="default" className="bg-green-500"><CheckCircle className="mr-1 size-3" />Indexed</Badge>
 case 'processing':
 return <Badge variant="secondary"><Loader2 className="mr-1 size-3 animate-spin" />Processing</Badge>
 case 'pending':
 return <Badge variant="outline"><Clock className="mr-1 size-3" />Pending</Badge>
 case 'failed':
 return <Badge variant="destructive"><AlertCircle className="mr-1 size-3" />Failed</Badge>
 default:
 return <Badge variant="outline">{status}</Badge>
 }
 }

 return (
 <div className="space-y-6">
 {/* Statistics */}
 <div className="grid gap-4 md:grid-cols-5">
 <Card>
 <CardHeader className="pb-2">
 <CardDescription>Total Files</CardDescription>
 <CardTitle className="text-3xl">{stats.total}</CardTitle>
 </CardHeader>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardDescription>Indexed</CardDescription>
 <CardTitle className="text-3xl text-green-600">{stats.indexed}</CardTitle>
 </CardHeader>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardDescription>Pending</CardDescription>
 <CardTitle className="text-3xl text-yellow-600">{stats.pending}</CardTitle>
 </CardHeader>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardDescription>Processing</CardDescription>
 <CardTitle className="text-3xl text-blue-600">{stats.processing}</CardTitle>
 </CardHeader>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardDescription>Failed</CardDescription>
 <CardTitle className="text-3xl text-red-600">{stats.failed}</CardTitle>
 </CardHeader>
 </Card>
 </div>

 {/* Actions */}
 <Card>
 <CardHeader>
 <CardTitle>Actions</CardTitle>
 <CardDescription>Manually trigger file processing</CardDescription>
 </CardHeader>
 <CardContent className="flex flex-wrap gap-2">
 <Button
 onClick={() => handleProcessFiles('pending')}
 disabled={isProcessing || stats.pending === 0}
 >
 <PlayCircle className="mr-2 size-4" />
 Process Pending ({stats.pending})
 </Button>
 <Button
 onClick={() => handleProcessFiles('failed')}
 disabled={isProcessing || stats.failed === 0}
 variant="outline"
 >
 <RefreshCw className="mr-2 size-4" />
 Retry Failed ({stats.failed})
 </Button>
 <Button
 onClick={() => handleProcessFiles('selected')}
 disabled={isProcessing || selectedFiles.size === 0}
 variant="secondary"
 >
 <PlayCircle className="mr-2 size-4" />
 Process Selected ({selectedFiles.size})
 </Button>
 <Button onClick={fetchFiles} variant="ghost" disabled={isLoading}>
 <RefreshCw className={`mr-2 size-4 ${isLoading ? 'animate-spin' : ''}`} />
 Refresh
 </Button>
 </CardContent>
 </Card>

 {/* File List */}
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between">
 <div>
 <CardTitle>Files</CardTitle>
 <CardDescription>Showing {files.length} files</CardDescription>
 </div>
 <Select value={statusFilter} onValueChange={setStatusFilter}>
 <SelectTrigger className="w-[180px]">
 <SelectValue placeholder="Filter by status" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All Files</SelectItem>
 <SelectItem value="pending">Pending</SelectItem>
 <SelectItem value="processing">Processing</SelectItem>
 <SelectItem value="indexed">Indexed</SelectItem>
 <SelectItem value="failed">Failed</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </CardHeader>
 <CardContent>
 {isLoading ? (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="size-8 animate-spin text-muted-foreground" />
 </div>
 ) : files.length === 0 ? (
 <div className="py-8 text-center text-muted-foreground">
 No files found
 </div>
 ) : (
 <div className="space-y-2">
 {files.map(file => (
 <div
 key={file.id}
 className="flex items-start gap-4 rounded-lg border p-4 hover:bg-muted/50"
 >
 <input
 type="checkbox"
 checked={selectedFiles.has(file.id)}
 onChange={() => toggleFileSelection(file.id)}
 className="mt-1"
 />
 <div className="flex-1 space-y-2">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <div className="font-medium">{file.fileName}</div>
 <div className="text-sm text-muted-foreground">
 Agent: {file.agentName} • {formatFileSize(file.fileSize)} • {file.mimeType}
 </div>
 </div>
 {getStatusBadge(file.status)}
 </div>

 {file.status === 'indexed' && (
 <div className="text-sm text-muted-foreground">
 {file.chunkCount} chunks • {file.totalTokens?.toLocaleString()} tokens •
 Completed {formatDate(file.processingCompletedAt)}
 </div>
 )}

 {file.status === 'failed' && file.error && (
 <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600">
 Error: {file.error}
 </div>
 )}

 {file.status === 'processing' && file.processingStartedAt && (
 <div className="text-sm text-muted-foreground">
 Started {formatDate(file.processingStartedAt)}
 </div>
 )}

 {file.status === 'pending' && (
 <div className="text-sm text-muted-foreground">
 Created {formatDate(file.createdAt)} • Waiting for processing
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 )}
 </CardContent>
 </Card>
 </div>
 )
}
