import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))

import { replayStandings } from '@/lib/group-standings'
import { eloDelta, type RatingChange } from '@/domain/rating'
import { finishMatch, type SessionState } from '@/domain/queue'
import { matchRatings, type DemoMatch } from '@/app/preview/scoring'

const roster = ['a', 'b', 'c', 'd', 'rest'].map(id => ({ id, name: id, skill: 3, archived_at: id === 'd' ? '2026-09-01' : null }))
const match = (id: string, started_at: string, winner_team: number, played_on = '2026-09-17') => ({
  id, started_at, winner_team, sessions: { played_on }, streak_roster: ['a', 'b', 'c', 'd'] as string[] | null,
  match_players: roster.slice(0, 4).map((p, index) => ({ player_id: p.id, team: index < 2 ? 1 : 2 })),
})

describe('room season standings', () => {
  it('resets every streak at a changed immutable roster, never revives an older roster, and retains Elo', () => {
    const allPlayers = [...roster, { id: 'f', name: 'f', skill: 3, archived_at: null }]
    const weeks = [
      { snapshot: ['a', 'b', 'c', 'd'], sides: [['a', 'd'], ['b', 'c']], winner: 1 },
      { snapshot: ['d', 'c', 'b', 'a'], sides: [['b', 'c'], ['a', 'd']], winner: 2 },
      { snapshot: ['a', 'b', 'c', 'f'], sides: [['a', 'b'], ['c', 'f']], winner: 1 },
      { snapshot: ['a', 'b', 'c', 'd'], sides: [['a', 'b'], ['c', 'd']], winner: 1 },
      { snapshot: ['a', 'b', 'c', 'd'], sides: [['a', 'b'], ['c', 'd']], winner: 1 },
    ]
    const log = weeks.map((week, i) => ({
      ...match(String(i), new Date(Date.UTC(2026, 8, 1 + i * 7)).toISOString(), week.winner),
      streak_roster: week.snapshot,
      match_players: week.sides.flatMap((side, team) => side.map(player_id => ({ player_id, team: team + 1 }))),
    }))
    const originalLog = structuredClone(log)
    const expectedStreaks = [1, 2, 1, 1, 2]
    for (let i = 0; i < log.length; i++) {
      const standing = replayStandings(allPlayers, log.slice(0, i + 1))
      expect(standing.find(player => player.id === 'a')!.winStreak).toBe(expectedStreaks[i])
      if (i === 2) {
        expect(standing.find(player => player.id === 'd')!.winStreak).toBe(0)
        const previous = replayStandings(allPlayers, log.slice(0, i))
        const priorElo = (id: string) => previous.find(player => player.id === id)!.elo
        const delta = eloDelta((priorElo('a') + priorElo('b')) / 2, (priorElo('c') + priorElo('f')) / 2)
        expect(standing.find(player => player.id === 'a')!.elo).toBe(priorElo('a') + delta)
        expect(standing.find(player => player.id === 'd')!.elo).toBe(priorElo('d'))
      }
    }
    const capture = { matchId: '1', changes: [] as RatingChange[] }
    replayStandings(allPlayers, log, undefined, capture)
    expect(capture.changes.find(player => player.id === 'a')).toMatchObject({ winStreak: 2, multiplier: 1.1 })
    expect(log).toEqual(originalLog)
  })

  it('treats unknown legacy snapshots as boundaries instead of inferring old attendance', () => {
    const log = [1, 2, 3, 4, 5].map(i => match(String(i), `2026-09-17T12:0${i}:00Z`, 1))
    log[2].streak_roster = null
    expect(replayStandings(roster, log.slice(0, 3)).find(player => player.id === 'a')!.winStreak).toBe(1)
    expect(replayStandings(roster, log.slice(0, 4)).find(player => player.id === 'a')!.winStreak).toBe(1)
    expect(replayStandings(roster, log).find(player => player.id === 'a')!.winStreak).toBe(2)
    const missing = { ...log[3], streak_roster: undefined }
    expect(replayStandings(roster, [...log.slice(0, 3), missing]).find(player => player.id === 'a')!.winStreak).toBe(1)
  })

  it('resets only current streak display when today’s attendance changes, preserving Elo and captured history', () => {
    const log = [1, 2].map(i => match(String(i), `2026-09-17T12:0${i}:00Z`, 1))
    const previous = replayStandings(roster, log)
    const same = replayStandings(roster, log, undefined, undefined, ['d', 'c', 'b', 'a', 'a'])
    expect(same).toEqual(previous)
    expect(replayStandings(roster, log, undefined, undefined, undefined)).toEqual(previous)
    for (const currentRoster of [['a', 'b', 'c', 'rest'], []]) {
      const capture = { matchId: '2', changes: [] as RatingChange[] }
      const current = replayStandings(roster, log, undefined, capture, currentRoster)
      expect(current.every(player => player.winStreak === 0)).toBe(true)
      expect(current.map(player => player.elo)).toEqual(previous.map(player => player.elo))
      expect(capture.changes.find(player => player.id === 'a')).toMatchObject({ winStreak: 2, multiplier: 1.1 })
    }
  })

  it('replays chronologically with the domain Elo formula and counts the requested day only', () => {
    const log = [match('later', '2026-09-17T12:00:00Z', 1), match('earlier', '2026-09-16T12:00:00Z', 1, '2026-09-16')]
    const rows = replayStandings(roster, log, '2026-09-17')
    const winner = rows.find(p => p.id === 'a')!
    expect(winner.elo).toBeCloseTo(1016 + eloDelta(1016, 984) * 1.1)
    expect(winner).toMatchObject({ seasonGames: 2, wins: 2, losses: 0, gamesToday: 1, winStreak: 2 })
    expect(rows.find(p => p.id === 'd')).toMatchObject({ seasonGames: 2, wins: 0, losses: 2, gamesToday: 1, archived_at: '2026-09-01' })
    expect(rows.find(p => p.id === 'rest')).toMatchObject({ elo: 1000, seasonGames: 0, gamesToday: 0 })
    expect(log[0].id).toBe('later')
    expect(replayStandings(roster, [], '2026-09-17').every(p => p.elo === 1000 && p.seasonGames === 0)).toBe(true)
  })

  it('breaks timestamp ties by match id and never carries ratings between rooms', () => {
    const when = '2026-09-17T12:00:00Z'
    const roomOne = replayStandings(roster, [match('b', when, 2), match('a', when, 1)])
    expect(roomOne.find(p => p.id === 'a')!.elo).toBeCloseTo(1016 - eloDelta(984, 1016))
    const otherRoster = roster.map(p => ({ ...p, id: `other-${p.id}` }))
    expect(replayStandings(otherRoster, []).every(p => p.elo === 1000 && p.winStreak === 0)).toBe(true)
  })

  it('orders PostgreSQL microseconds before the match-id tie-breaker', () => {
    for (const later of ['2026-09-17T12:00:00.123900Z', '2026-09-17T19:00:00.1239+07:00']) {
      const rows = replayStandings(roster, [
        match('a', later, 2),
        match('z', '2026-09-17T12:00:00.123100Z', 1),
      ])
      expect(rows.find(player => player.id === 'a')).toMatchObject({
        winStreak: 0, elo: 1016 - eloDelta(984, 1016),
      })
      expect(rows.find(player => player.id === 'c')).toMatchObject({
        winStreak: 1, elo: 984 + eloDelta(984, 1016),
      })
    }
  })

  it('counts draws, adjusts unequal Elo without streak bonuses, and resets both streaks', () => {
    const wins = [1, 2].map(i => match(String(i), `2026-09-17T12:0${i}:00Z`, 1))
    const previous = replayStandings(roster, wins)
    const capture = { matchId: 'draw', changes: [] as RatingChange[] }
    const rows = replayStandings(roster, [...wins, match('draw', '2026-09-17T12:03:00Z', 0)], '2026-09-17', capture)
    const a = rows.find(p => p.id === 'a')!
    const c = rows.find(p => p.id === 'c')!
    expect(a.elo).toBeLessThan(previous.find(p => p.id === 'a')!.elo)
    expect(c.elo).toBeGreaterThan(previous.find(p => p.id === 'c')!.elo)
    expect(a).toMatchObject({ wins: 2, losses: 0, draws: 1, winStreak: 0, seasonGames: 3, gamesToday: 3 })
    expect(c).toMatchObject({ wins: 0, losses: 2, draws: 1, winStreak: 0 })
    expect(capture.changes).toHaveLength(4)
    expect(capture.changes.every(p => p.multiplier === 1)).toBe(true)
    const change = (id: string) => capture.changes.find(p => p.id === id)!
    expect(change('a').after - change('a').before).toBeCloseTo(-(change('c').after - change('c').before))
    expect(replayStandings(roster, [match('equal', '2026-09-17T12:00:00Z', 0)]).every(p => p.elo === 1000)).toBe(true)
    expect(() => replayStandings(roster, [{ ...wins[0], winner_team: null }])).toThrow('ประวัติแมตช์ไม่ครบ')
  })

  it('refuses malformed or cross-room player references instead of returning partial ratings', () => {
    const invalid = match('broken', '2026-09-17T12:00:00Z', 1)
    invalid.match_players[0].player_id = 'another-room-player'
    expect(() => replayStandings(roster, [invalid])).toThrow('ประวัติแมตช์ไม่ครบ')
    invalid.match_players = invalid.match_players.slice(1)
    expect(() => replayStandings(roster, [invalid])).toThrow('ประวัติแมตช์ไม่ครบ')
  })

  it('captures the requested match before later results while retaining current standings', () => {
    const log = [1, 2, 3].map(i => match(String(i), `2026-09-17T12:0${i}:00Z`, 1))
    const capture = { matchId: '2', changes: [] as RatingChange[] }
    const current = replayStandings(roster, log, undefined, capture)
    expect(capture.changes).toHaveLength(4)
    const winner = capture.changes.find(p => p.id === 'a')!
    expect(winner).toMatchObject({ before: 1016, winStreak: 2, multiplier: 1.1 })
    expect(winner.after).toBeCloseTo(1016 + eloDelta(1016, 984) * 1.1)
    expect(current.find(p => p.id === 'a')!.elo).toBeGreaterThan(winner.after)
    expect(capture.changes.find(p => p.id === 'd')).toMatchObject({ winStreak: 0, multiplier: 1 })
  })

  it('keeps live, room replay, and demo Elo/streaks identical through the cap, a loss, and a timed draw', () => {
    let state: SessionState = {
      clockMin: 0, courts: [{ no: 1, match: null, startedAtMin: null }], queue: [], mode: 'manual',
      players: roster.map(p => ({ ...p, elo: 1000, seasonGames: 0, gamesToday: 0, freeAtMin: 0 })),
      balanceWeight: 0.5, rejected: new Set(), lastTeamedAt: {}, playedCount: 0,
    }
    const log: ReturnType<typeof match>[] = []
    const demo: DemoMatch[] = []
    for (let i = 0; i < 8; i++) {
      const winner = i === 7 ? 'draw' : i === 6 ? 'B' : 'A'
      state.courts[0] = { no: 1, startedAtMin: 0, match: { id: String(i), teamA: ['a', 'b'], teamB: ['c', 'd'], gap: 0, locked: true } }
      state = finishMatch(state, 0, winner, () => 'unused')
      log.push(match(String(i), `2026-09-17T12:0${i}:00Z`, winner === 'draw' ? 0 : winner === 'A' ? 1 : 2))
      demo.push({ id: i, result: winner, date: '2026-09-17', target: 21, a: ['a', 'b'], b: ['c', 'd'], scoreA: winner === 'A' ? 21 : 18, scoreB: winner === 'B' ? 21 : 18, streakRoster: ['a', 'b', 'c', 'd'] })
      const standings = replayStandings(roster, log, '2026-09-17')
      const preview = matchRatings(demo)
      for (const player of state.players) {
        const standing = standings.find(p => p.id === player.id)!
        expect(standing.elo).toBeCloseTo(player.elo)
        expect(standing.winStreak).toBe(player.winStreak ?? 0)
        expect(preview.ratings[player.id] ?? 1000).toBeCloseTo(player.elo)
        expect(preview.winStreaks[player.id] ?? 0).toBe(player.winStreak ?? 0)
      }
    }
    expect(state.players.find(p => p.id === 'a')!.winStreak).toBe(0)
    expect(state.players.find(p => p.id === 'd')!.winStreak).toBe(0)
  })
})
