import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export async function requireUser() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()
  return { id: user.id, isSuperAdmin: profile?.is_super_admin ?? false }
}
