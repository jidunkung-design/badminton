import { describe, it, expect } from 'vitest'
import type { SessionPlayer, SessionState } from '@/domain/queue'
import { MATCH_MINUTES, freePlayers, refillQueue, sendToCourt, finishMatch, syncSessionPlayers, syncSessionCourts, releaseRetainedPair } from '@/domain/queue'
import { eloDelta } from '@/domain/rating'

let counter = 0
const nextId = () => `e${++counter}`

function makeState(n: number, courts: number): SessionState {
  const players: SessionPlayer[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    skill: 3,
    elo: 950 + i * 20,
    seasonGames: 30,
    gamesToday: 0,
    freeAtMin: 0,
  }))
  return {
    clockMin: 0,
    courts: Array.from({ length: courts }, (_, i) => ({ no: i + 1, match: null, startedAtMin: null })),
    queue: [],
    players,
    mode: 'mix',
    balanceWeight: 0.5,
    rejected: new Set(),
    lastTeamedAt: {},
    playedCount: 0,
  }
}

describe('refillQueue', () => {
  it('balances challenger composition while preserving the winning pair and longest-waiting challenger', () => {
    const state = makeState(6, 1)
    state.mode = 'balance'
    state.players = state.players.map((p, i) => ({ ...p, elo: 1000, gender: i === 2 || i === 3 ? 'female' : 'male' }))
    state.courts[0].retainedPair = ['p1', 'p2']
    const balanced = refillQueue(state, nextId).queue[0]
    expect(balanced.teamA).toEqual(['p1', 'p2'])
    expect(balanced.teamB).toEqual(['p3', 'p5'])
    expect(balanced.courtNo).toBe(1)
    const fair = refillQueue({ ...state, mode: 'fair' }, nextId).queue[0]
    expect(fair.teamB).toEqual(['p3', 'p4'])
    expect(state.players.every(p => p.elo === 1000)).toBe(true)
  })

  it('expires closed-court holds and frees challengers while upcoming courts reserve only their winners', () => {
    const initial = makeState(6, 2)
    initial.nowMs = Date.parse('2026-09-17T19:00:00+07:00')
    initial.courts[0] = { ...initial.courts[0], startsAt: '2026-09-17T18:00:00+07:00', endsAt: '2026-09-17T19:00:00+07:00', retainedPair: ['p1', 'p2'], retainedFromMatchId: 'expired' }
    initial.courts[1] = { ...initial.courts[1], startsAt: '2026-09-17T18:00:00+07:00', endsAt: '2026-09-17T21:00:00+07:00' }
    initial.queue = [{ id: 'old-challenge', courtNo: 1, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], locked: true, gap: 0 }]
    const expired = refillQueue(initial, nextId)
    expect(expired.courts[0].retainedPair).toBeNull()
    expect(expired.queue).toHaveLength(1)
    expect(expired.queue[0].courtNo).toBeUndefined()
    expect(sendToCourt(expired, 0, nextId, { startedAt: '2026-09-17T19:00:00+07:00', courtNo: 2 }).courts[1].match).not.toBeNull()
    initial.courts[0] = { ...initial.courts[0], startsAt: '2026-09-17T20:00:00+07:00', endsAt: '2026-09-17T21:00:00+07:00' }
    const upcoming = refillQueue(initial, nextId)
    expect(upcoming.courts[0].retainedPair).toEqual(['p1', 'p2'])
    expect(upcoming.queue).toHaveLength(1)
    expect(upcoming.queue[0].courtNo).toBeUndefined()
    expect([...upcoming.queue[0].teamA, ...upcoming.queue[0].teamB].sort()).toEqual(['p3', 'p4', 'p5', 'p6'])
  })

  it('fills to court count plus one', () => {
    const s = refillQueue(makeState(12, 2), nextId)
    expect(s.queue).toHaveLength(3)
  })

  it('never puts the same player in two queued entries', () => {
    const s = refillQueue(makeState(12, 2), nextId)
    const ids = s.queue.flatMap(e => [...e.teamA, ...e.teamB])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps locked entries and rebuilds the rest', () => {
    const s = refillQueue(makeState(12, 2), nextId)
    const locked = { ...s.queue[0], locked: true }
    const after = refillQueue({ ...s, queue: [locked] }, nextId)
    expect(after.queue[0].id).toBe(locked.id)
  })

  it('does nothing in manual mode', () => {
    const s = refillQueue({ ...makeState(12, 2), mode: 'manual' }, nextId)
    expect(s.queue).toHaveLength(0)
  })
})

