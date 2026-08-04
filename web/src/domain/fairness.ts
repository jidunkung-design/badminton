import type { SessionPlayer } from './types'

/** One game behind is worth this many minutes of waiting. */
const MINUTE_WEIGHT = 0.08

export function maxGamesToday(players: SessionPlayer[]): number {
  return players.reduce((max, p) => Math.max(max, p.gamesToday), 0)
}

/**
 * Higher means more deserving of the next slot.
 * Counts games played TODAY only. Counting season totals would punish
 * the people who turn up every week by giving them fewer turns forever.
 */
export function priority(p: SessionPlayer, maxToday: number, clockMin: number): number {
  const behind = maxToday - p.gamesToday
  const waited = Math.max(0, clockMin - p.freeAtMin)
  return behind + waited * MINUTE_WEIGHT
}

export function orderByPriority(players: SessionPlayer[], clockMin: number): SessionPlayer[] {
  const maxToday = maxGamesToday(players)
  return [...players].sort(
    (a, b) => priority(b, maxToday, clockMin) - priority(a, maxToday, clockMin),
  )
}
