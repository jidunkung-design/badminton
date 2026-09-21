export const ELO_BASE = 1000
export const ELO_K = 32

export type RatingChange = { id: string; before: number; after: number; winStreak?: number; multiplier?: number }

/** Whole-day attendance snapshot; an unknown/empty roster cannot carry a streak. */
export function streakRosterKey(roster?: readonly string[] | null): string | null {
  return roster?.length ? JSON.stringify([...new Set(roster)].sort()) : null
}

/** Applied to a winner's gain using their streak including the just-finished game. */
export function streakMultiplier(winStreak: number): number {
  if (!Number.isInteger(winStreak) || winStreak < 2) return 1
  return winStreak >= 5 ? 1.5 : [1, 1, 1.1, 1.2, 1.3][winStreak]
}

/** How many games before measured results outweigh the entered skill. */
const PRIOR_WEIGHT = 8

/** Skill 1..7 mapped onto the elo scale, with skill 3 sitting at the base. */
export function skillPrior(skill: number): number {
  return 700 + skill * 100
}

/**
 * Rating used for pairing. A new player is trusted at their entered skill;
 * after roughly 20 games their measured elo dominates.
 */
export function blendedRating(elo: number, seasonGames: number, skill: number): number {
  const n = Math.max(0, seasonGames)
  return (n / (n + PRIOR_WEIGHT)) * elo + (PRIOR_WEIGHT / (n + PRIOR_WEIGHT)) * skillPrior(skill)
}

/** Base gain/loss before the winner's personal streak bonus. */
export function eloDelta(teamAvg: number, opponentAvg: number, score: 0 | 0.5 | 1 = 1): number {
  const expected = 1 / (1 + Math.pow(10, (opponentAvg - teamAvg) / 400))
  return ELO_K * (score - expected)
}
