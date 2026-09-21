import type { PlayerGender, QueueMode, SessionPlayer } from './types'
import { blendedRating } from './rating'

/**
 * pool = how many waiting players the selector may look at
 * lock = how many of the most deserving are guaranteed a slot
 *
 * lock is never 0. Using fairness only to shortlist and then choosing purely
 * on balance lets the people at the back of the shortlist be skipped over and
 * over, which is exactly the complaint that makes people stop turning up.
 */
export const QUEUE_PLAN: Record<Exclude<QueueMode, 'manual'>, { pool: number; lock: number }> = {
  fair: { pool: 4, lock: 4 },
  mix: { pool: 6, lock: 2 },
  balance: { pool: 8, lock: 1 },
}

/** The three ways four players can split into two pairs. */
const SPLITS: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

export function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const out: T[][] = []
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) {
      out.push([items[i], ...rest])
    }
  }
  return out
}

export function signature(teamA: readonly string[], teamB: readonly string[]): string {
  return [[...teamA].sort().join('-'), [...teamB].sort().join('-')].sort().join('/')
}

export interface SplitResult {
  teamA: [string, string]
  teamB: [string, string]
  gap: number
  score: number
}

export interface PairingOptions {
  /** 1 means care only about an even match, 0 means care only about fresh partners. */
  balanceWeight: number
  recentPartnerPenalty: (a: string, b: string) => number
  rejected?: ReadonlySet<string>
}

function rate(p: SessionPlayer): number {
  return blendedRating(p.elo, p.seasonGames, p.skill)
}

/** Null means incomplete/unspecified information, not a mismatched pair. */
export function genderCompositionDifference(
  teamA: readonly (PlayerGender | undefined)[],
  teamB: readonly (PlayerGender | undefined)[],
): number | null {
  if (teamA.length !== 2 || teamB.length !== 2
    || [...teamA, ...teamB].some(gender => gender !== 'male' && gender !== 'female')) return null
  return Math.abs(teamA.filter(gender => gender === 'male').length - teamB.filter(gender => gender === 'male').length)
}

function compositionPenalty(teamA: readonly SessionPlayer[], teamB: readonly SessionPlayer[]): number {
  // ponytail: fixed 25-point soft preference; tune only when real-match feedback warrants it.
  return 25 * (genderCompositionDifference(teamA.map(player => player.gender), teamB.map(player => player.gender)) ?? 0)
}

export function bestSplit(four: SessionPlayer[], opts: PairingOptions): SplitResult | null {
  if (four.length !== 4) return null
  let best: SplitResult | null = null
  for (const [ia, ib] of SPLITS) {
    const teamA: [string, string] = [four[ia[0]].id, four[ia[1]].id]
    const teamB: [string, string] = [four[ib[0]].id, four[ib[1]].id]
    if (opts.rejected?.has(signature(teamA, teamB))) continue
    // Round away IEEE 754 floating-point noise (e.g. 1200+900-1100-1000
    // computed via blendedRating's weighted sums lands on ~-3.4e-13, not 0).
    const rawGap =
      rate(four[ia[0]]) + rate(four[ia[1]]) - rate(four[ib[0]]) - rate(four[ib[1]])
    const gap = Math.round(Math.abs(rawGap) * 1e6) / 1e6
    const repeat =
      opts.recentPartnerPenalty(teamA[0], teamA[1]) + opts.recentPartnerPenalty(teamB[0], teamB[1])
    const score = opts.balanceWeight * (gap / 4) + (1 - opts.balanceWeight) * repeat
      + compositionPenalty(ia.map(i => four[i]), ib.map(i => four[i]))
    if (!best || score < best.score) best = { teamA, teamB, gap, score }
  }
  return best
}

/** Preserve the winning pair and the fairness locks while choosing two challengers. */
export function buildChallengerEntry(
  retainedPair: readonly [SessionPlayer, SessionPlayer],
  orderedPool: SessionPlayer[],
  mode: Exclude<QueueMode, 'manual'>,
  opts: PairingOptions,
): SplitResult | null {
  const teamA: [string, string] = [retainedPair[0].id, retainedPair[1].id]
  const plan = QUEUE_PLAN[mode]
  const pool = orderedPool.filter(player => !teamA.includes(player.id)).slice(0, plan.pool)
  const lock = Math.min(plan.lock, 2)
  let best: SplitResult | null = null
  for (const extra of combinations(pool.slice(lock), 2 - lock)) {
    const pair = [...pool.slice(0, lock), ...extra]
    if (pair.length !== 2) continue
    const teamB: [string, string] = [pair[0].id, pair[1].id]
    if (opts.rejected?.has(signature(teamA, teamB))) continue
    const gap = Math.round(Math.abs(rate(retainedPair[0]) + rate(retainedPair[1]) - rate(pair[0]) - rate(pair[1])) * 1e6) / 1e6
    const score = opts.balanceWeight * gap / 4 + (1 - opts.balanceWeight) * opts.recentPartnerPenalty(...teamB)
      + compositionPenalty(retainedPair, pair)
    if (!best || score < best.score) best = { teamA, teamB, gap, score }
  }
  return best
}

/**
 * @param orderedPool free players, most deserving first (see orderByPriority)
 */
export function buildEntry(
  orderedPool: SessionPlayer[],
  mode: Exclude<QueueMode, 'manual'>,
  opts: PairingOptions,
): SplitResult | null {
  if (orderedPool.length < 4) return null
  const plan = QUEUE_PLAN[mode]
  const shortlist = orderedPool.slice(0, plan.pool)
  const lock = Math.min(plan.lock, 4, shortlist.length)
  const forced = shortlist.slice(0, lock)
  const rest = shortlist.slice(lock)
  let best: SplitResult | null = null
  for (const extra of combinations(rest, 4 - lock)) {
    const candidate = bestSplit([...forced, ...extra], opts)
    if (candidate && (!best || candidate.score < best.score)) best = candidate
  }
  return best
}
