import { describe, it, expect } from 'vitest'
import type { SessionPlayer } from '@/domain/types'
import { maxGamesToday, priority, orderByPriority } from '@/domain/fairness'

function p(id: string, gamesToday: number, freeAtMin: number): SessionPlayer {
  return { id, skill: 3, elo: 1000, seasonGames: 0, gamesToday, freeAtMin }
}

describe('priority', () => {
  it('ranks the player who is furthest behind first', () => {
    const pool = [p('a', 3, 40), p('b', 1, 40)]
    expect(priority(pool[1], 3, 40)).toBeGreaterThan(priority(pool[0], 3, 40))
  })

  it('breaks ties by how long someone has waited', () => {
    const waited = p('slow', 2, 0)
    const fresh = p('fast', 2, 40)
    expect(priority(waited, 2, 40)).toBeGreaterThan(priority(fresh, 2, 40))
  })

  it('counts one game behind as worth about twelve minutes of waiting', () => {
    const behind = p('behind', 1, 40)
    const waiting = p('waiting', 2, 27.5)
    expect(priority(behind, 2, 40)).toBeCloseTo(priority(waiting, 2, 40), 1)
  })
})

describe('orderByPriority', () => {
  it('puts the most deserving player first', () => {
    const order = orderByPriority([p('a', 3, 40), p('b', 0, 0), p('c', 2, 10)], 40)
    expect(order[0].id).toBe('b')
  })

  it('ignores season history and looks only at today', () => {
    const regular = { ...p('regular', 0, 0), seasonGames: 200 }
    const newbie = { ...p('newbie', 2, 40), seasonGames: 0 }
    expect(orderByPriority([newbie, regular], 40)[0].id).toBe('regular')
  })
})
