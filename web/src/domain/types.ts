export interface SessionPlayer {
  id: string
  skill: number
  /** Season elo as computed from the match log. */
  elo: number
  /** Games played this season, used to weight the skill prior. */
  seasonGames: number
  /** Games played today, used for fairness. */
  gamesToday: number
  /** Session clock minute at which this player last became free. */
  freeAtMin: number
}

export type QueueMode = 'manual' | 'fair' | 'mix' | 'balance'

export interface QueueEntry {
  id: string
  teamA: [string, string]
  teamB: [string, string]
  /** Absolute rating difference between the two sides. */
  gap: number
  /** Locked entries survive recomputation. */
  locked: boolean
}

export interface Court {
  no: number
  match: QueueEntry | null
  startedAtMin: number | null
}
