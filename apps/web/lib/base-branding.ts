import 'server-only'

import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import type {
  PlatformBrandingDocument,
  TenantBrandingDocument,
  BrandingField
} from '@vibesboard/contracts'

// Hardcoded fallback if platform_config/branding doc doesn't exist yet
const HARDCODED_FALLBACK: BaseBranding = {
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  logoUrl: undefined
}

export interface BaseBranding {
  primaryColor: string
  secondaryColor: string
  logoUrl?: string
}

// Simple in-memory cache (60s TTL)
let cachedBase: BaseBranding | null = null
let cacheExpiry = 0

/**
 * Fetch the platform base branding from Firestore.
 * Falls back to HARDCODED_FALLBACK if the doc doesn't exist.
 */
export async function getBaseBranding(): Promise<BaseBranding> {
  const now = Date.now()
  if (cachedBase && now < cacheExpiry) {
    return cachedBase
  }

  const doc = await adminDb
    .collection(Collections.platformConfig)
    .doc('branding')
    .get()

  if (doc.exists) {
    const data = doc.data() as PlatformBrandingDocument
    cachedBase = {
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
      logoUrl: data.logoUrl || undefined
    }
  } else {
    cachedBase = { ...HARDCODED_FALLBACK }
  }

  cacheExpiry = now + 60_000
  return cachedBase
}

/** Invalidate the base branding cache (call after updating platform branding). */
export function invalidateBaseBrandingCache() {
  cachedBase = null
  cacheExpiry = 0
}

/**
 * Merge tenant branding with base branding using the overrides array.
 *
 * - tenantBranding is null        → return base branding
 * - overrides is undefined (legacy) → return tenant values (backward compatible)
 * - overrides is []               → return base branding (fully inherited)
 * - overrides has fields          → use tenant value for those, base for rest
 */
export function resolveEffectiveBranding(
  tenantBranding: TenantBrandingDocument | null,
  baseBranding: BaseBranding
): BaseBranding {
  if (!tenantBranding) {
    return baseBranding
  }

  // Legacy docs without overrides field → treat as fully overridden
  if (tenantBranding.overrides === undefined) {
    return {
      primaryColor: tenantBranding.primaryColor,
      secondaryColor: tenantBranding.secondaryColor,
      logoUrl: tenantBranding.logoUrl
    }
  }

  // Empty overrides → fully inherited
  if (tenantBranding.overrides.length === 0) {
    return baseBranding
  }

  const overrides = new Set<BrandingField>(tenantBranding.overrides)

  return {
    primaryColor: overrides.has('primaryColor')
      ? tenantBranding.primaryColor
      : baseBranding.primaryColor,
    secondaryColor: overrides.has('secondaryColor')
      ? tenantBranding.secondaryColor
      : baseBranding.secondaryColor,
    logoUrl: overrides.has('logoUrl')
      ? tenantBranding.logoUrl
      : baseBranding.logoUrl
  }
}
