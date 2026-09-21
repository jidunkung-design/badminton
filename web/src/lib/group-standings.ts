import { ELO_BASE, eloDelta, streakMultiplier, streakRosterKey, type RatingChange } from '@/domain/rating'
import type { PlayerGender } from '@/domain/types'
import { createServerSupabase } from '@/lib/supabase/server'

interface GroupPlayer {
  id: string
  name: string
  skill: number
  gender?: PlayerGender
  archived_at: string | null
}

export interface GroupStanding extends GroupPlayer {
  elo: number
  winStreak: number
  seasonGames: number
  wins: number
  losses: number
  draws: number
  gamesToday: number
}

interface MatchLog {
  id: string
  started_at: string
  winner_team: number | null
  streak_roster?: string[] | null
  sessions: { played_on: string }
  match_players: { player_id: string; team: number }[]
}

/** Replay one room's season, including archived opponents, before filtering its leaderboard. */
export function replayStandings(
  roster: GroupPlayer[], matches: MatchLog[], playedOn?: string,
  capture?: { matchId: string; changes: RatingChange[] },
  currentRoster?: string[],
): GroupStanding[] {
  const players = new Map(roster.map(player => [player.id, {
    ...player, elo: ELO_BASE, winStreak: 0, seasonGames: 0, wins: 0, losses: 0, draws: 0, gamesToday: 0,
  }]))
  // Date.parse keeps milliseconds; PostgreSQL orders the remaining three microsecond digits too.
  const microseconds = (timestamp: string) => Number((timestamp.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6))
  const ordered = [...matches].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)
    || microseconds(a.started_at) - microseconds(b.started_at) || a.id.localeCompare(b.id))
  let previousRoster: string | null = null
  for (const match of ordered) {
    const team = (number: number) => match.match_players.filter(player => player.team === number)
      .map(player => players.get(player.player_id))
    const a = team(1)
    const b = team(2)
    if (![0, 1, 2].includes(match.winner_team ?? -1) || a.length !== 2 || b.length !== 2
      || match.match_players.length !== 4 || new Set(match.match_players.map(player => player.player_id)).size !== 4
      || [...a, ...b].some(player => !player)) {
      throw new Error('ประวัติแมตช์ไม่ครบ จึงยังคำนวณอันดับไม่ได้')
    }
    const snapshot = streakRosterKey(match.streak_roster)
    if (snapshot === null || snapshot !== previousRoster) {
      for (const player of players.values()) player.winStreak = 0
    }
    previousRoster = snapshot
    const average = (team: typeof a) => (team[0]!.elo + team[1]!.elo) / 2
    const before = capture?.matchId === match.id
      ? [...a, ...b].map(player => ({ id: player!.id, before: player!.elo })) : null
    if (match.winner_team === 0) {
      const delta = eloDelta(average(a), average(b), 0.5)
      for (const [team, change] of [[a, delta], [b, -delta]] as const) {
        for (const player of team) {
          player!.elo += change
          player!.winStreak = 0
          player!.draws++
        }
      }
    } else {
      const winners = match.winner_team === 1 ? a : b
      const losers = match.winner_team === 1 ? b : a
      const delta = eloDelta(average(winners), average(losers))
      for (const player of winners) {
        player!.winStreak++
        player!.elo += delta * streakMultiplier(player!.winStreak)
        player!.wins++
      }
      for (const player of losers) {
        player!.elo -= delta
        player!.winStreak = 0
        player!.losses++
      }
    }
    for (const player of [...a, ...b]) {
      player!.seasonGames++
      if (match.sessions.played_on === playedOn) player!.gamesToday++
    }
    if (before && capture) capture.changes = before.map(change => {
      const player = players.get(change.id)!
      return { ...change, after: player.elo, winStreak: player.winStreak, multiplier: streakMultiplier(player.winStreak) }
    })
  }
  if (currentRoster !== undefined && (previousRoster === null || streakRosterKey(currentRoster) !== previousRoster)) {
    for (const player of players.values()) player.winStreak = 0
  }
  return [...players.values()].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name, 'th'))
}

export async function getGroupStandings(groupId: string, playedOn?: string, targetMatchId?: string): Promise<{
  season: { id: string; name: string } | null
  players: GroupStanding[]
  error: string | null
  ratingChanges?: RatingChange[]
}> {
  const supabase = await createServerSupabase()
  const [seasonResult, rosterResult] = await Promise.all([
    supabase.from('seasons').select('id, name').eq('group_id', groupId).is('ended_at', null).maybeSingle(),
    supabase.from('players').select('id, name, skill, gender, archived_at').eq('group_id', groupId),
  ])
  if (seasonResult.error || rosterResult.error) return { season: null, players: [], error: 'โหลดข้อมูลอันดับไม่สำเร็จ กรุณาลองใหม่' }
  const season = seasonResult.data
  const matches: MatchLog[] = []
  if (season) {
    // One season can exceed PostgREST's row limit; every page has a stable ordering.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('matches')
        .select('id, started_at, winner_team, streak_roster, sessions!inner(season_id, played_on), match_players(player_id, team)')
        .eq('group_id', groupId).eq('sessions.season_id', season.id)
        .not('ended_at', 'is', null).in('winner_team', [0, 1, 2])
        .order('started_at').order('id').range(offset, offset + 499)
      if (error) return { season, players: [], error: 'โหลดประวัติเพื่อคำนวณอันดับไม่สำเร็จ กรุณาลองใหม่' }
      matches.push(...(data ?? []))
      if ((data?.length ?? 0) < 500) break
    }
  }
  let currentRoster: string[] | undefined = playedOn ? [] : undefined
  if (playedOn && season) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('attendance')
        .select('player_id, sessions!inner(group_id, season_id, played_on)')
        .eq('sessions.group_id', groupId).eq('sessions.season_id', season.id).eq('sessions.played_on', playedOn)
        .order('session_id').order('player_id').range(offset, offset + 499)
      if (error) return { season, players: [], error: 'โหลดรายชื่อวันนี้เพื่อคำนวณชนะต่อเนื่องไม่สำเร็จ กรุณาลองใหม่' }
      currentRoster!.push(...(data ?? []).map(row => row.player_id))
      if ((data?.length ?? 0) < 500) break
    }
    if (!currentRoster!.length) {
      const { data, error } = await supabase.from('sessions').select('id')
        .eq('group_id', groupId).eq('season_id', season.id).eq('played_on', playedOn).limit(1)
      if (error) return { season, players: [], error: 'ตรวจสอบวันเล่นปัจจุบันไม่สำเร็จ กรุณาลองใหม่' }
      if (!data?.length) currentRoster = undefined
    }
  }
  try {
    const capture = targetMatchId ? { matchId: targetMatchId, changes: [] as RatingChange[] } : undefined
    const roster: GroupPlayer[] = (rosterResult.data ?? []).map(player => ({ ...player,
      gender: player.gender === 'male' || player.gender === 'female' ? player.gender : 'unspecified',
    }))
    const players = replayStandings(roster, matches, playedOn, capture, currentRoster)
    return { season, players, error: null, ratingChanges: capture?.changes }
  } catch {
    return { season, players: [], error: 'ประวัติแมตช์ไม่ครบ จึงยังคำนวณอันดับไม่ได้ กรุณาให้หัวก๊วนตรวจสอบ' }
  }
}
