import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { roleInGroup } from '@/lib/roles'

const ROLE_LABEL: Record<string, string> = {
  super: 'ซูเปอร์แอดมิน',
  owner: 'หัวก๊วน',
  admin: 'แอดมิน',
  member: 'สมาชิก',
}

export default async function GroupHome({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createServerSupabase()
  const { data: group } = await supabase.from('groups').select('id, name').eq('id', groupId).maybeSingle()
  if (!group) notFound()

  const role = await roleInGroup(groupId)
  const manage = role === 'owner' || role === 'admin' || role === 'super'

  return (
    <main className="screen">
      <div className="r">
        <div className="gr">
          <h1>{group.name}</h1>
        </div>
        <span className="who">คุณเป็น {ROLE_LABEL[role ?? 'member']}</span>
      </div>

      {manage && (
        <Link href={`/g/${groupId}/play`} className="b">เข้าโหมดสนาม</Link>
      )}
      <Link href={`/g/${groupId}/members`} className="b gh">สมาชิกก๊วน</Link>

      {!manage && (
        <div className="note gate">
          <em>สิทธิ์</em>
          โหมดสนามเปิดให้เฉพาะหัวก๊วนกับแอดมิน
        </div>
      )}
    </main>
  )
}