describe('sendToCourt', () => {
  it('chooses an open booked court using the server timestamp and refuses a closed selected court', () => {
    const before = refillQueue(makeState(12, 2), nextId)
    before.courts[0] = { ...before.courts[0], startsAt: '2026-09-17T19:00:00+07:00', endsAt: '2026-09-17T20:00:00+07:00' }
    before.courts[1] = { ...before.courts[1], startsAt: '2026-09-17T18:00:00+07:00', endsAt: '2026-09-17T20:00:00+07:00' }
    const startedAt = '2026-09-17T18:15:00+07:00'
    const after = sendToCourt(before, 0, nextId, { startedAt, nowMin: 15 })
    expect(after.courts[0].match).toBeNull()
    expect(after.courts[1]).toMatchObject({ match: before.queue[0], startedAt, startedAtMin: 15 })
    expect(after.clockMin).toBe(15)
    expect(sendToCourt(before, 0, nextId, { courtNo: 1, startedAt })).toBe(before)
    expect(sendToCourt(before, 0, nextId, { courtNo: 2, startedAt: '2026-09-17T20:00:00+07:00' })).toBe(before)
    expect(sendToCourt(before, 0, nextId, { startedAt: 'invalid' })).toBe(before)
    expect(sendToCourt(before, 0, nextId)).toBe(before)
  })

  it('moves the entry onto the first free court', () => {
    const s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    expect(s.courts[0].match).not.toBeNull()
    expect(s.courts[0].startedAtMin).toBe(0)
  })

  it('refuses when every court is busy', () => {
    let s = refillQueue(makeState(12, 1), nextId)
    s = sendToCourt(s, 0, nextId)
    const before = s.queue.length
    s = sendToCourt(s, 0, nextId)
    expect(s.queue).toHaveLength(before)
  })
})

