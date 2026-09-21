import { expect, it } from 'vitest'
import { courtAvailability, estimateMatchMinutes } from '@/domain/duration'

it('averages only known player averages, deduplicates players, and falls back only when none are known', () => {
  const players = [{ id: 'a', averageMinutes: 10 }, { id: 'b', averageMinutes: 20 }, { id: 'c', averageMinutes: 0 }, { id: 'd' }, { id: 'e', averageMinutes: NaN }, { id: 'f', averageMinutes: Infinity }]
  expect(estimateMatchMinutes(['a', 'b', 'c', 'd'], players)).toEqual({ minutes: 15, knownPlayers: 2 })
  expect(estimateMatchMinutes(['a', 'a', 'c', 'd'], players)).toEqual({ minutes: 10, knownPlayers: 1 })
  expect(estimateMatchMinutes(['c', 'd', 'e', 'f', 'missing'], players)).toEqual({ minutes: 14, knownPlayers: 0 })
})

it('handles booking boundaries, overnight ISO times, and invalid or incomplete configuration', () => {
  const booking = { startsAt: '2026-09-17T23:00:00+07:00', endsAt: '2026-09-18T01:00:00+07:00' }
  expect(courtAvailability({}, Date.parse(booking.startsAt))).toBe('unconfigured')
  expect(courtAvailability(booking, Date.parse(booking.startsAt) - 1)).toBe('upcoming')
  expect(courtAvailability(booking, Date.parse(booking.startsAt))).toBe('open')
  expect(courtAvailability(booking, Date.parse(booking.endsAt) - 1)).toBe('open')
  expect(courtAvailability(booking, Date.parse(booking.endsAt))).toBe('closed')
  expect(courtAvailability({ startsAt: booking.startsAt }, Date.now())).toBe('closed')
  expect(courtAvailability({ startsAt: 'invalid', endsAt: booking.endsAt }, Date.now())).toBe('closed')
  expect(courtAvailability({ startsAt: booking.endsAt, endsAt: booking.startsAt }, Date.now())).toBe('closed')
  expect(courtAvailability(booking, NaN)).toBe('closed')
})
