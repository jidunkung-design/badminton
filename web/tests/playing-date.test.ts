import { expect, it } from 'vitest'
import { playingDate } from '@/lib/playing-date'
it('uses the Bangkok calendar day at the midnight boundary', () => {
  expect(playingDate(new Date('2026-09-16T16:59:59Z'))).toBe('2026-09-16')
  expect(playingDate(new Date('2026-09-16T17:00:00Z'))).toBe('2026-09-17')
})
