'use client'

import { type VibeAgent } from '@/lib/types'
import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { IconFile, IconCheck } from '@/components/ui/icons'

interface ToolsFilesDisplayProps {
    agent: VibeAgent
}

export function ToolsFilesDisplay({ agent }: ToolsFilesDisplayProps) {
    // Extract clean filename from storage path
    const getFileName = (path: string): string => {
        const parts = path.split('/')
        const filename = parts[parts.length - 1] || path
        // Remove timestamp prefix if it exists (e.g., "1234567890-file.pdf" -> "file.pdf")
        return filename.replace(/^\d+-/, '')
    }

    const toolOptions = Object.values(BUILTIN_AGENT_TOOLS)

    return (
        <Card>
            <CardHeader>
                <CardTitle>Tools & files</CardTitle>
                <CardDescription>
                    Context used by the agent when responding.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Tools Section */}
                <div>
                    <p className="text-sm font-medium">Tools</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {agent.tools.length > 0 ? (
                            agent.tools.map(tool => (
                                <Badge key={tool.id} variant="default" className="flex items-center gap-1">
                                    <IconCheck className="h-3 w-3" />
                                    {tool.name}
                                </Badge>
                            ))
                        ) : (
                            <p className="text-xs text-muted-foreground">None enabled.</p>
                        )}
                    </div>
                    {agent.tools.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            {agent.tools.length} tool{agent.tools.length > 1 ? 's' : ''} enabled
                        </p>
                    )}
                </div>

                {/* Files Section */}
                <div>
                    <p className="text-sm font-medium">Reference Files</p>
                    <div className="mt-2 space-y-2">
                        {agent.fileKeys.length > 0 ? (
                            <ul className="space-y-2">
                                {agent.fileKeys.map(key => (
                                    <li
                                        key={key}
                                        className="flex items-center gap-2 rounded-md border bg-card p-3"
                                    >
                                        <IconFile className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                        <span className="text-sm truncate">
                                            {getFileName(key)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                No files uploaded yet.
                            </p>
                        )}
                    </div>
                    {agent.fileKeys.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            {agent.fileKeys.length} file{agent.fileKeys.length > 1 ? 's' : ''} uploaded
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
