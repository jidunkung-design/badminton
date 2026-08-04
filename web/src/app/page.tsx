import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function GroupListPage() {
  const user = await requireUser()
  const supabase = await createServerSupabase()
  // RLS decides what comes back. Do not filter by membership here.
  const { data: groups } = await supabase.from('groups').select('id, name').order('name')

  return (
    <main>
      <h1>ก๊วนของฉัน</h1>
      {user.isSuperAdmin && (
        <p>เหลือโควตาสร้างก๊วนอีก {Math.max(0, 5 - (groups?.length ?? 0))} จาก 5</p>
      )}
      {(groups ?? []).length === 0 ? (
        <p>ยังไม่ได้อยู่ก๊วนไหน รอหัวก๊วนส่งลิงก์เชิญ</p>
      ) : (
        <ul>
          {groups!.map(g => (
            <li key={g.id}><Link href={`/g/${g.id}`}>{g.name}</Link></li>
          ))}
        </ul>
      )}
    </main>
  )
}
