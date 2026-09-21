import { describe, it, expect } from 'vitest'
import type { SessionPlayer } from '@/domain/types'
import { QUEUE_PLAN, combinations, signature, bestSplit, buildEntry, genderCompositionDifference } from '@/domain/pairing'

const noPenalty = () => 0
const balanced = { balanceWeight: 1, recentPartnerPenalty: noPenalty }

function player(id: string, elo: number): SessionPlayer {
  return { id, skill: 3, elo, seasonGames: 50, gamesToday: 0, freeAtMin: 0 }
}

describe('combinations', () => {
  it('produces every unordered subset of size k', () => {
    expect(combinations([1, 2, 3, 4], 2)).toHaveLength(6)
    expect(combinations([1, 2, 3], 3)).toEqual([[1, 2, 3]])
    expect(combinations([1, 2], 3)).toEqual([])
    expect(combinations([1, 2], 0)).toEqual([[]])
  })
})

describe('signature', () => {
  it('is stable no matter which side or order the names arrive in', () => {
    expect(signature(['a', 'b'], ['c', 'd'])).toBe(signature(['d', 'c'], ['b', 'a']))
  })
})

describe('bestSplit', () => {
  it('prefers matching gender composition at equal or nearby ratings without overriding a large skill gap', () => {
    for (const ratings of [[1000, 1000, 1000, 1000], [980, 1020, 1000, 1000]]) {
      const four: SessionPlayer[] = ratings.map((elo, i) => ({ ...player(String(i), elo), gender: i < 2 ? 'male' : 'female' }))
      const original = structuredClone(four)
      const split = bestSplit(four, balanced)!
      const genders = (ids: string[]) => ids.map(id => four.find(p => p.id === id)!.gender)
      expect(genderCompositionDifference(genders(split.teamA), genders(split.teamB))).toBe(0)
      expect(four).toEqual(original)
    }
    const four: SessionPlayer[] = [600, 1400, 1000, 1000].map((elo, i) => ({ ...player(String(i), elo), gender: i < 2 ? 'male' : 'female' }))
    expect(bestSplit(four, balanced)!.teamA).toEqual(['0', '1'])
    expect(bestSplit(four, balanced)!.gap).toBe(0)
    expect(bestSplit(four, balanced)!.score).toBe(50)
  })

  it('uses only explicitly known gender and leaves legacy pairing neutral', () => {
    expect(genderCompositionDifference(['male', 'male'], ['female', 'female'])).toBe(2)
    expect(genderCompositionDifference(['male', 'female'], ['female', 'male'])).toBe(0)
    expect(genderCompositionDifference(['male', undefined], ['female', 'female'])).toBeNull()
    expect(genderCompositionDifference(['male', 'unspecified'], ['female', 'female'])).toBeNull()
    const four: SessionPlayer[] = ['male-name', 'female-name', 'c', 'd'].map(id => player(id, 1000))
    expect(bestSplit(four, balanced)!.teamA).toEqual(['male-name', 'female-name'])
  })

  it('pairs strongest with weakest to level the two sides', () => {
    const four = [player('s1', 1200), player('s2', 1100), player('s3', 1000), player('s4', 900)]
    const split = bestSplit(four, balanced)!
    expect(split.gap).toBe(0)
    expect(new Set([...split.teamA])).toEqual(new Set(['s1', 's4']))
  })

  it('prefers a new partnership when balance is switched off', () => {
    const four = [player('a', 1000), player('b', 1000), player('c', 1000), player('d', 1000)]
    const split = bestSplit(four, {
      balanceWeight: 0,
      recentPartnerPenalty: (x, y) => ([x, y].sort().join('|') === 'a|b' ? 100 : 0),
    })!
    const together = new Set([...split.teamA]).has('a') && new Set([...split.teamA]).has('b')
    expect(together).toBe(false)
  })

  it('returns null when every arrangement has been rejected', () => {
    const four = [player('a', 1000), player('b', 1000), player('c', 1000), player('d', 1000)]
    const all = new Set([
      signature(['a', 'b'], ['c', 'd']),
      signature(['a', 'c'], ['b', 'd']),
      signature(['a', 'd'], ['b', 'c']),
    ])
    expect(bestSplit(four, { ...balanced, rejected: all })).toBeNull()
  })
})

describe('buildEntry', () => {
  it('never drops the players at the front of the queue', () => {
    // Ordered pool: index 0 is the most deserving.
    const pool = [
      { ...player('waited-longest', 700), gender: 'female' as const },
      { ...player('waited-second', 1400), gender: 'female' as const },
      { ...player('c', 1000), gender: 'male' as const },
      { ...player('d', 1000), gender: 'male' as const },
      { ...player('e', 1000), gender: 'male' as const },
      { ...player('f', 1000), gender: 'male' as const },
    ]
    const entry = buildEntry(pool, 'mix', balanced)!
    const picked = new Set([...entry.teamA, ...entry.teamB])
    // mix locks the first 2 even though dropping them would balance better
    expect(picked.has('waited-longest')).toBe(true)
    expect(picked.has('waited-second')).toBe(true)
  })

  it('takes exactly the first four in fair mode', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, 1000 + i * 40))
    const entry = buildEntry(pool, 'fair', balanced)!
    expect(new Set([...entry.teamA, ...entry.teamB])).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('returns null when fewer than four are free', () => {
    expect(buildEntry([player('a', 1000)], 'mix', balanced)).toBeNull()
  })

  it('uses the documented pool and lock sizes', () => {
    expect(QUEUE_PLAN.fair).toEqual({ pool: 4, lock: 4 })
    expect(QUEUE_PLAN.mix).toEqual({ pool: 6, lock: 2 })
    expect(QUEUE_PLAN.balance).toEqual({ pool: 8, lock: 1 })
  })
})
