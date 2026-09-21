import { expect, it } from 'vitest'
import { playerTotals, scoreError, matchRatings, demoHeadToHead, demoRetainedPairs, nextDemoTeams, planDemoCourts, type DemoCourt, type DemoMatch } from '@/app/preview/scoring'
import { bestSplit, genderCompositionDifference } from '@/domain/pairing'

it('accepts configurable targets, rejects invalid results, and counts each doubles player’s games and wins', () => {
  for (const [target, a, b] of [[11, 11, 7], [21, 21, 18], [15, 15, 12], [21, 22, 20]]) {
    expect(scoreError(target, a, b)).toBeNull()
  }
  for (const [target, a, b] of [[0, 11, 7], [100, 100, 7], [11, 10, 7], [11, 11, 11], [11, -1, 11], [11, 11.5, 7], [11, NaN, 7], [11, Infinity, 7]]) {
    expect(scoreError(target, a, b)).toBeTruthy()
  }
  const matches: DemoMatch[] = [
    { id: 1, date: '2026-09-16', target: 11, a: ['a', 'b'], b: ['c', 'd'], scoreA: 11, scoreB: 7 },
    { id: 2, date: '2026-09-16', target: 21, a: ['c', 'a'], b: ['b', 'd'], scoreA: 18, scoreB: 21 },
  ]
  expect(playerTotals('a', matches)).toEqual({ games: 2, wins: 1, losses: 1, draws: 0 })
  expect(playerTotals('b', matches)).toEqual({ games: 2, wins: 2, losses: 0, draws: 0 })
  expect(playerTotals('new', matches)).toEqual({ games: 0, wins: 0, losses: 0, draws: 0 })
  expect(matches[0].target).toBe(11)
})

it('records timeout draws independently of scores, applies standard draw Elo and resets streaks', () => {
  const first: DemoMatch = { id: 1, date: '2026-09-16', target: 21, a: ['a', 'b'], b: ['c', 'd'], scoreA: 21, scoreB: 7, streakRoster: ['a', 'b', 'c', 'd'] }
  const draw: DemoMatch = { ...first, id: 2, scoreA: 8, scoreB: 3, result: 'draw' }
  expect(scoreError(21, 8, 3, 'draw')).toBeNull()
  expect(scoreError(21, 0, 0, 'draw')).toBeNull()
  expect(scoreError(21, -1, 0, 'draw')).toBeTruthy()
  const result = matchRatings([first, draw])
  const expectedDrawDelta = 32 * (0.5 - 1 / (1 + 10 ** ((984 - 1016) / 400)))
  expect(result.ratings.a).toBeCloseTo(1016 + expectedDrawDelta)
  expect(result.ratings.c).toBeCloseTo(984 - expectedDrawDelta)
  expect(result.changes.every(change => change.winStreak === 0 && change.multiplier === 1)).toBe(true)
  expect(playerTotals('a', [first, draw])).toEqual({ games: 2, wins: 1, losses: 0, draws: 1 })
  expect(Object.values(matchRatings([draw]).ratings)).toEqual([1000, 1000, 1000, 1000])
})

it('counts the exact teams regardless of side or player order, and rotates according to the finished game', () => {
  const first: DemoMatch = { id: 1, date: '2026-09-16', target: 21, a: ['a', 'b'], b: ['c', 'd'], scoreA: 21, scoreB: 7, rotationMode: 'winner_stays' }
  const log: DemoMatch[] = [first, { ...first, id: 2, a: ['d', 'c'], b: ['b', 'a'], result: 'draw' }, { ...first, id: 3, a: ['a', 'c'], b: ['b', 'd'] }]
  expect(demoHeadToHead(log, ['c', 'd'], ['b', 'a'])).toEqual({ games: 2, aWins: 0, bWins: 1, draws: 1 })
  const attendees = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  expect(nextDemoTeams(attendees, [first], first)).toEqual({ a: ['a', 'b'], b: ['e', 'f'] })
  const allOut = nextDemoTeams(attendees, [first], { ...first, rotationMode: 'all_out' })!
  expect(new Set([...allOut.a, ...allOut.b])).toEqual(new Set(['e', 'f', 'g', 'h']))
  const switchedMode = nextDemoTeams(attendees, [first], first, 'all_out')!
  expect(new Set([...switchedMode.a, ...switchedMode.b])).toEqual(new Set(['e', 'f', 'g', 'h']))
  const draw = nextDemoTeams(attendees, [first], { ...first, result: 'draw' })!
  expect(new Set([...draw.a, ...draw.b])).toEqual(new Set(['e', 'f', 'g', 'h']))
  expect(nextDemoTeams(['a', 'b', 'c'], [first], first)).toBeNull()
})

