'use client'

import { useRouter } from 'next/navigation'
import type { VibeAgent } from '@/lib/types'
import { ToolsFilesManager } from '@/components/agents/tools-files-manager'

interface AgentKnowledgeTabProps {
  agent: VibeAgent
  canEdit: boolean
  sourceUrls: string[]
  onSourceUrlsChange: (urls: string[]) => void
}

export function AgentKnowledgeTab({
  agent,
  canEdit,
  sourceUrls,
  onSourceUrlsChange
}: AgentKnowledgeTabProps) {
  const router = useRouter()

  return (
    <div className="space-y-5 pb-8">
      <ToolsFilesManager
        agent={agent}
        onUpdate={() => router.refresh()}
        canEdit={canEdit}
        sourceUrls={sourceUrls}
        onSourceUrlsChange={onSourceUrlsChange}
      />
    </div>
  )
}
