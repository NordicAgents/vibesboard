import { notFound } from 'next/navigation'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc } from '@/lib/agents/db'
import { isFeatureEnabled } from '@/lib/features'
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

  // Read Google Review config from tenant doc
  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()
  const tenantData = tenantDoc.data()
  const googleReviewEnabled = await isFeatureEnabled(tenantId, 'GOOGLE_REVIEW')
  const googleReviewPlaceId =
    googleReviewEnabled && tenantData?.googlePlaceId
      ? (tenantData.googlePlaceId as string)
      : null

  // fixed inset-0: anchors to viewport, bypassing the parent min-height chain.
  // This ensures the scroll area is constrained and the input always stays visible.
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#1A1A1A]">
      {agent.allowAnonymous ? (
        <PublicAgentExperience agent={agent} googleReviewPlaceId={googleReviewPlaceId} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-[#E5E5E5] bg-[#F7F7F5] p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:border-[#2A2A2A] dark:bg-[#141414]">
            <h1 className="font-sans text-2xl font-normal text-[#1A1A1A] dark:text-[#F0F0F0]">
              {agent.name}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#5A5A5A] dark:text-[#8A8A8A]">
              This agent requires an invitation or authenticated session.
              Please contact the owner for access.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
