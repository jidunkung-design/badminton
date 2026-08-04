import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function GroupListPage() {
  const user = await requireUser()
  const supabase = await createServerSupabase()
  // RLS decides what comes back. Do not filter by membership here.
  const { data: groups } = await supabase.from('groups').select('id, name').order('name')

  return (
    <main className="screen">
      <h1>ก๊วนของฉัน</h1>
      {user.isSuperAdmin && (
        <div className="note">
          <em>สิทธิ์ระดับระบบ</em>
          เหลือโควตาสร้างก๊วนอีก {Math.max(0, 5 - (groups?.length ?? 0))} จาก 5
        </div>
      )}
      {(groups ?? []).length === 0 ? (
        <div className="void">ยังไม่ได้อยู่ก๊วนไหน รอหัวก๊วนส่งลิงก์เชิญ</div>
      ) : (
        <ul className="screen">
          {groups!.map(g => (
            <li key={g.id}>
              <Link href={`/g/${g.id}`} className="c">
                <div className="r">
                  <div className="av">{g.name.charAt(0)}</div>
                  <div className="gr">
                    <div className="nm">{g.name}</div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
