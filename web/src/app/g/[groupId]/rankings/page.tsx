import { notFound } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { roleInGroup } from '@/lib/roles'
import { GroupNav } from '@/components/group-nav'
import { GroupRankings } from '@/components/group-rankings'

export default async function RankingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createServerSupabase()
  const { data: group } = await supabase.from('groups').select('name').eq('id', groupId).maybeSingle()
  if (!group) notFound()
  const role = await roleInGroup(groupId)
  if (!role) notFound()
  const manage = role === 'owner' || role === 'admin' || role === 'super'

  return <main className="space-y-8 py-4 sm:py-8">
    <header>
      <p className="mb-2 break-words text-sm text-muted">{group.name}</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">อันดับในก๊วน</h1>
      <p className="mt-3 text-muted">คะแนนสะสมและผลงานของเพื่อนในห้องนี้</p>
    </header>
    <GroupNav groupId={groupId} active="rankings" manage={manage} />
    <GroupRankings groupId={groupId} groupName={group.name} />
  </main>
}