it('reports all four players before/after the latest match using their preceding Elo', () => {
  const first: DemoMatch = { id: 1, date: '2026-09-16', target: 11, a: ['a', 'b'], b: ['c', 'd'], scoreA: 11, scoreB: 7, streakRoster: ['a', 'b', 'c', 'd'] }
  const initial = matchRatings([first])
  expect(initial.changes).toEqual([
    { id: 'a', before: 1000, after: 1016, winStreak: 1, multiplier: 1 }, { id: 'b', before: 1000, after: 1016, winStreak: 1, multiplier: 1 },
    { id: 'c', before: 1000, after: 984, winStreak: 0, multiplier: 1 }, { id: 'd', before: 1000, after: 984, winStreak: 0, multiplier: 1 },
  ])
  const next = matchRatings([first, { ...first, id: 2, target: 21, scoreA: 18, scoreB: 21 }])
  expect(next.changes.map(change => change.before)).toEqual([1016, 1016, 984, 984])
  expect(next.ratings.a).toBeLessThan(1000)
  expect(next.ratings.c).toBeGreaterThan(1000)
  expect(next.changes.reduce((sum, change) => sum + change.after - change.before, 0)).toBeCloseTo(0)
  expect(matchRatings([{ ...first, target: 21, scoreA: 21, scoreB: 18 }]).changes).toEqual(initial.changes)
  expect(matchRatings([])).toEqual({ ratings: {}, changes: [], winStreaks: {} })
})

it('carries through team rotations but resets all streaks when even a waiting attendee changes', () => {
  const attendees = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const first: DemoMatch = { id: 1, date: '2026-09-16', target: 11, a: ['a', 'b'], b: ['c', 'd'], scoreA: 11, scoreB: 7, streakRoster: attendees }
  const rotated: DemoMatch = { ...first, id: 2, a: ['a', 'e'], b: ['f', 'g'], streakRoster: [...attendees].reverse() }
  const log = [first, rotated]
  expect(matchRatings(log).winStreaks).toMatchObject({ a: 2, b: 1, e: 1 })
  const changed = [...log, { ...rotated, id: 3, streakRoster: attendees.slice(0, -1) }]
  expect(matchRatings(changed).winStreaks).toMatchObject({ a: 1, b: 0, e: 1 })
  expect(matchRatings(changed).changes.every(change => change.multiplier === 1)).toBe(true)
  const returned = [...changed, { ...rotated, id: 4 }]
  expect(matchRatings(returned).winStreaks.a).toBe(1)
  expect(matchRatings([...returned, { ...rotated, id: 5 }]).winStreaks.a).toBe(2)
  const current = matchRatings(log, attendees.slice(0, -1))
  expect(Object.values(current.winStreaks).every(streak => streak === 0)).toBe(true)
  expect(current.ratings).toEqual(matchRatings(log).ratings)
  expect(current.changes).toEqual(matchRatings(log).changes)
  expect(Object.values(matchRatings(log, []).winStreaks).every(streak => streak === 0)).toBe(true)
  expect(matchRatings(log, undefined)).toEqual(matchRatings(log))
  expect(matchRatings([...log, { ...rotated, id: 3, streakRoster: undefined }, { ...rotated, id: 4 }]).winStreaks.a).toBe(1)
})

it('previews the same fair four and shared balanced split that start uses, including known gender and skill', () => {
  const people = [
    { id: 'e', skill: 4, gender: 'male' as const },
    { id: 'f', skill: 3, gender: 'female' as const },
    { id: 'g', skill: 3, gender: 'female' as const },
    { id: 'h', skill: 2, gender: 'male' as const },
  ]
  const waiting = people.map(player => player.id)
  const options = { players: people, ratingMatches: [] }
  const displayed = nextDemoTeams(waiting, [], null, 'all_out', options)!
  const shared = bestSplit(people.map(player => ({ ...player, elo: 1000, seasonGames: 0, gamesToday: 0, freeAtMin: 0 })), { balanceWeight: 1, recentPartnerPenalty: () => 0 })!
  expect(displayed).toEqual({ a: shared.teamA, b: shared.teamB })
  const genders = (team: string[]) => team.map(id => people.find(player => player.id === id)!.gender)
  expect(genderCompositionDifference(genders(displayed.a), genders(displayed.b))).toBe(0)
  const finished: DemoMatch = { id: 1, date: '2026-09-16', target: 21, a: ['a', 'b'], b: ['c', 'd'], scoreA: 21, scoreB: 7, rotationMode: 'all_out' }
  const readyToStart = nextDemoTeams(['a', 'b', 'c', 'd', ...waiting], [finished], finished, 'all_out', { ...options, ratingMatches: [finished] })
  expect(readyToStart).toEqual(displayed)
  expect(new Set([...displayed.a, ...displayed.b])).toEqual(new Set(waiting))
})

