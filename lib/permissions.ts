import { createServerClient } from './supabase/server'
import { Database } from './db_types'
import { isSuperAdminWithClient } from './permissions-core'

export type Role = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'

export async function getUserRole(
    userId: string,
    tenantId: string
): Promise<Role | null> {
    const supabase = await createServerClient()

    const { data, error } = await supabase
        .from('tenant_users')
        .select('role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single()

    if (error || !data) return null
    return data.role as Role
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
    const supabase = createServerClient()
    return isSuperAdminWithClient(supabase, userId)
}

export async function isTenantAdmin(
    userId: string,
    tenantId: string
): Promise<boolean> {
    const supabase = await createServerClient()

    const { data, error } = await supabase
        .from('tenant_users')
        .select('role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .in('role', ['TENANT_ADMIN', 'SUPER_ADMIN'])
        .single()

    return !error && !!data
}

export async function canManageTenant(
    userId: string,
    tenantId: string
): Promise<boolean> {
    return await isTenantAdmin(userId, tenantId)
}

export async function getUserTenants(
    userId: string
): Promise<Database['public']['Tables']['tenants']['Row'][]> {
    const supabase = await createServerClient()

    const { data, error } = await supabase
        .from('tenant_users')
        .select('tenant_id, tenants(*)')
        .eq('user_id', userId)

    if (error || !data) return []

    return data
        .map((item: any) => item.tenants)
        .filter((tenant: any) => tenant !== null)
}

export async function getUserActiveTenant(
    userId: string
): Promise<string | null> {
    const tenants = await getUserTenants(userId)

    // Return first tenant or null
    // In the future, this could be stored in user preferences
    return tenants.length > 0 ? tenants[0].id : null
}

export async function isMemberOfTenant(
    userId: string,
    tenantId: string
): Promise<boolean> {
    const supabase = await createServerClient()

    const { data, error } = await supabase
        .from('tenant_users')
        .select('user_id')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single()

    return !error && !!data
}
