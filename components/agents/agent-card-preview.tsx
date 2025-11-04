'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { type VibeAgentTool } from '@/lib/types'

interface AgentCardPreviewProps {
  name: string
  instructions: string
  tools: VibeAgentTool[]
  fileCount: number
  allowAnonymous: boolean
}

export function AgentCardPreview({
  name,
  instructions,
  tools,
  fileCount,
  allowAnonymous
}: AgentCardPreviewProps) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{name || 'Untitled VibeAgent'}</span>
          <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span>Allow anonymous</span>
            <Switch checked={allowAnonymous} disabled />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="min-h-[80px] whitespace-pre-wrap rounded-md bg-muted/60 p-3">
          {instructions || 'Add instructions on the left to preview the vibe.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {tools.length ? (
            tools.map(tool => (
              <Badge key={tool.id} variant="secondary">
                {tool.name}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">No tools selected</span>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {fileCount} file{fileCount === 1 ? '' : 's'} attached
        </div>
      </CardContent>
    </Card>
  )
}
