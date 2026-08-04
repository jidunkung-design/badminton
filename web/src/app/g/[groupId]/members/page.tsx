import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { canManage } from '@/lib/roles'
import { addPlayer, archivePlayer } from './actions'

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { groupId } = await params
  const { error } = await searchParams
  const supabase = await createServerSupabase()
  const manage = await canManage(groupId)
  const { data: players } = await supabase
    .from('players')
    .select('id, name, skill, user_id, archived_at')
    .eq('group_id', groupId)
    .order('skill', { ascending: false })

  const active = (players ?? []).filter(p => !p.archived_at)
  const archived = (players ?? []).filter(p => p.archived_at)

  return (
    <main>
      <h1>สมาชิกก๊วน</h1>

      {error && <p role="alert">{error}</p>}

      <section>
        <h2>ยังเล่นอยู่ {active.length} คน</h2>
        <ul>
          {active.map(p => (
            <li key={p.id}>
              {p.name} · มือ {p.skill} · {p.user_id ? 'ผูกบัญชีแล้ว' : 'ยังไม่มีบัญชี'}
              {manage && (
                <form action={async (formData) => {
                  'use server'
                  const result = await archivePlayer(formData)
                  if (result.error) redirect(`/g/${groupId}/members?error=${encodeURIComponent(result.error)}`)
                }}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="playerId" value={p.id} />
                  <button type="submit" aria-label={`เก็บ ${p.name} เข้ากรุ`}>เก็บเข้ากรุ</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {archived.length > 0 && (
        <section>
          <h2>อยู่ในกรุ {archived.length} คน</h2>
          <p>ไม่ขึ้นหน้าเช็กชื่อและกระดานอันดับ แต่สถิติยังอยู่ครบ</p>
          <ul>{archived.map(p => <li key={p.id}>{p.name}</li>)}</ul>
        </section>
      )}

      {manage ? (
        <form action={async (formData) => {
          'use server'
          const result = await addPlayer(formData)
          if (result.error) redirect(`/g/${groupId}/members?error=${encodeURIComponent(result.error)}`)
        }}>
          <input type="hidden" name="groupId" value={groupId} />
          <label htmlFor="name">ชื่อ</label>
          <input id="name" name="name" required />
          <label htmlFor="skill">มือ</label>
          <input id="skill" name="skill" type="number" min={1} max={7} defaultValue={3} />
          <button type="submit">เพิ่มสมาชิก</button>
        </form>
      ) : (
        <p>สมาชิกทั่วไปดูรายชื่อได้ แต่แก้ไขไม่ได้</p>
      )}
    </main>
  )
}
