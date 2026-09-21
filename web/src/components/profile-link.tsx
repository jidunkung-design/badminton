import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabase/server'
import { mascotAppearance, type Locker } from '@/lib/cosmetics'
import { Mascot } from './mascot'

export async function ProfileLink() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.rpc('get_my_locker')
  const appearance = !error && data ? mascotAppearance(data as unknown as Locker) : undefined
  return <Link href="/mascot" aria-label="มาสคอตและกระเป๋าของฉัน" className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent">
    <Mascot appearance={appearance} portrait className="size-10 rounded-full" />
    <span className="hidden text-sm sm:inline">ของฉัน</span>
  </Link>
}
