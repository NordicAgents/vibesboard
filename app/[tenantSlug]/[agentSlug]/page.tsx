import { notFound } from 'next/navigation'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc } from '@/lib/agents/db'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'

export const runtime = 'nodejs'

export default async function PublicAgentPage({
  params
}: {
  params: Promise<{ tenantSlug: string; agentSlug: string }>
}) {
  const { tenantSlug, agentSlug } = await params

  // 1. Resolve tenant slug → tenantId
  const slugDoc = await adminDb
    .collection(Collections.tenantSlugs)
    .doc(tenantSlug)
    .get()

  if (!slugDoc.exists) {
    notFound()
  }

  const tenantId = slugDoc.data()!.tenantId as string

  // 2. Find agent by agentUrl within that tenant
  const agentSnapshot = await adminDb
    .collection(Collections.agents(tenantId))
    .where('agentUrl', '==', agentSlug)
    .limit(1)
    .get()

  if (agentSnapshot.empty) {
    notFound()
  }

  const agent = mapAgentDoc(agentSnapshot.docs[0].data())

  return (
    <div className="flex flex-1 flex-col items-stretch justify-center overflow-hidden px-3 py-3 sm:items-center sm:px-6 sm:py-8">
      {agent.allowAnonymous ? (
        <PublicAgentExperience agent={agent} />
      ) : (
        <div className="mx-auto w-full max-w-lg rounded-2xl border border-border/50 p-8 text-center shadow-lg">
          <h1 className="text-2xl font-semibold tracking-tight">
            {agent.name}
          </h1>
          <p className="mt-2 text-muted-foreground">
            This agent requires an invitation or authenticated session.
            Please contact the owner for access.
          </p>
        </div>
      )}
    </div>
  )
}
