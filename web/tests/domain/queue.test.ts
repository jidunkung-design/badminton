import { describe, it, expect } from 'vitest'
import type { SessionPlayer, SessionState } from '@/domain/queue'
import { MATCH_MINUTES, freePlayers, refillQueue, sendToCourt, finishMatch } from '@/domain/queue'

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
