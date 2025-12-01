import { createServerClient } from '@/lib/supabase/server'
import { Database } from '@/lib/db_types'

export type FeatureFlagName =
    | 'BETA_ANALYTICS'
    | 'ADVANCED_TOOLS'
    | 'CUSTOM_BRANDING'
    | 'API_ACCESS'
    | 'TEAM_COLLABORATION'

/**
 * Check if a feature is enabled for a specific tenant
 */
export async function isFeatureEnabled(
    tenantId: string,
    featureName: FeatureFlagName
): Promise<boolean> {
    const supabase = await createServerClient()

    // Get feature flag
    const { data: flag, error: flagError } = await supabase
        .from('feature_flags')
        .select('id, default_value')
        .eq('name', featureName)
        .single()

    if (flagError || !flag) {
        return false
    }

    // Check for tenant-specific override
    const { data: toggle, error: toggleError } = await supabase
        .from('tenant_feature_toggles')
        .select('is_enabled')
        .eq('tenant_id', tenantId)
        .eq('feature_flag_id', flag.id)
        .single()

    // Return override if exists, otherwise return default
    if (!toggleError && toggle) {
        return toggle.is_enabled
    }

    return flag.default_value
}

/**
 * Get all enabled features for a tenant
 */
export async function getEnabledFeatures(
    tenantId: string
): Promise<string[]> {
    const supabase = await createServerClient()

    // Get all feature flags
    const { data: flags, error: flagsError } = await supabase
        .from('feature_flags')
        .select('*')

    if (flagsError || !flags) {
        return []
    }

    // Get tenant-specific toggles
    const { data: toggles, error: togglesError } = await supabase
        .from('tenant_feature_toggles')
        .select('*')
        .eq('tenant_id', tenantId)

    if (togglesError) {
        // Return features based on defaults only
        return flags
            .filter(flag => flag.default_value)
            .map(flag => flag.name)
    }

    // Merge defaults with overrides
    const enabledFeatures: string[] = []

    for (const flag of flags) {
        const toggle = toggles?.find(t => t.feature_flag_id === flag.id)
        const isEnabled = toggle ? toggle.is_enabled : flag.default_value

        if (isEnabled) {
            enabledFeatures.push(flag.name)
        }
    }

    return enabledFeatures
}

/**
 * Get all features with their status for a tenant
 */
export async function getTenantFeatures(
    tenantId: string
): Promise<Array<{
    id: string
    name: string
    description: string | null
    isEnabled: boolean
    isOverridden: boolean
}>> {
    const supabase = await createServerClient()

    // Get all feature flags
    const { data: flags, error: flagsError } = await supabase
        .from('feature_flags')
        .select('*')

    if (flagsError || !flags) {
        return []
    }

    // Get tenant-specific toggles
    const { data: toggles } = await supabase
        .from('tenant_feature_toggles')
        .select('*')
        .eq('tenant_id', tenantId)

    return flags.map(flag => {
        const toggle = toggles?.find(t => t.feature_flag_id === flag.id)

        return {
            id: flag.id,
            name: flag.name,
            description: flag.description,
            isEnabled: toggle ? toggle.is_enabled : flag.default_value,
            isOverridden: !!toggle
        }
    })
}

/**
 * Toggle a feature for a tenant
 */
export async function toggleFeature(
    tenantId: string,
    featureFlagId: string,
    isEnabled: boolean
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createServerClient()

    const { error } = await supabase
        .from('tenant_feature_toggles')
        .upsert({
            tenant_id: tenantId,
            feature_flag_id: featureFlagId,
            is_enabled: isEnabled
        })

    if (error) {
        return { success: false, error: error.message }
    }

    return { success: true }
}
