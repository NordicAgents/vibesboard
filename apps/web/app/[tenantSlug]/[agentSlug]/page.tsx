import { notFound } from 'next/navigation'

import { getTenantBySlug } from '@/lib/tenant-context'
import { getAgentBySlug } from '@vibesboard/agents/server'
import { toPublicAgent } from '@vibesboard/contracts'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantBranding } from '@vibesboard/tenants'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'
import { hasValidAccessCookie } from '@/lib/access-gate'
import { GatedAgentPage } from './gated-agent-page'

export const runtime = 'nodejs'

export default async function PublicAgentPage({
  params
}: {
  params: Promise<{ tenantSlug: string; agentSlug: string }>
}) {
  const { tenantSlug, agentSlug } = await params

  // 1. Resolve tenant slug → tenant
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) notFound()

  // 2. Find agent by agentUrl within that tenant
  const agent = await getAgentBySlug(tenant.id, agentSlug)
  if (!agent) notFound()

  // Read Google Review config: feature flag (tenant gate) + agent-level toggle
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

  // Only the public-safe field subset crosses the client boundary. The full
  // agent (system instructions, fileKeys, connection IDs, webhook secret) must
  // never reach the RSC payload — least of all on the gated branch, which
  // renders before the visitor has passed the access check.
  const publicAgent = toPublicAgent(agent)

  // fixed inset-0: anchors to viewport, bypassing the parent min-height chain.
  // This ensures the scroll area is constrained and the input always stays visible.
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]">
      {agent.allowAnonymous ? (
        <PublicAgentExperience
          agent={publicAgent}
          googleReviewPlaceId={googleReviewPlaceId}
          logoUrl={logoUrl}
        />
      ) : (
        <GatedAgentPage
          agent={publicAgent}
          googleReviewPlaceId={googleReviewPlaceId}
          logoUrl={logoUrl}
          hasExistingAccess={await hasValidAccessCookie(agent.id)}
        />
      )}
    </div>
  )
}
