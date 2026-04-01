import 'server-only'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { TenantBrandingDocument } from '@/lib/firestore-types'
import { ensureActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
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

  const tenantDoc = await adminDb
    .collection(Collections.tenants)
    .doc(tenantId)
    .get()

  if (!tenantDoc.exists || tenantDoc.data()?.isPersonal) {
    return null
  }

  const customBrandingEnabled = await isFeatureEnabled(
    tenantId,
    'CUSTOM_BRANDING'
  )
  if (!customBrandingEnabled) return null

  const [brandingDoc, baseBranding] = await Promise.all([
    adminDb
      .collection(Collections.branding(tenantId))
      .doc(tenantId)
      .get(),
    getBaseBranding()
  ])

  const tenantBranding = brandingDoc.exists
    ? (brandingDoc.data() as TenantBrandingDocument)
    : null

  const effective = resolveEffectiveBranding(tenantBranding, baseBranding)

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
