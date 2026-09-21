export const PLAYER_GENDERS = ['male', 'female', 'unspecified'] as const
export type PlayerGender = (typeof PLAYER_GENDERS)[number]

export interface SessionPlayer {
  id: string
  skill: number
  /** Explicitly provided; legacy/unspecified values carry no composition preference. */
  gender?: PlayerGender
  /** Season elo as computed from the match log. */
  elo: number
  /** Consecutive wins in this room's season; absent means no preceding wins. */
  winStreak?: number
  /** Average elapsed minutes over games with a recorded server start/end. */
  averageMinutes?: number
  timedGames?: number
  /** Games played this season, used to weight the skill prior. */
  seasonGames: number
  /** Games played today, used for fairness. */
  gamesToday: number
  /** Session clock minute at which this player last became free. */
  freeAtMin: number
}

export type QueueMode = 'manual' | 'fair' | 'mix' | 'balance'
export type MatchResult = 'A' | 'B' | 'draw'
export type RotationMode = 'all_out' | 'winner_stays'

export interface QueueEntry {
  id: string
  teamA: [string, string]
  teamB: [string, string]
  /** Absolute rating difference between the two sides. */
  gap: number
  /** Locked entries survive recomputation. */
  locked: boolean
  /** A challenge against the retained pair may start only on this court. */
  courtNo?: number
}

export interface Court {
  no: number
  mode?: QueueMode
  balanceWeight?: number
  rotationMode?: RotationMode
  retainedPair?: [string, string] | null
  retainedFromMatchId?: string | null
  startsAt?: string | null
  endsAt?: string | null
  /** Real match start supplied by the server. */
  startedAt?: string | null
  match: QueueEntry | null
  startedAtMin: number | null
}

export interface CourtConfig {
  no: number
  startsAt: string | null
  endsAt: string | null
}
