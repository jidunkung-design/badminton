import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { canManage } from '@/lib/roles'
import { openSession, toggleAttendance } from './actions'
import PlayClient from './PlayClient'
import type { SessionPlayer } from '@/domain/types'
import { ELO_BASE } from '@/domain/rating'

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { groupId } = await params
  const { error: actionError } = await searchParams
  const manage = await canManage(groupId)
  if (!manage) {
    return (
      <main className="screen">
        <h1>โหมดสนาม</h1>
        <div className="note gate">
          <em>สิทธิ์</em>
          เปิดให้เฉพาะหัวก๊วนกับแอดมิน สมาชิกดูผลได้แต่กดจัดคิวหรือแก้ผลไม่ได้
        </div>
      </main>
    )
  }

  const { sessionId, error } = await openSession(groupId)
  if (!sessionId) {
    return (
      <main className="screen">
        <h1>โหมดสนาม</h1>
        <div className="note err" role="alert"><em>ผิดพลาด</em>{error}</div>
      </main>
    )
  }

  const supabase = await createServerSupabase()
  const { data: rows } = await supabase
    .from('attendance')
    .select('player_id, players(id, name, skill)')
    .eq('session_id', sessionId)

  type AttendanceRow = { player_id: string; players: { id: string; name: string; skill: number } | null }
  const attendees = (rows ?? []) as unknown as AttendanceRow[]

  // Phase 3 seeds every attendee at the base rating. Phase 5 replaces this
  // read with season_standings computed from the match log.
  const players: SessionPlayer[] = attendees
    .filter(r => r.players !== null)
    .map(r => ({
      id: r.player_id,
      skill: r.players!.skill,
      elo: ELO_BASE,
      seasonGames: 0,
      gamesToday: 0,
      freeAtMin: 0,
    }))

  // Names live here, not in SessionPlayer: the domain layer is about numbers.
  const names: Record<string, string> = Object.fromEntries(
    attendees.filter(r => r.players !== null).map(r => [r.player_id, r.players!.name]),
  )
  const presentIds = new Set(attendees.filter(r => r.players !== null).map(r => r.player_id))

  // Full non-archived roster for the check-in list, independent of who is
  // already checked in today -- otherwise there would be no way to check
  // anyone new in.
  const { data: rosterRows } = await supabase
    .from('players')
    .select('id, name, skill')
    .eq('group_id', groupId)
    .is('archived_at', null)
    .order('name')
  const roster = rosterRows ?? []

  // Reading order matches the prototype's court-mode screen: courts, then
  // the queue with its confirm control, then free players (all inside
  // PlayClient), then check-in last -- so check-in renders after it here,
  // even though its data is fetched first above.
  const checkIn = (
    <div className="c">
      <h2 className="ch">เช็กชื่อวันนี้ ({presentIds.size} คน)</h2>
      <ul>
        {roster.map(p => {
          const present = presentIds.has(p.id)
          return (
            <li key={p.id}>
              <form
                action={async () => {
                  'use server'
                  const result = await toggleAttendance(groupId, sessionId, p.id, !present)
                  if (result.error) {
                    redirect(`/g/${groupId}/play?error=${encodeURIComponent(result.error)}`)
                  }
                }}
              >
                <button
                  type="submit"
                  className="r"
                  aria-pressed={present}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: 0 }}
                >
                  <div className={`tk ${present ? 'on' : ''}`} aria-hidden="true" />
                  <div className={`av ${present ? 'on' : ''}`}>{p.name.charAt(0)}</div>
                  <div className="gr">
                    <div className="nm">{p.name}</div>
                  </div>
                  <span className={`tg ${present ? 'court' : ''}`}>
                    {present ? `${p.name} · เช็กชื่อแล้ว (กดออก)` : `${p.name} · เช็กชื่อ`}
                  </span>
                </button>
              </form>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <main className="screen">
      <h1>โหมดสนาม</h1>

      {actionError && <div className="note err" role="alert"><em>ผิดพลาด</em>{actionError}</div>}

      {players.length < 4 ? (
        <div className="note gate">
          <em>ยังไม่พร้อม</em>
          เช็กชื่อแล้ว {players.length} คน ต้องมีอย่างน้อย 4 คนถึงจะจัดคิวได้
        </div>
      ) : (
        <PlayClient
          groupId={groupId}
          sessionId={sessionId}
          players={players}
          names={names}
          courtCount={2}
        />
      )}

      {checkIn}
    </main>
  )
}
