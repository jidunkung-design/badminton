import { describe, it, expect } from 'vitest'
import { ELO_BASE, ELO_K, skillPrior, blendedRating, eloDelta, streakMultiplier } from '@/domain/rating'

it('steps personal streak bonuses and caps them at five wins', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 99].map(streakMultiplier)).toEqual([1, 1, 1.1, 1.2, 1.3, 1.5, 1.5, 1.5])
  expect([-1, 1.5, NaN, Infinity].map(streakMultiplier)).toEqual([1, 1, 1, 1])
})

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
  it('uses the standard half-point result for a draw without a winner bonus', () => {
    expect(eloDelta(1000, 1000, 0.5)).toBe(0)
    expect(eloDelta(900, 1200, 0.5)).toBeGreaterThan(0)
    expect(eloDelta(1200, 900, 0.5)).toBeLessThan(0)
    expect(eloDelta(900, 1200, 0.5) + eloDelta(1200, 900, 0.5)).toBeCloseTo(0)
  })
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