describe('finishMatch', () => {
  it('draws use signed half-point Elo, reset streaks, count games, and retain nobody', () => {
    const before = makeState(4, 1)
    before.mode = 'manual'
    before.rotationMode = 'winner_stays'
    before.players = before.players.map((p, index) => ({ ...p, elo: index < 2 ? 900 : 1200, winStreak: 5 }))
    before.courts[0].match = { id: 'draw', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], gap: 600, locked: true }
    const after = finishMatch(before, 0, 'draw', nextId)
    expect(after.players[0].elo).toBe(900 + eloDelta(900, 1200, 0.5))
    expect(after.players[2].elo).toBe(1200 - eloDelta(900, 1200, 0.5))
    expect(after.players.every(p => p.winStreak === 0 && p.gamesToday === 1 && p.seasonGames === 31)).toBe(true)
    expect(after.courts[0].match).toBeNull()
    expect(after.courts[0].retainedPair).toBeNull()
  })

  it('retains winners on their court, routes a fixed-pair challenge, and releases them explicitly', () => {
    let before = makeState(10, 2)
    before.rotationMode = 'winner_stays'
    before = sendToCourt(refillQueue(before, nextId), 0, nextId)
    const winners = before.courts[0].match!.teamA
    const finishedId = before.courts[0].match!.id
    const after = finishMatch(before, 0, 'A', nextId)
    expect(after.courts[0]).toMatchObject({ match: null, retainedPair: winners, retainedFromMatchId: finishedId })
    expect(freePlayers(after).some(player => winners.includes(player.id))).toBe(false)
    const index = after.queue.findIndex(entry => entry.courtNo === 1)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(after.queue[index].teamA).toEqual(winners)
    expect(after.queue.filter(entry => entry.courtNo !== 1).flatMap(entry => [...entry.teamA, ...entry.teamB])
      .some(id => winners.includes(id))).toBe(false)
    expect(sendToCourt(after, index, nextId, { courtNo: 2 })).toBe(after)
    const started = sendToCourt(after, index, nextId)
    expect(started.courts[0].match!.teamA).toEqual(winners)
    expect(started.courts[0].retainedPair).toBeNull()
    const released = releaseRetainedPair(after, 0, nextId)
    expect(released.courts[0].retainedPair).toBeNull()
    expect(released.queue.every(entry => entry.courtNo !== 1)).toBe(true)
    expect(released.players).toEqual(after.players)
    expect(releaseRetainedPair(started, 0, nextId)).toBe(started)
    const ordinary = finishMatch({ ...before, rotationMode: 'all_out', courts: before.courts.map(court => ({ ...court, rotationMode: 'all_out' })) }, 0, 'A', nextId)
    expect(ordinary.courts[0].retainedPair).toBeNull()
  })

  it('uses the real session clock for simultaneous courts and averages only observed durations', () => {
    const before = makeState(8, 2)
    before.mode = 'manual'
    before.clockMin = 100
    before.players[0] = { ...before.players[0], averageMinutes: 10, timedGames: 2 }
    before.courts = before.courts.map((court, i) => ({
      ...court, startedAt: '2026-09-17T18:00:00+07:00', startedAtMin: 100,
      match: { id: `court-${i}`, teamA: [`p${i * 4 + 1}`, `p${i * 4 + 2}`], teamB: [`p${i * 4 + 3}`, `p${i * 4 + 4}`], gap: 0, locked: true },
    }))
    const first = finishMatch(before, 0, 'A', nextId, 120, 20)
    expect(first.clockMin).toBe(120)
    expect(first.players[0]).toMatchObject({ averageMinutes: 40 / 3, timedGames: 3, freeAtMin: 120 })
    expect(first.players[1]).toMatchObject({ averageMinutes: 20, timedGames: 1 })
    expect(first.players[4]).toBe(before.players[4])
    expect(first.courts[0].startedAt).toBeNull()
    const second = finishMatch(first, 1, 'B', nextId, 119, 19)
    expect(second.clockMin).toBe(120)
    expect(second.players[4]).toMatchObject({ averageMinutes: 19, timedGames: 1, freeAtMin: 120 })
    for (const elapsed of [undefined, NaN, Infinity, -1, 0]) {
      const result = finishMatch(before, 1, 'A', nextId, 120, elapsed)
      expect(result.players[4].averageMinutes).toBeUndefined()
      expect(result.players[4].timedGames).toBeUndefined()
    }
    before.players[4] = { ...before.players[4], averageMinutes: NaN, timedGames: 2 }
    expect(finishMatch(before, 1, 'A', nextId, 120, 19).players[4])
      .toMatchObject({ averageMinutes: 19, timedGames: 1 })
  })

  it('boosts each winner by their new streak, resets losers, and leaves spectators untouched', () => {
    const initial = makeState(5, 1)
    initial.mode = 'manual'
    initial.players = initial.players.map((p, i) => ({ ...p, elo: 1000, winStreak: [1, 4, 3, 0, 6][i] }))
    initial.courts[0].match = { id: 'streak', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], gap: 0, locked: true }
    const next = finishMatch(initial, 0, 'A', nextId)
    expect(next.players[0]).toMatchObject({ elo: 1017.6, winStreak: 2 })
    expect(next.players[1]).toMatchObject({ elo: 1024, winStreak: 5 })
    expect(next.players[2]).toMatchObject({ elo: 984, winStreak: 0 })
    expect(next.players[3]).toMatchObject({ elo: 984, winStreak: 0 })
    expect(next.players[4]).toBe(initial.players[4])
    expect(initial.players[0]).toMatchObject({ elo: 1000, winStreak: 1 })
  })

  it('advances the clock and credits the players', () => {
    let s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    const playing = [...s.courts[0].match!.teamA, ...s.courts[0].match!.teamB]
    s = finishMatch(s, 0, 'A', nextId)
    expect(s.clockMin).toBe(MATCH_MINUTES)
    expect(s.courts[0].match).toBeNull()
    for (const id of playing) {
      const p = s.players.find(x => x.id === id)!
      expect(p.gamesToday).toBe(1)
      expect(p.freeAtMin).toBe(MATCH_MINUTES)
    }
  })

  it('moves the winners up and the losers down', () => {
    let s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    const { teamA, teamB } = s.courts[0].match!
    const before = Object.fromEntries(s.players.map(p => [p.id, p.elo]))
    s = finishMatch(s, 0, 'A', nextId)
    const after = Object.fromEntries(s.players.map(p => [p.id, p.elo]))
    for (const id of teamA) expect(after[id]).toBeGreaterThan(before[id])
    for (const id of teamB) expect(after[id]).toBeLessThan(before[id])
  })

  // The finish counter advances only when a match actually finishes.
  // Indexing by the loop step instead looks like it alternates but does not:
  // the steps that reach the finish branch are all even, so court 0 would
  // finish every time and court 1 would never free up.
  function simulate(state: SessionState, targetMatches: number): SessionState {
    let s = state
    let finishTurn = 0
    for (let step = 0; step < 400 && s.playedCount < targetMatches; step++) {
      if (s.courts.some(c => !c.match) && s.queue.length > 0) {
        s = sendToCourt(s, 0, nextId)
        continue
      }
      const busy = s.courts.map((c, i) => (c.match ? i : -1)).filter(i => i >= 0)
      if (busy.length === 0) break
      s = finishMatch(s, busy[finishTurn % busy.length], finishTurn % 2 ? 'A' : 'B', nextId)
      finishTurn++
    }
    return s
  }

  it('alternates courts so both actually finish', () => {
    const s = simulate(refillQueue(makeState(12, 2), nextId), 6)
    // A degenerate harness that only ever finishes court 0 cannot reach 6 matches
    // with 12 players, because court 1 would hold four of them forever.
    expect(s.playedCount).toBe(6)
  })

  it('keeps everyone within two games of each other over a long session', () => {
    const s = simulate(refillQueue({ ...makeState(12, 2), mode: 'fair' }, nextId), 30)
    const games = s.players.map(p => p.gamesToday)
    expect(s.playedCount).toBeGreaterThanOrEqual(25)
    expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(2)
  })

  it('leaves nobody on zero games', () => {
    const s = simulate(refillQueue({ ...makeState(10, 2), mode: 'balance' }, nextId), 30)
    expect(Math.min(...s.players.map(p => p.gamesToday))).toBeGreaterThan(0)
  })
})

