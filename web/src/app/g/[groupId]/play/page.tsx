import { createServerSupabase } from '@/lib/supabase/server'
import { canManage } from '@/lib/roles'
import { openSession } from './actions'
import PlayClient from './PlayClient'
import type { SessionPlayer } from '@/domain/types'
import { ELO_BASE } from '@/domain/rating'

export default async function PlayPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  if (!(await canManage(groupId))) {
    return (
      <main>
        <h1>โหมดสนาม</h1>
        <p>เปิดให้เฉพาะหัวก๊วนกับแอดมิน สมาชิกดูผลได้แต่กดจัดคิวหรือแก้ผลไม่ได้</p>
      </main>
    )
  }

  const { sessionId, error } = await openSession(groupId)
  if (!sessionId) return <main><h1>โหมดสนาม</h1><p role="alert">{error}</p></main>

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

  if (players.length < 4) {
    return (
      <main>
        <h1>โหมดสนาม</h1>
        <p>เช็กชื่อแล้ว {players.length} คน ต้องมีอย่างน้อย 4 คนถึงจะจัดคิวได้</p>
      </main>
    )
  }

  return (
    <main>
      <h1>โหมดสนาม</h1>
      <PlayClient
        groupId={groupId}
        sessionId={sessionId}
        players={players}
        names={names}
        courtCount={2}
      />
    </main>
  )
}
