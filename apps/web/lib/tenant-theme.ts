import 'server-only'

import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantBranding } from '@vibesboard/tenants'
import { ensureActiveTenant, getTenantById } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'
import {
  hexToHslParts,
  hexToRgbParts,
  normalizeHex,
  toCssHslVar
} from '@/lib/colors'

export async function getActiveTenantTheme(userId: string): Promise<{
  tenantId: string
  cssVars: Record<string, string>
  logoUrl: string | null
} | null> {
  const tenantId = await ensureActiveTenant(userId)
  if (!tenantId) return null

  const tenant = await getTenantById(tenantId)
  if (!tenant || tenant.isPersonal) {
    return null
  }

  const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
  if (!customBrandingEnabled) return null

  const db = getMigrateDb()
  const [brandingRow, baseBranding] = await Promise.all([
    getTenantBranding(db, tenantId),
    getBaseBranding(),
  ])

  const effective = resolveEffectiveBranding(
    brandingRow
      ? ({
          primaryColor: brandingRow.primaryColor,
          secondaryColor: brandingRow.secondaryColor,
          logoUrl: brandingRow.logoUrl ?? undefined,
          overrides: brandingRow.overrides ?? undefined,
        } as Parameters<typeof resolveEffectiveBranding>[0])
      : null,
    baseBranding,
  )

  const primaryHex = normalizeHex(effective.primaryColor) ?? null
  const secondaryHex = normalizeHex(effective.secondaryColor) ?? null

  if (!primaryHex || !secondaryHex) return null

  const primary = toCssHslVar(hexToHslParts(primaryHex))
  const secondary = toCssHslVar(hexToHslParts(secondaryHex))
  const { r, g, b } = hexToRgbParts(primaryHex)

  return {
    tenantId,
    logoUrl: effective.logoUrl ?? null,
    cssVars: {
      '--accent-orange': primaryHex,
      '--accent-warm': primaryHex,
      '--accent-glow': `rgba(${r}, ${g}, ${b}, 0.24)`,
      '--primary': primary,
      '--primary-foreground': secondary,
      '--ring': primary
    }
  }
}
