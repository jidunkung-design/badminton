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
    <main className="screen">
      <h1>สมาชิกก๊วน</h1>

      {error && <div className="note err" role="alert"><em>ผิดพลาด</em>{error}</div>}

      <div className="c">
        <h2 className="ch">ยังเล่นอยู่ {active.length} คน</h2>
        <ul>
          {active.map(p => (
            <li key={p.id} className="r">
              <div className="av">{p.name.charAt(0)}</div>
              <div className="gr">
                <div className="nm">{p.name}</div>
                <div className="mt">มือ {p.skill} · {p.user_id ? 'ผูกบัญชีแล้ว' : 'ยังไม่มีบัญชี'}</div>
              </div>
              {manage && (
                <form action={async (formData) => {
                  'use server'
                  const result = await archivePlayer(formData)
                  if (result.error) redirect(`/g/${groupId}/members?error=${encodeURIComponent(result.error)}`)
                }}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="playerId" value={p.id} />
                  <button type="submit" className="b gh s" aria-label={`เก็บ ${p.name} เข้ากรุ`}>เก็บเข้ากรุ</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>

      {archived.length > 0 && (
        <div className="c">
          <h2 className="ch">อยู่ในกรุ {archived.length} คน</h2>
          <ul>
            {archived.map(p => (
              <li key={p.id} className="r">
                <div className="av" style={{ opacity: 0.55 }}>{p.name.charAt(0)}</div>
                <div className="gr">
                  <div className="nm" style={{ color: 'var(--ink-2)' }}>{p.name}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt" style={{ marginTop: 10 }}>ไม่ขึ้นหน้าเช็กชื่อและกระดานอันดับ แต่สถิติยังอยู่ครบ</p>
        </div>
      )}

      {manage ? (
        <form
          className="c screen"
          action={async (formData) => {
            'use server'
            const result = await addPlayer(formData)
            if (result.error) redirect(`/g/${groupId}/members?error=${encodeURIComponent(result.error)}`)
          }}
        >
          <input type="hidden" name="groupId" value={groupId} />
          <label htmlFor="name" className="fg">
            <span>ชื่อ</span>
            <input id="name" name="name" required className="in" />
          </label>
          <label htmlFor="skill" className="fg">
            <span>มือ</span>
            <input id="skill" name="skill" type="number" min={1} max={7} defaultValue={3} className="in" />
          </label>
          <button type="submit" className="b">เพิ่มสมาชิก</button>
        </form>
      ) : (
        <div className="note gate">
          <em>สิทธิ์</em>
          สมาชิกทั่วไปดูรายชื่อได้ แต่แก้ไขไม่ได้
        </div>
      )}
    </main>
  )
}
