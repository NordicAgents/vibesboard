import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { mapConversationDoc } from '@vibesboard/agents/db'
import { getAgentById } from '@vibesboard/agents/server'
import { getQrDataUrl } from '@/lib/qr'
import { AgentPageShell } from '@/components/agents/agent-page-shell'

export const runtime = 'nodejs'

export default async function AgentSectionLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const agent = await getAgentById(id)

  if (!agent) {
    notFound()
  }

  // Fetch conversations for this agent
  const tenantId = agent.tenantId
  let conversations: ReturnType<typeof mapConversationDoc>[] = []

  if (tenantId) {
    const convoSnapshot = await adminDb
      .collection(Collections.conversations(tenantId, agent.id))
      .orderBy('updatedAt', 'desc')
      .get()

    conversations = convoSnapshot.docs.map((doc: any) =>
      mapConversationDoc(doc.data())
    )
  }

  const headersList = await headers()
  // Handle comma-separated proxy headers (e.g., "https,http") by taking the first value
  const rawProto = headersList.get('x-forwarded-proto')
  const protocol =
    (rawProto ? rawProto.split(',')[0]?.trim() : null) ??
    (headersList.get('host')?.startsWith('localhost') ? 'http' : 'https')
  const rawHost = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const host = rawHost ? rawHost.split(',')[0]?.trim() : null
  const origin =
    (protocol && host
      ? `${protocol}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  const shareUrl = `${origin}/${agent.tenantSlug ?? 'unknown'}/${agent.agentUrl}`
  const qrDataUrl = await getQrDataUrl(shareUrl)

  return <AgentPageShell>{children}</AgentPageShell>
}
