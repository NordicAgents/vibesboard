export async function isSuperAdminWithClient(
  supabase: any,
  userId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('tenant_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'SUPER_ADMIN')

  if (error) return false
  return (count ?? 0) > 0
}