describe('freePlayers', () => {
  it('excludes anyone on court or already queued', () => {
    const s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    const busy = new Set([
      ...s.courts.flatMap(c => (c.match ? [...c.match.teamA, ...c.match.teamB] : [])),
      ...s.queue.flatMap(e => [...e.teamA, ...e.teamB]),
    ])
    for (const p of freePlayers(s)) expect(busy.has(p.id)).toBe(false)
  })
})

describe('syncSessionPlayers', () => {
  it('preserves newer duration samples independently of the season game count', () => {
    const before = makeState(4, 1)
    before.players[0] = { ...before.players[0], averageMinutes: 18, timedGames: 3 }
    const incoming = before.players.map(player => ({ ...player, elo: 1200, averageMinutes: 12, timedGames: 2 }))
    const merged = syncSessionPlayers(before, incoming, nextId)
    expect(merged.players[0]).toMatchObject({ elo: 1200, averageMinutes: 18, timedGames: 3 })
    incoming[0].timedGames = 4
    expect(syncSessionPlayers(merged, incoming, nextId).players[0]).toMatchObject({ averageMinutes: 12, timedGames: 4 })
  })

  it('merges check-ins, rebuilds queues, and preserves active match ids and local wait times', () => {
    const before = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    before.clockMin = 42
    const activeId = before.courts[0].match!.teamA[0]
    const removedId = before.queue[0].teamA[0]
    before.queue[0].locked = true
    before.players[0].freeAtMin = 14
    const incoming = before.players.filter(p => p.id !== activeId && p.id !== removedId)
      .map(p => ({ ...p, elo: 1200, winStreak: 0, freeAtMin: 0 }))
    incoming.push({ ...incoming[0], id: 'new-player' })
    const after = syncSessionPlayers(before, incoming, nextId)
    expect(after.courts).toBe(before.courts)
    expect(after.courts[0].match!.id).toBe(before.courts[0].match!.id)
    expect(after.clockMin).toBe(42)
    expect(after.players.some(p => p.id === activeId)).toBe(true)
    expect(after.players.some(p => p.id === removedId)).toBe(false)
    expect(after.queue.flatMap(q => [...q.teamA, ...q.teamB])).not.toContain(removedId)
    expect(after.players.find(p => p.id === incoming[0].id)!.elo).toBe(1200)
    expect(after.players.find(p => p.id === 'new-player')!.freeAtMin).toBe(42)
    expect(after.players.find(p => p.id === before.players[0].id)!.freeAtMin).toBe(14)
    const finished = syncSessionPlayers(finishMatch(after, 0, 'A', nextId), incoming, nextId)
    expect(finished.players.some(p => p.id === activeId)).toBe(false)
  })

  it('accepts current server streak resets but never rolls back a newer saved match snapshot', () => {
    const before = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    before.players = before.players.map(p => ({ ...p, winStreak: 5, averageMinutes: 10, timedGames: 2 }))
    const saved = finishMatch(before, 0, 'A', nextId, 20, 20)
    const playing = new Set([...before.courts[0].match!.teamA, ...before.courts[0].match!.teamB])
    const waitingId = saved.players.find(p => !playing.has(p.id))!.id
    saved.players = saved.players.map(p => p.id === waitingId ? { ...p, winStreak: 0 } : p)
    const stale = syncSessionPlayers(saved, before.players, nextId)
    for (const player of saved.players) {
      expect(stale.players.find(p => p.id === player.id)).toMatchObject({
        elo: player.elo, winStreak: player.winStreak, seasonGames: player.seasonGames, gamesToday: player.gamesToday,
        averageMinutes: player.averageMinutes, timedGames: player.timedGames,
      })
    }
    const fresh = saved.players.map(p => ({ ...p, winStreak: 0 }))
    expect(syncSessionPlayers(saved, fresh, nextId).players.every(p => p.winStreak === 0)).toBe(true)
  })
})

