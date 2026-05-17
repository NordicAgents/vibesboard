'use client'

import { useRouter } from 'next/navigation'
import { type VibeAgentConversation } from '@/lib/types'
import { ConversationView } from '@/components/agents/conversation-modal'

interface HandoffConversationPageProps {
  conversation: VibeAgentConversation
  agentId: string
}

export function HandoffConversationPage({
  conversation,
  agentId
}: HandoffConversationPageProps) {
  const router = useRouter()

  return (
    <ConversationView
      conversation={conversation}
      agentId={agentId}
      canReply
      onClose={() => router.push(`/agents/${agentId}`)}
      onConversationUpdate={() => router.refresh()}
    />
  )
}
