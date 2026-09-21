export const categories = ['head', 'outfit', 'shoes', 'racket', 'background'] as const
export type Category = (typeof categories)[number]
export type Skin = 'warm' | 'light' | 'deep'
export type Hair = 'short' | 'bob' | 'spiky'
export type ChestTier = 'bronze' | 'silver' | 'gold'
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type Equipped = Partial<Record<Category, string>>
export type Cosmetic = { id: string; name: string; category: Category; rarity: Rarity; color: string; price: number }
export type MascotAppearance = { skin: Skin; hair: Hair; equipment: Partial<Record<Category, Pick<Cosmetic, 'id' | 'color' | 'rarity'>>> }
export type Chest = { id: ChestTier; name: string; price: number; odds: Record<Rarity, number> }
export type Locker = { coins: number; skin: Skin; hair: Hair; equipped: Equipped; owned: string[]; boxes: Record<ChestTier, number>; catalog: Cosmetic[]; chestCatalog: Chest[] }
export type OpenedChest = { item: Cosmetic; duplicate: boolean; refund: number }
export type LockerOperation = { kind: 'buyItem'; target: string } | { kind: 'buyChest' | 'openChest'; target: ChestTier } | { kind: 'save'; skin: Skin; hair: Hair; equipped: Equipped }

export const categoryNames: Record<Category, string> = { head: 'หมวกและโบว์', outfit: 'ชุด', shoes: 'รองเท้า', racket: 'ไม้แบด', background: 'พื้นหลัง' }
export const rarityNames: Record<Rarity, string> = { common: 'ทั่วไป', rare: 'หายาก', epic: 'พิเศษ', legendary: 'ตำนาน' }

export function mascotAppearance(locker: Pick<Locker, 'skin' | 'hair' | 'equipped' | 'catalog'>): MascotAppearance {
  return { skin: locker.skin, hair: locker.hair, equipment: Object.fromEntries(categories.flatMap(category => {
    const item = locker.catalog.find(item => item.id === locker.equipped[category] && item.category === category)
    return item ? [[category, item]] : []
  })) }
}

export function validLockerOperation(value: unknown): value is LockerOperation {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  if (input.kind === 'buyItem') return typeof input.target === 'string' && /^[a-z0-9_-]{1,80}$/.test(input.target)
  if (input.kind === 'buyChest' || input.kind === 'openChest') return ['bronze', 'silver', 'gold'].includes(String(input.target))
  if (input.kind !== 'save' || !['warm', 'light', 'deep'].includes(String(input.skin)) || !['short', 'bob', 'spiky'].includes(String(input.hair))) return false
  if (!input.equipped || typeof input.equipped !== 'object' || Array.isArray(input.equipped)) return false
  return Object.entries(input.equipped).every(([key, id]) => categories.includes(key as Category) && typeof id === 'string' && /^[a-z0-9_-]{1,80}$/.test(id))
}
