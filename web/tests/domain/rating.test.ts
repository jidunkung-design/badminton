import { describe, it, expect } from 'vitest'
import { ELO_BASE, ELO_K, skillPrior, blendedRating, eloDelta } from '@/domain/rating'

describe('skillPrior', () => {
  it('centres a mid skill on the base rating', () => {
    expect(skillPrior(3)).toBe(ELO_BASE)
    expect(skillPrior(6)).toBe(1300)
    expect(skillPrior(1)).toBe(800)
  })
})

describe('blendedRating', () => {
  it('trusts the entered skill when the player has no games', () => {
    expect(blendedRating(1200, 0, 3)).toBe(1000)
  })

  it('converges on measured elo as games accumulate', () => {
    const few = blendedRating(1200, 4, 3)
    const many = blendedRating(1200, 40, 3)
    expect(few).toBeGreaterThan(1000)
    expect(few).toBeLessThan(many)
    expect(many).toBeGreaterThan(1150)
  })
})

describe('eloDelta', () => {
  it('moves 16 points when both sides are equal', () => {
    expect(Math.round(eloDelta(1000, 1000))).toBe(ELO_K / 2)
  })

  it('rewards an upset more than an expected win', () => {
    const upset = eloDelta(900, 1200)
    const expected = eloDelta(1200, 900)
    expect(upset).toBeGreaterThan(expected)
    expect(upset).toBeLessThanOrEqual(ELO_K)
    expect(expected).toBeGreaterThan(0)
  })
})