it('keeps legacy unspecified gender neutral and preserves the winning pair with the first fair challengers', () => {
  const people = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ id, skill: index === 0 ? 5 : 3 }))
  const legacy = nextDemoTeams(['a', 'b', 'c', 'd'], [], null, 'all_out', { players: people })
  expect(nextDemoTeams(['a', 'b', 'c', 'd'], [], null, 'all_out', { players: people.map(player => ({ ...player, gender: 'unspecified' })) })).toEqual(legacy)
  const winner: DemoMatch = { id: 1, date: '2026-09-16', target: 21, a: ['a', 'b'], b: ['c', 'd'], scoreA: 21, scoreB: 7, rotationMode: 'winner_stays' }
  expect(nextDemoTeams(people.map(player => player.id), [winner], winner, 'winner_stays', { players: people })).toEqual({ a: ['a', 'b'], b: ['e', 'f'] })
})

it('shares twelve attendees across two independent courts without duplicate allocations', () => {
  const attendees = 'abcdefghijkl'.split('')
  const courts: DemoCourt[] = [
    { no: 1, active: { target: 21, a: ['a', 'b'], b: ['c', 'd'], rotationMode: 'all_out' }, previous: null, rotationMode: 'all_out', allowRetention: true },
    { no: 2, active: { target: 11, a: ['e', 'f'], b: ['g', 'h'], rotationMode: 'winner_stays' }, previous: null, rotationMode: 'winner_stays', allowRetention: true },
  ]
  const initial = planDemoCourts(attendees, [], courts)
  expect(new Set([...initial[1]!.a, ...initial[1]!.b])).toEqual(new Set('ijkl'.split('')))
  expect(initial[2]).toBeNull()
  const result: DemoMatch = { ...courts[1].active!, id: 1, courtNo: 2, date: '2026-09-16', scoreA: 11, scoreB: 7 }
  courts[1] = { ...courts[1], active: null, previous: result }
  expect(demoRetainedPairs(attendees, courts).get(2)).toEqual(['e', 'f'])
  const afterSecondFinishes = planDemoCourts(attendees, [result], courts)
  expect(afterSecondFinishes[2]!.a).toEqual(['e', 'f'])
  expect([...afterSecondFinishes[2]!.b].every(id => 'ijkl'.includes(id))).toBe(true)
  const allAllocated = Object.values(afterSecondFinishes).flatMap(plan => plan ? [...plan.a, ...plan.b] : [])
  expect(new Set(allAllocated).size).toBe(allAllocated.length)
  expect(allAllocated.every(id => !'abcd'.includes(id))).toBe(true)
  courts[1] = { ...courts[1], active: { target: 11, rotationMode: 'winner_stays', ...afterSecondFinishes[2]! } }
  expect(courts[0].active?.a).toEqual(['a', 'b'])
  const afterStart = planDemoCourts(attendees, [result], courts)
  const playing = courts.flatMap(court => court.active ? [...court.active.a, ...court.active.b] : [])
  expect(new Set(playing).size).toBe(8)
  expect(Object.values(afterStart).flatMap(plan => plan ? [...plan.a, ...plan.b] : []).every(id => !playing.includes(id))).toBe(true)
  courts[1] = { ...courts[1], active: null, previous: { ...result, result: 'draw' } }
  expect(demoRetainedPairs(attendees, courts).size).toBe(0)
  const afterDraw = planDemoCourts(attendees, [result], courts)
  expect(new Set([...afterDraw[2]!.a, ...afterDraw[2]!.b])).toEqual(new Set('ijkl'.split('')))
  courts[1] = { ...courts[1], previous: result, allowRetention: false }
  expect(demoRetainedPairs(attendees, courts).size).toBe(0)
})
