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

    // Get first available tenant for user
    const { data: tenants } = await supabase
        .from('tenant_users')
        .select('tenant_id, tenants(*)')
        .eq('user_id', userId)
        .limit(1)
        .single()

    if (tenants && tenants.tenants) {
        const firstTenant = tenants.tenants as Database['public']['Tables']['tenants']['Row']
        return firstTenant.id
    }

    return null
}
