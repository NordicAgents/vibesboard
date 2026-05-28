/**
 * Self-host shim — every feature is always enabled.
 * The previous implementation read feature-flag + toggle records from
 * the database. Self-host operators who want per-tenant feature gating
 * can re-implement this locally.
 */

import type { FeatureFlagName } from './feature-flags.ts'

export interface TenantFeatureStatus {
  id: string
  name: string
  description: string | null
  isEnabled: boolean
  isOverridden: boolean
  parentFlagName: string | null
  isDisabledByParent: boolean
  depth: number
}

/**
 * Check if a feature is enabled for a specific tenant.
 * Self-host: all features are always enabled.
 */
export async function isFeatureEnabled(
  _tenantId: string,
  _featureName: FeatureFlagName,
): Promise<boolean> {
  return true
}

/**
 * Get all enabled features for a tenant.
 * Self-host: returns empty list (callers should treat absence of list
 * as "all enabled" — use isFeatureEnabled for per-feature checks).
 */
export async function getEnabledFeatures(_tenantId: string): Promise<string[]> {
  return []
}

/**
 * Get all features with their status for a tenant.
 * Self-host: returns empty list.
 */
export async function getTenantFeatures(
  _tenantId: string,
): Promise<TenantFeatureStatus[]> {
  return []
}

/**
 * Toggle a feature for a tenant — no-op in self-host.
 */
export async function toggleFeature(
  _tenantId: string,
  _featureFlagId: string,
  _isEnabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  return { success: true }
}

/** Synchronous helpers used by some callers */
export function hasFeature(
  _tenantPlanId: string | null | undefined,
  _featureKey: string,
): boolean {
  return true
}

export function tenantHasFeature(_tenant: unknown, _featureKey: string): boolean {
  return true
}

export function featuresForPlan(_planId: string | null | undefined): string[] {
  return []
}
