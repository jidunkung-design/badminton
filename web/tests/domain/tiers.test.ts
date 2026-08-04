import { describe, it, expect } from 'vitest'
import { TIERS, tierOf, nextTier } from '@/domain/tiers'

describe('tierOf', () => {
  it('maps ratings to the Thai club ladder', () => {
    expect(tierOf(1156).key).toBe('B')
    expect(tierOf(1140).key).toBe('B')
    expect(tierOf(1121).key).toBe('C')
    expect(tierOf(1042).key).toBe('P')
    expect(tierOf(1015).key).toBe('S')
    expect(tierOf(903).key).toBe('N')
  })

  it('is ordered high to low with no gaps', () => {
    expect(TIERS.map(t => t.key)).toEqual(['B', 'C', 'P', 'S', 'N'])
    expect(TIERS[TIERS.length - 1].min).toBe(0)
  })
})

describe('nextTier', () => {
  it('returns null at the top of the ladder', () => {
    expect(nextTier(1200)).toBeNull()
  })

  it('reports how many points remain', () => {
    const up = nextTier(1121)!
    expect(up.key).toBe('B')
    expect(up.need).toBe(19)
  })

  it('measures progress across the last 100 points, not from the tier floor', () => {
    // N has floor 0. Measuring from 0 would put a 903 player at 91 percent,
    // which reads as "about to promote" when they are not.
    expect(Math.round(nextTier(903)!.pct * 100)).toBe(13)
    expect(Math.round(nextTier(988)!.pct * 100)).toBe(98)
  })

  it('clamps progress into 0..1', () => {
    for (const r of [0, 500, 989, 1139, 1141]) {
      const up = nextTier(r)
      if (up) {
        expect(up.pct).toBeGreaterThanOrEqual(0)
        expect(up.pct).toBeLessThanOrEqual(1)
      }
    }
  })
})
