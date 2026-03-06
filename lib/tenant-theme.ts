import 'server-only'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { ensureActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
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

  const brandingDoc = await adminDb
    .collection(Collections.branding(tenantId))
    .doc(tenantId)
    .get()

  const branding = brandingDoc.exists ? brandingDoc.data() : null

  const primaryHex = normalizeHex(branding?.primaryColor ?? '#000000') ?? null
  const secondaryHex =
    normalizeHex(branding?.secondaryColor ?? '#ffffff') ?? null

  if (!primaryHex || !secondaryHex) return null

  const primary = toCssHslVar(hexToHslParts(primaryHex))
  const secondary = toCssHslVar(hexToHslParts(secondaryHex))
  const { r, g, b } = hexToRgbParts(primaryHex)

  return {
    tenantId,
    logoUrl: branding?.logoUrl ?? null,
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
