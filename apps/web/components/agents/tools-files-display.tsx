'use client'

import { type VibeAgent } from '@/lib/types'
import { getDisplayTools } from '@/lib/agents/tooling'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
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

  const displayTools = getDisplayTools(agent.tools)

  return (
    <Card className="rounded-3xl border-black-10 bg-purewhite-bg shadow-lg">
      <CardHeader>
        <CardTitle className="font-switzer text-2xl font-bold text-black-primary">
          Tools & files
        </CardTitle>
        <CardDescription className="font-switzer text-gray-secondary">
          Context used by the agent when responding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tools Section */}
        <div>
          <p className="font-switzer text-sm font-medium text-black-primary">
            Tools
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {displayTools.length > 0 ? (
              displayTools.map(tool => (
                <Badge
                  key={tool.id}
                  variant="default"
                  className="flex items-center gap-1"
                >
                  <IconCheck className="size-3" />
                  {tool.name}
                </Badge>
              ))
            ) : (
              <p className="font-switzer text-xs text-gray-secondary">
                None enabled.
              </p>
            )}
          </div>
          {displayTools.length > 0 && (
            <p className="mt-2 font-switzer text-xs text-gray-secondary">
              {displayTools.length} tool{displayTools.length > 1 ? 's' : ''}{' '}
              enabled
            </p>
          )}
        </div>

        {/* Files Section */}
        <div>
          <p className="font-switzer text-sm font-medium text-black-primary">
            Reference Files
          </p>
          <div className="mt-2 space-y-2">
            {agent.fileKeys.length > 0 ? (
              <ul className="space-y-2">
                {agent.fileKeys.map(key => (
                  <li
                    key={key}
                    className="bg-beige-bg/30 flex items-center gap-2 rounded-2xl border border-black-10 p-3"
                  >
                    <IconFile className="size-4 shrink-0 text-gray-secondary" />
                    <span className="truncate font-switzer text-sm text-black-primary">
                      {getFileName(key)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-switzer text-xs text-gray-secondary">
                No files uploaded yet.
              </p>
            )}
          </div>
          {agent.fileKeys.length > 0 && (
            <p className="mt-2 font-switzer text-xs text-gray-secondary">
              {agent.fileKeys.length} file{agent.fileKeys.length > 1 ? 's' : ''}{' '}
              uploaded
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