describe('syncSessionCourts', () => {
  it('accepts authoritative acknowledgments and newer retained sources even while an older result is protected', () => {
    const before = makeState(8, 1)
    before.mode = 'manual'
    const active = { id: 'started', teamA: ['p1', 'p2'] as [string, string], teamB: ['p3', 'p4'] as [string, string], gap: 0, locked: true }
    before.courts[0] = { ...before.courts[0], match: active, rotationMode: 'winner_stays', mode: 'mix', balanceWeight: 0.5 }
    const acknowledged = { ...before.courts[0], rotationMode: 'all_out' as const, mode: 'fair' as const, balanceWeight: 0.9, startedAt: '2026-09-17T19:00:00+07:00' }
    expect(syncSessionCourts(before, [acknowledged], nextId, ['started']).courts[0]).toEqual(acknowledged)
    before.courts[0] = { ...before.courts[0], match: null, retainedPair: ['p1', 'p2'], retainedFromMatchId: 'old' }
    const newer = { ...before.courts[0], retainedPair: ['p5', 'p6'] as [string, string], retainedFromMatchId: 'new' }
    expect(syncSessionCourts(before, [newer], nextId, ['old']).courts[0]).toEqual(newer)
  })

  it('keeps authoritative retained winners busy and protects a just-completed retained pair', () => {
    const before = makeState(8, 2)
    before.mode = 'manual'
    before.courts[0] = { ...before.courts[0], retainedPair: ['p1', 'p2'], retainedFromMatchId: 'completed', rotationMode: 'winner_stays' }
    const empty = before.courts.map(court => ({ ...court, retainedPair: null, retainedFromMatchId: null }))
    const protectedState = syncSessionCourts(before, empty, nextId, ['completed'])
    expect(protectedState.courts[0].retainedPair).toEqual(['p1', 'p2'])
    expect(freePlayers(protectedState).map(player => player.id)).not.toContain('p1')
    expect(syncSessionCourts(before, empty, nextId).courts[0].retainedPair).toBeNull()
    const restored = syncSessionCourts({ ...before, courts: empty }, before.courts, nextId)
    expect(freePlayers(restored).map(player => player.id)).not.toContain('p2')
  })

  it('restores server courts, removes conflicting queued players, and protects uncertain local starts', () => {
    const before = refillQueue(makeState(12, 2), nextId)
    const restored = { ...before.courts[1], match: before.queue[1], startedAt: '2026-09-17T18:00:00+07:00', startedAtMin: 10 }
    before.queue[1].locked = true
    const next = syncSessionCourts(before, [before.courts[0], restored], nextId)
    const busy = [...restored.match.teamA, ...restored.match.teamB]
    expect(next.courts[1]).toEqual(restored)
    expect(next.queue.flatMap(entry => [...entry.teamA, ...entry.teamB]).some(id => busy.includes(id))).toBe(false)
    const pending = sendToCourt(next, 0, nextId)
    pending.courts[0] = { ...pending.courts[0], mode: 'balance', balanceWeight: 0.8 }
    const protectedId = pending.courts[0].match!.id
    const server = [{ ...before.courts[0], startsAt: '2026-09-17T18:00:00+07:00', endsAt: '2026-09-17T20:00:00+07:00' }, restored]
    const preserved = syncSessionCourts(pending, server, nextId, [protectedId])
    expect(preserved.courts[0]).toMatchObject({ match: pending.courts[0].match, startsAt: server[0].startsAt, mode: 'balance', balanceWeight: 0.8 })
    expect(syncSessionCourts(pending, server, nextId).courts[0].match).toBeNull()
    expect(syncSessionCourts(pending, [restored], nextId, [protectedId]).courts.some(court => court.match?.id === protectedId)).toBe(true)
  })
})
