import { notFound } from 'next/navigation'

import { getTenantBySlug } from '@/lib/tenant-context'
import { getAgentForMember } from '@vibesboard/agents/server'
import { toPublicAgent } from '@vibesboard/contracts'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantBranding } from '@vibesboard/tenants'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getAgentLinkBySlug } from '@vibesboard/policy/agent-links/db'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

export default async function AgentLinkPage({
  params
}: {
  params: Promise<{ tenantSlug: string; linkSlug: string }>
}) {
  const { tenantSlug, linkSlug } = await params

  // 1. Resolve tenant slug → tenant
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) notFound()

  // 2. Check if AGENT_LINKS feature is enabled for this tenant
  const agentLinksEnabled = await isFeatureEnabled(tenant.id, 'AGENT_LINKS')
  if (!agentLinksEnabled) {
    notFound()
  }

  // 3. Find the agent link by slug
  const link = await getAgentLinkBySlug(tenant.id, linkSlug)
  if (!link || !link.isActive) {
    notFound()
  }

  // 4. Fetch the connected agent
  const agent = await getAgentForMember(tenant.id, link.agentId)
  if (!agent) notFound()

  // 5. Read Google Review config + branding
  const db = getMigrateDb()
  const [brandingRow, baseBranding] = await Promise.all([
    getTenantBranding(db, tenant.id),
    getBaseBranding()
  ])
  const googleReviewFeatureEnabled = await isFeatureEnabled(
    tenant.id,
    'GOOGLE_REVIEW'
  )
  const googleReviewPlaceId =
    googleReviewFeatureEnabled && agent.googleReviewEnabled
      ? agent.googlePlaceId || tenant.googlePlaceId || null
      : null

  // Resolve branding (tenant → platform → fallback)
  const effectiveBranding = resolveEffectiveBranding(
    brandingRow
      ? ({
          primaryColor: brandingRow.primaryColor,
          secondaryColor: brandingRow.secondaryColor,
          logoUrl: brandingRow.logoUrl ?? undefined,
          overrides: brandingRow.overrides ?? undefined
        } as Parameters<typeof resolveEffectiveBranding>[0])
      : null,
    baseBranding
  )
  const logoUrl = effectiveBranding.logoUrl || null

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]">
      {agent.allowAnonymous ? (
        <PublicAgentExperience
          agent={toPublicAgent(agent)}
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
