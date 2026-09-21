import type { Court, SessionPlayer } from './types'

export const DEFAULT_MATCH_MINUTES = 14

export function estimateMatchMinutes(
  playerIds: readonly string[],
  players: readonly Pick<SessionPlayer, 'id' | 'averageMinutes'>[],
): { minutes: number; knownPlayers: number } {
  const averages = [...new Set(playerIds)].map(id => players.find(player => player.id === id)?.averageMinutes)
    .filter((minutes): minutes is number => typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0)
  return {
    minutes: averages.length ? averages.reduce((sum, minutes) => sum + minutes, 0) / averages.length : DEFAULT_MATCH_MINUTES,
    knownPlayers: averages.length,
  }
}

export function courtAvailability(
  court: Pick<Court, 'startsAt' | 'endsAt'>,
  nowMs: number,
): 'unconfigured' | 'upcoming' | 'open' | 'closed' {
  if (!Number.isFinite(nowMs)) return 'closed'
  if (court.startsAt == null && court.endsAt == null) return 'unconfigured'
  const start = Date.parse(court.startsAt ?? '')
  const end = Date.parse(court.endsAt ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'closed'
  if (nowMs < start) return 'upcoming'
  return nowMs < end ? 'open' : 'closed'
}
