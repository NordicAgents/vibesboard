import 'server-only'

import { createServerClient } from '@/lib/supabase/server'
import { ensureActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { hexToHslParts, normalizeHex, toCssHslVar } from '@/lib/colors'

export async function getActiveTenantTheme(userId: string): Promise<{
  tenantId: string
  cssVars: Record<string, string>
  logoUrl: string | null
} | null> {
  const tenantId = await ensureActiveTenant(userId)
  if (!tenantId) {
    return null
  }

  const supabase = createServerClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, is_personal')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant || tenant.is_personal) {
    return null
  }

  const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
  if (!customBrandingEnabled) {
    return null
  }

  const { data: branding } = await supabase
    .from('tenant_branding')
    .select('logo_url, primary_color, secondary_color')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const primaryHex = normalizeHex(branding?.primary_color ?? '#000000') ?? null
  const secondaryHex = normalizeHex(branding?.secondary_color ?? '#ffffff') ?? null

  if (!primaryHex || !secondaryHex) {
    return null
  }

  const primary = toCssHslVar(hexToHslParts(primaryHex))
  const secondary = toCssHslVar(hexToHslParts(secondaryHex))

  return {
    tenantId,
    logoUrl: branding?.logo_url ?? null,
    cssVars: {
      '--primary': primary,
      '--primary-foreground': secondary,
      '--ring': primary
    }
  }
}

