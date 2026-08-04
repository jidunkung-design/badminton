import type { Court, QueueEntry, QueueMode, SessionPlayer } from './types'
import { orderByPriority } from './fairness'
import { buildEntry, signature, type PairingOptions } from './pairing'
import { eloDelta } from './rating'

export type { SessionPlayer, QueueEntry, Court, QueueMode } from './types'

/** Assumed length of one game, used to advance the session clock. */
export const MATCH_MINUTES = 14

/** How many matches back a partnership still counts as recent. */
const PARTNER_MEMORY = 12
const PARTNER_PENALTY = 25

export interface SessionState {
  clockMin: number
  courts: Court[]
  queue: QueueEntry[]
  players: SessionPlayer[]
  mode: QueueMode
  balanceWeight: number
  /** Arrangements the organiser threw away. Never propose them again. */
  rejected: Set<string>
  /** partnership key -> playedCount at the time they last teamed up */
  lastTeamedAt: Record<string, number>
  playedCount: number
}

function partnerKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function onCourtIds(state: SessionState): string[] {
  return state.courts.flatMap(c => (c.match ? [...c.match.teamA, ...c.match.teamB] : []))
}

function queuedIds(state: SessionState): string[] {
  return state.queue.flatMap(e => [...e.teamA, ...e.teamB])
}

export function freePlayers(state: SessionState): SessionPlayer[] {
  const busy = new Set([...onCourtIds(state), ...queuedIds(state)])
  return state.players.filter(p => !busy.has(p.id))
}

function pairingOptions(state: SessionState): PairingOptions {
  return {
    balanceWeight: state.balanceWeight,
    rejected: state.rejected,
    recentPartnerPenalty: (a, b) => {
      const last = state.lastTeamedAt[partnerKey(a, b)]
      if (last === undefined) return 0
      return Math.max(0, PARTNER_MEMORY - (state.playedCount - last)) * PARTNER_PENALTY
    },
  }
}

export function refillQueue(state: SessionState, nextId: () => string): SessionState {
  if (state.mode === 'manual') return state
  // Capture the narrowed mode once: state.mode is provably not 'manual' past
  // the guard above, but that narrowing does not survive being read back off
  // `next` (a reassigned SessionState) inside the loop, so pass this instead.
  const mode = state.mode
  // Drop unlocked entries: they were built from older fairness data.
  let next: SessionState = { ...state, queue: state.queue.filter(e => e.locked) }
  const depth = state.courts.length + 1
  for (let guard = 0; next.queue.length < depth && guard < 8; guard++) {
    const pool = orderByPriority(freePlayers(next), next.clockMin)
    const built = buildEntry(pool, mode, pairingOptions(next))
    if (!built) break
    next = {
      ...next,
      queue: [
        ...next.queue,
        {
          id: nextId(),
          teamA: built.teamA,
          teamB: built.teamB,
          gap: Math.round(built.gap),
          locked: false,
        },
      ],
    }
  }
  return next
}

export function sendToCourt(
  state: SessionState,
  entryIndex: number,
  nextId: () => string,
): SessionState {
  const courtIndex = state.courts.findIndex(c => !c.match)
  const entry = state.queue[entryIndex]
  if (courtIndex < 0 || !entry) return state
  const courts = state.courts.map((c, i) =>
    i === courtIndex ? { ...c, match: entry, startedAtMin: state.clockMin } : c,
  )
  const queue = state.queue.filter((_, i) => i !== entryIndex)
  return refillQueue({ ...state, courts, queue }, nextId)
}

export function finishMatch(
  state: SessionState,
  courtIndex: number,
  winner: 'A' | 'B',
  nextId: () => string,
): SessionState {
  const court = state.courts[courtIndex]
  if (!court?.match) return state
  const { teamA, teamB } = court.match
  const won = winner === 'A' ? teamA : teamB
  const lost = winner === 'A' ? teamB : teamA

  const eloOf = (id: string) => state.players.find(p => p.id === id)!.elo
  const delta = eloDelta((eloOf(won[0]) + eloOf(won[1])) / 2, (eloOf(lost[0]) + eloOf(lost[1])) / 2)

  const clockMin = state.clockMin + MATCH_MINUTES
  const playing = new Set([...teamA, ...teamB])
  const players = state.players.map(p => {
    if (!playing.has(p.id)) return p
    const sign = won.includes(p.id) ? 1 : -1
    return {
      ...p,
      elo: p.elo + sign * delta,
      seasonGames: p.seasonGames + 1,
      gamesToday: p.gamesToday + 1,
      freeAtMin: clockMin,
    }
  })

  const lastTeamedAt = { ...state.lastTeamedAt }
  for (const team of [teamA, teamB]) lastTeamedAt[partnerKey(team[0], team[1])] = state.playedCount

  const courts = state.courts.map((c, i) =>
    i === courtIndex ? { ...c, match: null, startedAtMin: null } : c,
  )

  return refillQueue(
    { ...state, clockMin, players, courts, lastTeamedAt, playedCount: state.playedCount + 1 },
    nextId,
  )
}

/** Record an arrangement the organiser rejected so it is not proposed again. */
export function rejectEntry(state: SessionState, entryIndex: number, nextId: () => string): SessionState {
  const entry = state.queue[entryIndex]
  if (!entry) return state
  const rejected = new Set(state.rejected)
  rejected.add(signature(entry.teamA, entry.teamB))
  return refillQueue(
    { ...state, rejected, queue: state.queue.filter((_, i) => i !== entryIndex) },
    nextId,
  )
}
