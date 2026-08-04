export const ELO_BASE = 1000
export const ELO_K = 32

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

/** Points the winning side gains and the losing side loses. */
export function eloDelta(winnerAvg: number, loserAvg: number): number {
  const expected = 1 / (1 + Math.pow(10, (loserAvg - winnerAvg) / 400))
  return ELO_K * (1 - expected)
}
