import { ELO_BASE, eloDelta, streakMultiplier, streakRosterKey, type RatingChange } from '@/domain/rating'
import { buildChallengerEntry, buildEntry, signature } from '@/domain/pairing'
import type { MatchResult, PlayerGender, RotationMode, SessionPlayer } from '@/domain/types'

export type DemoMatch = {
  id: number
  date: string
  target: number
  a: [string, string]
  b: [string, string]
  scoreA: number
  scoreB: number
  streakRoster?: string[]
  result?: MatchResult
  rotationMode?: RotationMode
  courtNo?: number
}

export type DemoActiveMatch = Pick<DemoMatch, 'target' | 'a' | 'b'> & { rotationMode: RotationMode }
export type DemoCourt = {
  no: number
  active: DemoActiveMatch | null
  previous: DemoMatch | null
  rotationMode: RotationMode
  allowRetention: boolean
}

export const demoResult = (match: DemoMatch): MatchResult => match.result
  ?? (match.scoreA === match.scoreB ? 'draw' : match.scoreA > match.scoreB ? 'A' : 'B')

export function demoHeadToHead(matches: DemoMatch[], a: DemoMatch['a'], b: DemoMatch['b']) {
  const totals = { games: 0, aWins: 0, bWins: 0, draws: 0 }
  for (const match of matches) {
    if (signature(match.a, match.b) !== signature(a, b)) continue
    totals.games++
    const result = demoResult(match)
    if (result === 'draw') totals.draws++
    else {
      const winners = result === 'A' ? match.a : match.b
      if (a.every(id => winners.includes(id))) totals.aWins++
      else totals.bWins++
    }
  }
  return totals
}

export type DemoPlayer = { id: string; skill: number; gender?: PlayerGender }
type DemoPairingOptions = { players?: readonly DemoPlayer[]; ratingMatches?: DemoMatch[] }

export function demoPairingPlayers(ids: string[], matches: DemoMatch[], options: DemoPairingOptions = {}): SessionPlayer[] {
  const ratingMatches = options.ratingMatches ?? matches
  const { ratings } = matchRatings(ratingMatches)
  return ids.map(id => ({
    id,
    skill: options.players?.find(player => player.id === id)?.skill ?? 3,
    gender: options.players?.find(player => player.id === id)?.gender,
    elo: ratings[id] ?? ELO_BASE,
    seasonGames: playerTotals(id, ratingMatches).games,
    gamesToday: playerTotals(id, matches).games,
    freeAtMin: 0,
  }))
}

export function nextDemoTeams(attending: string[], matches: DemoMatch[], previous?: DemoMatch | null, rotationMode: RotationMode = previous?.rotationMode ?? 'all_out', options: DemoPairingOptions = {}): Pick<DemoMatch, 'a' | 'b'> | null {
  if (attending.length < 4) return null
  const prior = previous ? [...previous.a, ...previous.b] : []
  const ordered = [...attending].sort((a, b) => Number(prior.includes(a)) - Number(prior.includes(b))
    || playerTotals(a, matches).games - playerTotals(b, matches).games)
  const result = previous ? demoResult(previous) : 'draw'
  const retained = rotationMode === 'winner_stays' && previous?.rotationMode === 'winner_stays' && result !== 'draw'
    ? result === 'A' ? previous.a : previous.b : null
  const pool = demoPairingPlayers(ordered, matches, options)
  const pairingOptions = { balanceWeight: 1, recentPartnerPenalty: () => 0 }
  const entry = retained?.every(id => attending.includes(id))
    ? buildChallengerEntry([pool.find(player => player.id === retained[0])!, pool.find(player => player.id === retained[1])!], pool, 'fair', pairingOptions)
    : buildEntry(pool, 'fair', pairingOptions)
  return entry ? { a: entry.teamA, b: entry.teamB } : null
}

export function demoRetainedPairs(attending: string[], courts: DemoCourt[]) {
  const occupied = new Set(courts.flatMap(court => court.active ? [...court.active.a, ...court.active.b] : []))
  const reserved = new Map<number, string[]>()
  for (const court of courts) {
    const result = court.previous && demoResult(court.previous)
    if (!court.active && court.allowRetention && court.rotationMode === 'winner_stays' && court.previous?.rotationMode === 'winner_stays' && result !== 'draw') {
      const pair = result === 'A' ? court.previous.a : court.previous.b
      if (pair.every(id => attending.includes(id) && !occupied.has(id))) reserved.set(court.no, pair)
    }
  }
  return reserved
}

