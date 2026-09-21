import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Locker } from '@/lib/cosmetics'
import MascotClient from './MascotClient'

export default async function MascotPage() {
  await requireUser()
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('get_my_locker')
  return <div className="mx-auto max-w-5xl py-7 sm:py-10">
    <Link href="/" className="text-sm text-muted underline underline-offset-4">← กลับไปห้องของฉัน</Link>
    {error || !data ? <section className="mt-8 rounded-2xl border border-[#dbe3d5] bg-white p-6"><h1 className="text-xl font-semibold">ตู้แต่งตัวยังไม่พร้อม</h1><p className="mt-2 text-muted">โหลดของสะสมไม่สำเร็จ กรุณาลองเปิดหน้านี้ใหม่ภายหลัง</p></section> : <MascotClient initial={data as unknown as Locker} />}
  </div>
}
