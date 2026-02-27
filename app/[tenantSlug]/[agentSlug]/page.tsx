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

  // fixed inset-0: anchors to viewport, bypassing the parent min-height chain.
  // This ensures the scroll area is constrained and the input always stays visible.
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#F5F0E8] dark:bg-[#1A1915]">
      {agent.allowAnonymous ? (
        <PublicAgentExperience agent={agent} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-[#E2DDD4] bg-[#FDFAF5] p-8 text-center shadow-[0_4px_24px_rgba(26,25,21,0.08)] dark:border-[#2E2B25] dark:bg-[#221F1A]">
            <h1 className="font-serif text-2xl font-normal text-[#1A1915] dark:text-[#E8E3D8]">
              {agent.name}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#6B6560] dark:text-[#9D9790]">
              This agent requires an invitation or authenticated session.
              Please contact the owner for access.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