/** One shared allocation: free courts first, then tentative all-out previews. */
export function planDemoCourts(attending: string[], matches: DemoMatch[], courts: DemoCourt[], options: DemoPairingOptions = {}) {
  const occupied = new Set(courts.flatMap(court => court.active ? [...court.active.a, ...court.active.b] : []))
  const reserved = demoRetainedPairs(attending, courts)
  const selected = new Set<string>()
  const plans: Record<number, Pick<DemoMatch, 'a' | 'b'> | null> = {}
  for (const court of [...courts].sort((a, b) => Number(Boolean(a.active)) - Number(Boolean(b.active)))) {
    if (court.active?.rotationMode === 'winner_stays') { plans[court.no] = null; continue }
    const otherReserved = [...reserved].filter(([no]) => no !== court.no).flatMap(([, ids]) => ids)
    const eligible = attending.filter(id => !occupied.has(id) && !selected.has(id) && !otherReserved.includes(id))
    const plan = nextDemoTeams(eligible, matches, court.active ? null : court.previous, court.active || !court.allowRetention ? 'all_out' : court.rotationMode, options)
    plans[court.no] = plan
    if (plan) [...plan.a, ...plan.b].forEach(id => selected.add(id))
  }
  return plans
}

/** Replay the example log in playing order so each result uses the preceding ratings. */
export function matchRatings(matches: DemoMatch[], currentRoster?: string[]) {
  const ratings: Record<string, number> = {}
  const winStreaks: Record<string, number> = {}
  let changes: RatingChange[] = []
  let previousRoster: string | null = null
  for (const match of matches) {
    const snapshot = streakRosterKey(match.streakRoster)
    if (snapshot === null || snapshot !== previousRoster) {
      for (const id of Object.keys(winStreaks)) winStreaks[id] = 0
    }
    previousRoster = snapshot
    const rating = (id: string) => ratings[id] ?? ELO_BASE
    const average = (team: [string, string]) => (rating(team[0]) + rating(team[1])) / 2
    const result = demoResult(match)
    const draw = result === 'draw'
    const aWon = result === 'A'
    const winners = aWon ? match.a : match.b
    const losers = aWon ? match.b : match.a
    const delta = draw ? eloDelta(average(match.a), average(match.b), 0.5) : eloDelta(average(winners), average(losers))
    changes = [...match.a, ...match.b].map(id => {
      const before = rating(id)
      const winner = !draw && winners.includes(id)
      const winStreak = winner ? (winStreaks[id] ?? 0) + 1 : 0
      const after = before + (draw ? (match.a.includes(id) ? delta : -delta) : winner ? delta * streakMultiplier(winStreak) : -delta)
      ratings[id] = after
      winStreaks[id] = winStreak
      return { id, before, after, winStreak, multiplier: streakMultiplier(winStreak) }
    })
  }
  if (currentRoster !== undefined && (previousRoster === null || streakRosterKey(currentRoster) !== previousRoster)) {
    for (const id of Object.keys(winStreaks)) winStreaks[id] = 0
  }
  return { ratings, changes, winStreaks }
}

export function scoreError(target: number, a: number, b: number, result?: MatchResult): string | null {
  if (!Number.isInteger(target) || target < 1 || target > 99) return 'กำหนดแต้มเป้าหมายเป็นจำนวนเต็ม 1–99'
  if (![a, b].every(n => Number.isSafeInteger(n) && n >= 0)) return 'กรอกคะแนนทั้งสองทีมเป็นจำนวนเต็มตั้งแต่ 0'
  if (result === 'draw') return null
  if (a === b) return 'คะแนนยังเสมอกัน กรุณากรอกผลที่จบเกมแล้ว'
  if (Math.max(a, b) < target) return `ทีมชนะต้องได้อย่างน้อย ${target} แต้ม`
  return null
}

export function playerTotals(player: string, matches: DemoMatch[]) {
  return matches.reduce((total, match) => {
    const isA = match.a.includes(player)
    if (!isA && !match.b.includes(player)) return total
    const result = demoResult(match)
    const won = result === (isA ? 'A' : 'B')
    return {
      games: total.games + 1,
      wins: total.wins + Number(won),
      losses: total.losses + Number(result !== 'draw' && !won),
      draws: total.draws + Number(result === 'draw'),
    }
  }, { games: 0, wins: 0, losses: 0, draws: 0 })
}
