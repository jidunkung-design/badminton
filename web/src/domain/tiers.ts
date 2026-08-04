export type TierKey = 'B' | 'C' | 'P' | 'S' | 'N'

export interface Tier {
  key: TierKey
  min: number
  label: string
}

/** Thai amateur club ladder. N is the entry level, B is the highest we track. */
export const TIERS: readonly Tier[] = [
  { key: 'B', min: 1140, label: 'มือ B' },
  { key: 'C', min: 1090, label: 'มือ C' },
  { key: 'P', min: 1040, label: 'มือ P' },
  { key: 'S', min: 990, label: 'มือ S' },
  { key: 'N', min: 0, label: 'มือ N' },
]

/** Width of the progress window shown under a player's rating. */
const PROGRESS_WINDOW = 100

export function tierOf(rating: number): Tier {
  return TIERS.find(t => rating >= t.min) ?? TIERS[TIERS.length - 1]
}

export interface NextTier {
  key: TierKey
  label: string
  need: number
  pct: number
}

export function nextTier(rating: number): NextTier | null {
  const i = TIERS.findIndex(t => rating >= t.min)
  if (i <= 0) return null
  const up = TIERS[i - 1]
  // Measure inside the last PROGRESS_WINDOW points before promotion.
  // Measuring from the tier floor breaks for N, whose floor is 0.
  const floor = Math.max(TIERS[i].min, up.min - PROGRESS_WINDOW)
  const pct = (rating - floor) / (up.min - floor)
  return {
    key: up.key,
    label: up.label,
    need: Math.ceil(up.min - rating),
    pct: Math.max(0, Math.min(1, pct)),
  }
}
