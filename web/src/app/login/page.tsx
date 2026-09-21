import { createServerSupabase } from '@/lib/supabase/server'
import LoginForm from './LoginForm'
import { redirect } from 'next/navigation'
import type { PlayerGender } from '@/domain/types'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ join?: string }> }) {
  const { join } = await searchParams
  if (join && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(join)) {
    return <main className="py-12"><h1 className="text-2xl font-semibold">ลิงก์เชิญไม่ถูกต้อง</h1><p className="mt-3 text-muted">ขอลิงก์ใหม่จากเจ้าของห้องนะคะ</p></main>
  }
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  let username = ''
  let gender: PlayerGender = 'unspecified'
  if (user) {
    if (join) {
      const { data: membership } = await supabase.from('group_members').select('role')
        .eq('group_id', join).eq('user_id', user.id).maybeSingle()
      if (membership) redirect(`/g/${join}`)
    }
    const { data, error } = await supabase.from('profiles').select('username, gender').eq('id', user.id).maybeSingle()
    if (error) return <main className="py-12"><h1 className="text-2xl font-semibold">โหลดข้อมูลผู้ใช้ไม่สำเร็จ</h1><p className="mt-3 text-muted">กรุณาโหลดหน้านี้ใหม่ก่อนสร้างหรือเข้าร่วมห้อง</p></main>
    username = data?.username ?? ''
    gender = data?.gender === 'male' || data?.gender === 'female' ? data.gender : 'unspecified'
  }
  return <LoginForm key={join ?? 'create'} username={username} gender={gender} roomId={join ?? crypto.randomUUID()} joining={Boolean(join)} />
}
