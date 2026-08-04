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
    <main>
      <h1>{group.name}</h1>
      <p>คุณคือ {ROLE_LABEL[role ?? 'member']}</p>
      <ul>
        <li><Link href={`/g/${groupId}/members`}>สมาชิกก๊วน</Link></li>
        {manage && <li><Link href={`/g/${groupId}/play`}>เข้าโหมดสนาม</Link></li>}
      </ul>
      {!manage && <p>โหมดสนามเปิดให้เฉพาะหัวก๊วนกับแอดมิน</p>}
    </main>
  )
}
