import { createServerSupabase } from '@/lib/supabase/server'

export type Role = 'owner' | 'admin' | 'member'

export async function roleInGroup(groupId: string): Promise<Role | 'super' | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('is_super_admin').eq('id', user.id).single()
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
  if (membership?.role) return membership.role as Role
  return profile?.is_super_admin ? 'super' : null
}

export async function canManage(groupId: string): Promise<boolean> {
  const role = await roleInGroup(groupId)
  return role === 'owner' || role === 'admin' || role === 'super'
}
