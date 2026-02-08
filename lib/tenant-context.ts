import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import { Database } from '@/lib/db_types'

const ACTIVE_TENANT_COOKIE = 'active_tenant_id'

/**
 * Get the active tenant ID from cookie
 */
export async function getActiveTenantId(): Promise<string | null> {
    const cookieStore = await cookies()
    return cookieStore.get(ACTIVE_TENANT_COOKIE)?.value || null
}

/**
 * Set the active tenant ID in cookie
 */
export async function setActiveTenantId(tenantId: string) {
    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365 // 1 year
    })
}

/**
 * Clear the active tenant ID from cookie
 */
export async function clearActiveTenantId() {
    const cookieStore = await cookies()
    cookieStore.delete(ACTIVE_TENANT_COOKIE)
}

/**
 * Get the active tenant with full details
 */
export async function getActiveTenant(userId?: string): Promise<string | null> {
    let tenantId = await getActiveTenantId()

    // If no active tenant but userId provided, get first available
    if (!tenantId && userId) {
        tenantId = await ensureActiveTenant(userId)
    }

    return tenantId
}

/**
 * Get all tenants for a user
 */
export async function getUserTenants(userId: string): Promise<Database['public']['Tables']['tenants']['Row'][]> {
    const supabase = createServerClient()

    const { data, error } = await supabase
        .from('tenant_users')
        .select('tenants(*)')
        .eq('user_id', userId)

    if (error || !data) {
        return []
    }

    return data.map(item => item.tenants).filter(Boolean) as Database['public']['Tables']['tenants']['Row'][]
}

/**
 * Get full tenant details by ID
 */
export async function getTenantById(tenantId: string): Promise<Database['public']['Tables']['tenants']['Row'] | null> {
    const supabase = createServerClient()

    const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single()

    if (error || !data) {
        return null
    }

    return data
}

/**
 * Get tenant branding for the active tenant
 */
export async function getActiveTenantBranding() {
    const tenantId = await getActiveTenantId()

    if (!tenantId) {
        return null
    }

    const supabase = await createServerClient()

    const { data, error } = await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', tenantId)
        .single()

    if (error || !data) {
        return null
    }

    return data
}

/**
 * Get tenant context including tenant, branding, and user role
 */
export async function getTenantContext(userId: string) {
    const tenantId = await getActiveTenantId()

    if (!tenantId) {
        return null
    }

    const supabase = await createServerClient()

    // Get tenant details
    const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single()

    if (!tenant) {
        return null
    }

    // Get branding
    const { data: branding } = await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', tenantId)
        .single()

    // Get user role
    const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single()

    return {
        tenant,
        branding,
        role: tenantUser?.role || null
    }
}

/**
 * Ensure user has access to tenant, or set first available tenant
 */
export async function ensureActiveTenant(userId: string): Promise<string | null> {
    const supabase = await createServerClient()

    // Get current active tenant
    let tenantId = await getActiveTenantId()

    // Check if user has access to current tenant
    if (tenantId) {
        const { data } = await supabase
            .from('tenant_users')
            .select('tenant_id')
            .eq('user_id', userId)
            .eq('tenant_id', tenantId)
            .single()

        if (data) {
            return tenantId
        }
    }

    // Get a deterministic tenant choice for the user when no active cookie is set/valid.
    // Prefer the user's personal workspace if present, otherwise pick the oldest tenant.
    const { data: tenantRow } = await supabase
        .from('tenant_users')
        .select('tenant_id, tenants(id, is_personal, created_at)')
        .eq('user_id', userId)
        .order('is_personal', { foreignTable: 'tenants', ascending: false })
        .order('created_at', { foreignTable: 'tenants', ascending: true })
        .limit(1)
        .maybeSingle()

    const chosenTenantId = (tenantRow?.tenants as any)?.id as string | undefined
    if (chosenTenantId) {
        return chosenTenantId
    }

    // As a fallback, create or fetch a personal tenant so the user always has one
    try {
        return await ensurePersonalTenant(userId)
    } catch (error) {
        console.error('Failed to ensure personal tenant:', error)
        return null
    }
}

/**
 * Create or fetch the user's personal tenant, returning its id.
 */
export async function ensurePersonalTenant(userId: string): Promise<string> {
    const supabase = await createServerClient()

    const { data, error } = await supabase.rpc('create_or_get_personal_tenant', {
        p_user_id: userId
    })

    if (error || !data) {
        throw error || new Error('Unable to create or fetch personal tenant')
    }

    return data as string
}
