import { describe, expect, it } from 'vitest'
import { mascotAppearance, validLockerOperation, type Cosmetic } from '../src/lib/cosmetics'

describe('mascot requests and appearance', () => {
  it('accepts only known operations, slots, bases and simple catalog identifiers', () => {
    expect(validLockerOperation({ kind: 'buyItem', target: 'court-shirt' })).toBe(true)
    expect(validLockerOperation({ kind: 'openChest', target: 'silver' })).toBe(true)
    expect(validLockerOperation({ kind: 'save', skin: 'warm', hair: 'short', equipped: { outfit: 'court-shirt' } })).toBe(true)
    for (const input of [null, {}, { kind: 'credit', target: 'gold' }, { kind: 'openChest', target: 'platinum' }, { kind: 'buyItem', target: '../x' }, { kind: 'save', skin: 'warm', hair: 'short', equipped: { elo: '9999' } }, { kind: 'save', skin: 'warm', hair: 'short', equipped: [] }]) {
      expect(validLockerOperation(input)).toBe(false)
    }
  })

  it('resolves only catalog items matching the equipped slot and ignores missing items', () => {
    const shirt: Cosmetic = { id: 'court-shirt', name: 'เสื้อสนาม', category: 'outfit', rarity: 'rare', color: '#245943', price: 100 }
    expect(mascotAppearance({ skin: 'deep', hair: 'bob', equipped: { outfit: shirt.id, head: shirt.id, shoes: 'missing' }, catalog: [shirt] })).toEqual({ skin: 'deep', hair: 'bob', equipment: { outfit: shirt } })
    expect(mascotAppearance({ skin: 'warm', hair: 'short', equipped: {}, catalog: [] }).equipment).toEqual({})
  })
})
