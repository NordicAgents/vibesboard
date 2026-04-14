import { notFound } from 'next/navigation'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc } from '@/lib/agents/db'
import { isFeatureEnabled } from '@/lib/features'
import { getAgentLinkBySlug } from '@/lib/agent-links/db'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'
import type { TenantBrandingDocument } from '@/lib/firestore-types'

export const runtime = 'nodejs'

export default async function AgentLinkPage({
  params
}: {
  params: Promise<{ tenantSlug: string; linkSlug: string }>
}) {
  const { tenantSlug, linkSlug } = await params

  // 1. Resolve tenant slug → tenantId
  const slugDoc = await adminDb
    .collection(Collections.tenantSlugs)
    .doc(tenantSlug)
    .get()

  if (!slugDoc.exists) {
    notFound()
  }

  const tenantId = slugDoc.data()!.tenantId as string

  // 2. Check if AGENT_LINKS feature is enabled for this tenant
  const agentLinksEnabled = await isFeatureEnabled(tenantId, 'AGENT_LINKS')
  if (!agentLinksEnabled) {
    notFound()
  }

  // 3. Find the agent link by slug
  const link = await getAgentLinkBySlug(tenantId, linkSlug)
  if (!link || !link.isActive) {
    notFound()
  }

  // 4. Fetch the connected agent
  const agentDoc = await adminDb
    .collection(Collections.agents(tenantId))
    .doc(link.agentId)
    .get()

  if (!agentDoc.exists) {
    notFound()
  }

  const agent = mapAgentDoc(agentDoc.data()!)

  // 5. Read Google Review config + branding
  const [tenantDoc, brandingDoc, baseBranding] = await Promise.all([
    adminDb.collection(Collections.tenants).doc(tenantId).get(),
    adminDb.collection(Collections.branding(tenantId)).doc(tenantId).get(),
    getBaseBranding()
  ])
  const tenantData = tenantDoc.data()
  const googleReviewFeatureEnabled = await isFeatureEnabled(
    tenantId,
    'GOOGLE_REVIEW'
  )
  const googleReviewPlaceId =
    googleReviewFeatureEnabled && agent.googleReviewEnabled
      ? agent.googlePlaceId || (tenantData?.googlePlaceId as string) || null
      : null

  // Resolve branding (tenant → platform → fallback)
  const tenantBranding = brandingDoc.exists
    ? (brandingDoc.data() as TenantBrandingDocument)
    : null
  const effectiveBranding = resolveEffectiveBranding(
    tenantBranding,
    baseBranding
  )
  const logoUrl = effectiveBranding.logoUrl || null

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]">
      {agent.allowAnonymous ? (
        <PublicAgentExperience
          agent={agent}
          googleReviewPlaceId={googleReviewPlaceId}
          logoUrl={logoUrl}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-[#e4e3e3] bg-[#f5f8f7] p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:border-[#344348] dark:bg-[#192425]">
            <h1 className="font-sans text-2xl font-normal text-[#222f30] dark:text-[#f5f8f7]">
              {agent.name}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#445e5f] dark:text-[#6f7f80]">
              This agent requires an invitation or authenticated session. Please
              contact the owner for access.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
