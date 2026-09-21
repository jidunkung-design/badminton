import type { Court, MatchResult, QueueEntry, QueueMode, RotationMode, SessionPlayer } from './types'
import { orderByPriority } from './fairness'
import { buildEntry, buildChallengerEntry, signature, type PairingOptions } from './pairing'
import { eloDelta, streakMultiplier } from './rating'
import { courtAvailability, DEFAULT_MATCH_MINUTES } from './duration'

export type { SessionPlayer, QueueEntry, Court, CourtConfig, QueueMode, RotationMode, MatchResult } from './types'

/** Assumed length of one game, used to advance the session clock. */
export const MATCH_MINUTES = DEFAULT_MATCH_MINUTES

/** How many matches back a partnership still counts as recent. */
const PARTNER_MEMORY = 12
const PARTNER_PENALTY = 25

export interface SessionState {
  clockMin: number
  /** Absolute clock for booking windows; clockMin remains relative to the session. */
  nowMs?: number
  courts: Court[]
  queue: QueueEntry[]
  players: SessionPlayer[]
  mode: QueueMode
  rotationMode?: RotationMode
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
  return state.courts.flatMap(c => (c.match ? [...c.match.teamA, ...c.match.teamB]
    : state.nowMs !== undefined && courtAvailability(c, state.nowMs) === 'closed' ? [] : c.retainedPair ?? []))
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

function keepsPair(entry: QueueEntry, pair: [string, string]): boolean {
  return [entry.teamA, entry.teamB].some(team => pair.every(id => team.includes(id)))
}

function entryAvailable(entry: QueueEntry, courts: readonly Court[], nowMs?: number): boolean {
  const ids = [...entry.teamA, ...entry.teamB]
  if (new Set(ids).size !== 4) return false
  if (entry.courtNo !== undefined && !courts.some(court => court.no === entry.courtNo && !court.match
    && court.retainedPair && keepsPair(entry, court.retainedPair)
    && (nowMs === undefined || ['open', 'unconfigured'].includes(courtAvailability(court, nowMs))))) return false
  return courts.every(court => {
    if (court.match) return [...court.match.teamA, ...court.match.teamB].every(id => !ids.includes(id))
    if (nowMs !== undefined && courtAvailability(court, nowMs) === 'closed') return true
    return !court.retainedPair || !court.retainedPair.some(id => ids.includes(id))
      || (court.no === entry.courtNo && keepsPair(entry, court.retainedPair))
  })
}

export function refillQueue(state: SessionState, nextId: () => string): SessionState {
  const expired = new Set(state.courts.filter(court => !court.match && court.retainedPair
    && state.nowMs !== undefined && courtAvailability(court, state.nowMs) === 'closed').map(court => court.no))
  if (expired.size) state = { ...state,
    courts: state.courts.map(court => expired.has(court.no) ? { ...court, retainedPair: null, retainedFromMatchId: null } : court),
    queue: state.queue.filter(entry => entry.courtNo === undefined || !expired.has(entry.courtNo)),
  }
  if (state.mode === 'manual') return state
  // Capture the narrowed mode once: state.mode is provably not 'manual' past
  // the guard above, but that narrowing does not survive being read back off
  // `next` (a reassigned SessionState) inside the loop, so pass this instead.
  const mode = state.mode
  // Drop unlocked entries: they were built from older fairness data.
  let next: SessionState = { ...state, queue: state.queue.filter(e => e.locked && entryAvailable(e, state.courts, state.nowMs)) }
  for (const court of next.courts) {
    if (court.match || !court.retainedPair || next.queue.some(entry => entry.courtNo === court.no)) continue
    if (state.nowMs !== undefined && !['open', 'unconfigured'].includes(courtAvailability(court, state.nowMs))) continue
    const retained = court.retainedPair.map(id => next.players.find(player => player.id === id))
    if (retained.some(player => !player)) continue
    const best = buildChallengerEntry([retained[0]!, retained[1]!],
      orderByPriority(freePlayers(next), next.clockMin), mode, pairingOptions(next))
    if (best) next = { ...next, queue: [...next.queue, {
      id: nextId(), teamA: best.teamA, teamB: best.teamB, gap: Math.round(best.gap), locked: false, courtNo: court.no,
    }] }
  }
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

/** Refresh attendance and saved ratings without replacing matches already on court. */
export function syncSessionPlayers(state: SessionState, incoming: SessionPlayer[], nextId: () => string): SessionState {
  const present = new Set(incoming.map(player => player.id))
  const active = new Set(onCourtIds(state))
  const previous = new Map(state.players.map(player => [player.id, player]))
  // Treat an older read as one snapshot: a match can also reset waiting players' streaks.
  const stale = incoming.some(player => player.seasonGames < (previous.get(player.id)?.seasonGames ?? 0))
  const players = incoming.map(player => {
    const old = previous.get(player.id)
    return {
      ...player,
      ...(stale && old ? { elo: old.elo, winStreak: old.winStreak, seasonGames: old.seasonGames, gamesToday: old.gamesToday, averageMinutes: old.averageMinutes, timedGames: old.timedGames } : {}),
      ...(old && (player.timedGames ?? 0) < (old.timedGames ?? 0)
        ? { averageMinutes: old.averageMinutes, timedGames: old.timedGames } : {}),
      freeAtMin: old?.freeAtMin ?? state.clockMin,
    }
  })
  // Keep an unchecked active player until their match is resolved; never mint a replacement match id.
  players.push(...state.players.filter(player => active.has(player.id) && !present.has(player.id)))
  const queue = state.queue.filter(entry => [...entry.teamA, ...entry.teamB].every(id => present.has(id)))
  return refillQueue({ ...state, players, queue }, nextId)
}

/** Reconcile server courts without overwriting a start whose outcome is still uncertain. */
export function syncSessionCourts(
  state: SessionState,
  incoming: readonly Court[],
  nextId: () => string,
  protectedMatchIds: readonly string[] = [],
): SessionState {
  const protectedIds = new Set(protectedMatchIds)
  const protectedCourt = (court: Court) => protectedIds.has(court.match?.id ?? court.retainedFromMatchId ?? '')
  const courts = incoming.map(court => {
    const old = state.courts.find(item => item.no === court.no)
    return old && protectedCourt(old) && !court.match && !court.retainedPair && !court.retainedFromMatchId
      ? { ...court, match: old.match, startedAt: old.startedAt, startedAtMin: old.startedAtMin, mode: old.mode, balanceWeight: old.balanceWeight,
        rotationMode: old.rotationMode, retainedPair: old.retainedPair, retainedFromMatchId: old.retainedFromMatchId }
      : court
  })
  courts.push(...state.courts.filter(court => protectedCourt(court)
    && !incoming.some(item => item.no === court.no)))
  const matchIds = new Set(courts.flatMap(court => court.match ? [court.match.id] : []))
  const queue = state.queue.filter(entry => !matchIds.has(entry.id) && entryAvailable(entry, courts, state.nowMs))
  return refillQueue({ ...state, courts, queue }, nextId)
}

export function sendToCourt(
  state: SessionState,
  entryIndex: number,
  nextId: () => string,
  options: { courtNo?: number; startedAt?: string; nowMin?: number } = {},
): SessionState {
  const startedAtMs = options.startedAt === undefined ? undefined : Date.parse(options.startedAt)
  if (startedAtMs !== undefined && !Number.isFinite(startedAtMs)) return state
  const entry = state.queue[entryIndex]
  if (!entry || !entryAvailable(entry, state.courts, startedAtMs ?? state.nowMs)) return state
  const courtIndex = state.courts.findIndex(court => {
    if (court.match || (options.courtNo !== undefined && court.no !== options.courtNo)) return false
    if (entry.courtNo !== undefined && court.no !== entry.courtNo) return false
    if (court.retainedPair && !keepsPair(entry, court.retainedPair)) return false
    if (startedAtMs === undefined) return court.startsAt == null && court.endsAt == null
    return ['open', 'unconfigured'].includes(courtAvailability(court, startedAtMs))
  })
  if (courtIndex < 0) return state
  const clockMin = Number.isFinite(options.nowMin) ? Math.max(state.clockMin, options.nowMin!) : state.clockMin
  const courts = state.courts.map((c, i) =>
    i === courtIndex ? { ...c, match: entry, startedAtMin: clockMin, startedAt: options.startedAt ?? null,
      rotationMode: state.rotationMode ?? 'all_out', retainedPair: null, retainedFromMatchId: null } : c,
  )
  const queue = state.queue.filter((_, i) => i !== entryIndex)
  return refillQueue({ ...state, clockMin, nowMs: startedAtMs ?? state.nowMs, courts, queue }, nextId)
}

export function finishMatch(
  state: SessionState,
  courtIndex: number,
  winner: MatchResult,
  nextId: () => string,
  nowMin?: number,
  elapsedMinutes?: number,
): SessionState {
  const court = state.courts[courtIndex]
  if (!court?.match) return state
  const { teamA, teamB } = court.match
  const won = winner === 'B' ? teamB : teamA
  const lost = winner === 'B' ? teamA : teamB

  const eloOf = (id: string) => state.players.find(p => p.id === id)!.elo
  const delta = eloDelta((eloOf(won[0]) + eloOf(won[1])) / 2, (eloOf(lost[0]) + eloOf(lost[1])) / 2, winner === 'draw' ? 0.5 : 1)

  const clockMin = nowMin === undefined ? state.clockMin + MATCH_MINUTES
    : Math.max(state.clockMin, Number.isFinite(nowMin) ? nowMin : state.clockMin)
  const playing = new Set([...teamA, ...teamB])
  const players = state.players.map(p => {
    if (!playing.has(p.id)) return p
    const onWinningSide = won.includes(p.id)
    const winStreak = winner !== 'draw' && onWinningSide ? (p.winStreak ?? 0) + 1 : 0
    const validDuration = elapsedMinutes !== undefined && Number.isFinite(elapsedMinutes) && elapsedMinutes > 0
    const priorTimedGames = Number.isInteger(p.timedGames) && p.timedGames! > 0
      && Number.isFinite(p.averageMinutes) && p.averageMinutes! > 0 ? p.timedGames! : 0
    return {
      ...p,
      elo: p.elo + (onWinningSide ? delta * streakMultiplier(winStreak) : -delta),
      winStreak,
      ...(validDuration ? {
        averageMinutes: ((priorTimedGames ? p.averageMinutes! * priorTimedGames : 0) + elapsedMinutes) / (priorTimedGames + 1),
        timedGames: priorTimedGames + 1,
      } : {}),
      seasonGames: p.seasonGames + 1,
      gamesToday: p.gamesToday + 1,
      freeAtMin: clockMin,
    }
  })

  const lastTeamedAt = { ...state.lastTeamedAt }
  for (const team of [teamA, teamB]) lastTeamedAt[partnerKey(team[0], team[1])] = state.playedCount

  const retain = winner !== 'draw' && (court.rotationMode ?? state.rotationMode ?? 'all_out') === 'winner_stays'
  const courts = state.courts.map((c, i) =>
    i === courtIndex ? { ...c, match: null, startedAtMin: null, startedAt: null,
      retainedPair: retain ? won : null, retainedFromMatchId: retain ? court.match!.id : null } : c,
  )

  return refillQueue(
    { ...state, clockMin, players, courts, lastTeamedAt, playedCount: state.playedCount + 1 },
    nextId,
  )
}

export function releaseRetainedPair(state: SessionState, courtIndex: number, nextId: () => string): SessionState {
  const court = state.courts[courtIndex]
  if (!court?.retainedPair || court.match) return state
  const courts = state.courts.map((item, index) => index === courtIndex
    ? { ...item, retainedPair: null, retainedFromMatchId: null } : item)
  const queue = state.queue.filter(entry => entry.courtNo !== court.no)
  return refillQueue({ ...state, courts, queue }, nextId)
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
