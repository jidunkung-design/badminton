import { Button } from '@heroui/react'
import { ActionForm } from '@/components/action-form'
import { GroupNav } from '@/components/group-nav'
import { createServerSupabase } from '@/lib/supabase/server'
import { canManage } from '@/lib/roles'
import { openSession, toggleAttendance } from './actions'
import PlayClient from './PlayClient'
import type { Court, SessionPlayer } from '@/domain/types'
import { getGroupStandings } from '@/lib/group-standings'
import { getGroupMascots } from '@/lib/group-mascots'

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const snapshotStartedAt = new Date().toISOString()
  const { groupId } = await params
  const { error: actionError } = await searchParams
  const manage = await canManage(groupId)
  if (!manage) {
    return (
      <main className="space-y-8 py-4 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">สนามและคิว</h1>
        <div className="rounded-2xl bg-surface p-6 text-muted">
          เปิดให้เฉพาะหัวก๊วนกับแอดมิน สมาชิกดูผลได้แต่กดจัดคิวหรือแก้ผลไม่ได้
        </div>
      </main>
    )
  }

  const { sessionId, error } = await openSession(groupId)
  if (!sessionId) {
    return (
      <main className="space-y-8 py-4 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">สนามและคิว</h1>
        <div className="rounded-2xl bg-danger/10 p-4 text-danger" role="alert">{error}</div>
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

  const { data: session } = await supabase.from('sessions').select('played_on, season_id, rotation_mode')
    .eq('id', sessionId).eq('group_id', groupId).maybeSingle()
  const [standings, mascots, durationResult, courtResult, activeResult] = await Promise.all([
    getGroupStandings(groupId, session?.played_on), getGroupMascots(groupId),
    supabase.rpc('get_player_durations', { p_group_id: groupId }),
    supabase.from('session_courts').select('court_no, starts_at, ends_at, retained_pair, retained_match_id').eq('session_id', sessionId).order('court_no'),
    supabase.from('active_court_matches').select('client_id, court_no, team_a, team_b, started_at, mode, balance_weight, rotation_mode').eq('session_id', sessionId),
  ])
  if (!session || standings.error || durationResult.error || courtResult.error || activeResult.error || session.season_id !== standings.season?.id) {
    return (
      <main className="space-y-8 py-4 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">สนามและคิว</h1>
        <GroupNav groupId={groupId} active="play" manage={manage} />
        <p role="alert" className="rounded-2xl bg-danger/10 p-4 text-danger">{standings.error ?? (durationResult.error || courtResult.error || activeResult.error ? 'โหลดสนามและประวัติเวลาไม่สำเร็จ กรุณาลองใหม่' : 'วันเล่นนี้ไม่ได้อยู่ในซีซั่นปัจจุบัน กรุณาให้หัวก๊วนตรวจสอบ')}</p>
      </main>
    )
  }
  const ratingById = new Map(standings.players.map(player => [player.id, player]))
  const durations = new Map((durationResult.data ?? []).map(row => [row.player_id, row]))
  const activeIds = new Set([...(activeResult.data ?? []).flatMap(row => [...row.team_a, ...row.team_b]), ...(courtResult.data ?? []).flatMap(row => row.retained_pair ?? [])])
  const presentIds = new Set(attendees.filter(r => r.players !== null).map(r => r.player_id))
  const players: SessionPlayer[] = standings.players
    .filter(player => presentIds.has(player.id) || activeIds.has(player.id))
    .map(standing => {
      const timing = durations.get(standing.id)
      return {
        id: standing.id,
        skill: standing.skill,
        gender: standing.gender ?? 'unspecified',
        elo: standing.elo,
        winStreak: standing.winStreak,
        seasonGames: standing.seasonGames,
        gamesToday: standing.gamesToday,
        freeAtMin: 0,
        averageMinutes: timing?.average_minutes,
        timedGames: timing?.timed_games ?? 0,
      }
    })

  // Names live here, not in SessionPlayer: the domain layer is about numbers.
  const names: Record<string, string> = Object.fromEntries(
    standings.players.map(player => [player.id, player.name]),
  )
  const courts: Court[] = (courtResult.data ?? []).map(row => {
    const active = activeResult.data?.find(match => match.court_no === row.court_no)
    const average = (ids: string[]) => ids.reduce((total, id) => total + (ratingById.get(id)?.elo ?? 1000), 0) / ids.length
    return {
      no: row.court_no, startsAt: row.starts_at, endsAt: row.ends_at,
      mode: active?.mode, balanceWeight: active?.balance_weight,
      rotationMode: active?.rotation_mode as Court['rotationMode'],
      retainedPair: row.retained_pair as [string, string] | null, retainedFromMatchId: row.retained_match_id,
      startedAt: active?.started_at ?? null,
      startedAtMin: active ? (Date.parse(active.started_at) - Date.parse(`${session.played_on}T00:00:00+07:00`)) / 60_000 : null,
      match: active ? {
        id: active.client_id, teamA: active.team_a as [string, string], teamB: active.team_b as [string, string],
        gap: Math.round(Math.abs(average(active.team_a) - average(active.team_b))), locked: true,
      } : null,
    }
  })

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

  const checkIn = (
    <section className="rounded-3xl border border-foreground/10 bg-surface p-5 sm:p-7">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">เช็กชื่อวันนี้</h2>
        <p className="text-sm text-muted">มาแล้ว {presentIds.size} จาก {roster.length} คน</p>
      </div>
      {roster.length === 0 && <p className="py-6 text-muted">ยังไม่มีรายชื่อ เพิ่มเพื่อนร่วมก๊วนได้ที่เมนูสมาชิก</p>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roster.map(p => {
          const present = presentIds.has(p.id)
          return (
            <li key={p.id}>
              <ActionForm successMessage={`${present ? 'นำออกจากรายชื่อวันนี้แล้ว' : 'เช็กชื่อแล้ว'} · ${p.name}`} action={async () => {
                'use server'
                return toggleAttendance(groupId, sessionId, p.id, !present)
              }}>
                <Button type="submit" variant={present ? 'secondary' : 'outline'} fullWidth
                  className="h-auto min-h-18 justify-start rounded-2xl px-4 py-3 text-left"
                  aria-pressed={present} aria-label={`${p.name} · ${present ? 'เช็กชื่อแล้ว กดนำออก' : 'เช็กชื่อ'}`}>
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${present ? 'bg-accent text-accent-foreground' : 'bg-foreground/5 text-foreground'}`}>{p.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1 whitespace-normal break-words">
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-xs font-normal text-muted">{present ? 'เช็กชื่อแล้ว · กดเพื่อนำออก' : `มือ ${p.skill} · กดเพื่อเช็กชื่อ`}</span>
                  </span>
                  {present && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
                </Button>
              </ActionForm>
            </li>
          )
        })}
      </ul>
    </section>
  )

  return (
    <main className="space-y-8 py-4 sm:py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">สนามและคิว</h1>
        <p className="mt-3 text-muted">เช็กชื่อ จัดคู่ แล้วส่งลงสนาม</p>
        <p className="mt-2 text-sm text-muted">🔥 เทียบคนที่เช็กชื่อทั้งวัน สลับคู่ได้โดยไม่รีเซ็ต แต่ถ้ารายชื่อคนมาเล่นเปลี่ยนจะเริ่ม streak ใหม่</p>
      </header>
      <GroupNav groupId={groupId} active="play" manage={manage} />
      {actionError && <div className="rounded-2xl bg-danger/10 p-4 text-danger" role="alert">{actionError}</div>}
      {presentIds.size < 4 && (
        <div className="rounded-2xl bg-accent/10 px-6 py-5">
          <h2 className="font-semibold">อีก {4 - presentIds.size} คนก็เริ่มจัดคู่ได้</h2>
          <p className="mt-2 text-sm text-muted">เช็กชื่อแล้ว {presentIds.size} คน ต้องมีอย่างน้อย 4 คนสำหรับเกมประเภทคู่</p>
        </div>
      )}
      <PlayClient key={sessionId} groupId={groupId} sessionId={sessionId} players={players} attendingIds={[...presentIds]} names={names} mascots={mascots} courts={courts} rotationMode={session.rotation_mode === 'winner_stays' ? 'winner_stays' : 'all_out'} playedOn={session.played_on} initialNow={snapshotStartedAt} />
      {checkIn}
    </main>
  )
}
