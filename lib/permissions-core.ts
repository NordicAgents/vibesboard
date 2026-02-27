export async function isSuperAdminWithClient(
  client: any,
  userId: string
): Promise<boolean> {
  const { count, error } = await client
    .from('super_admins')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (error) return false
  return (count ?? 0) > 0
}
