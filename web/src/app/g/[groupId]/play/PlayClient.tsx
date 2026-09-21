'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, toast } from '@heroui/react'
import { MatchRatingSummary } from '@/components/match-rating-summary'
import type { Court, MatchResult, QueueEntry, RotationMode, SessionPlayer } from '@/domain/types'
import {
  refillQueue,
  sendToCourt,
  finishMatch,
  freePlayers,
  syncSessionPlayers,
  syncSessionCourts,
  releaseRetainedPair,
  type SessionState,
} from '@/domain/queue'
import { recordMatch, startMatch, releaseCourtPair, getPairHeadToHead, type PairHeadToHead, type MatchReward } from './actions'
import type { RatingChange } from '@/domain/rating'
import { blendedRating, streakMultiplier } from '@/domain/rating'
import { genderCompositionDifference } from '@/domain/pairing'
import { Mascot } from '@/components/mascot'
import { GenderIcon } from '@/components/gender-selector'
import { CourtScene } from '@/components/court-scene'
import type { MascotAppearance } from '@/lib/cosmetics'
import { courtAvailability, estimateMatchMinutes } from '@/domain/duration'
import CourtSettings, { RotationSettings, courtBooking, courtTime } from './CourtSettings'

const nextId = () => crypto.randomUUID()

export default function PlayClient({
  groupId,
  sessionId,
  players,
  names,
  mascots,
  courts,
  attendingIds,
  playedOn,
  initialNow,
  rotationMode,
}: {
  groupId: string
  sessionId: string
  players: SessionPlayer[]
  /** player id -> display name. Kept out of SessionPlayer so the domain layer stays about numbers. */
  names: Record<string, string>
  mascots: Record<string, MascotAppearance>
  courts: Court[]
  attendingIds: string[]
  playedOn: string
  initialNow: string
  rotationMode: RotationMode
}) {
  const midnight = Date.parse(`${playedOn}T00:00:00+07:00`)
  const clockAt = (iso: string) => (Date.parse(iso) - midnight) / 60_000
  const [now, setNow] = useState(() => Date.parse(initialNow))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const [state, setState] = useState<SessionState>(() =>
    refillQueue(
      {
        clockMin: clockAt(initialNow),
        nowMs: Date.parse(initialNow),
        courts: courts.map(court => ({ ...court, startedAtMin: court.startedAt ? clockAt(court.startedAt) : null })),
        queue: [],
        players: players.map(player => ({ ...player, freeAtMin: clockAt(initialNow) })),
        mode: 'mix',
        rotationMode,
        balanceWeight: 0.5,
        rejected: new Set(),
        lastTeamedAt: {},
        playedCount: 0,
      },
      nextId,
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(false)
  const [pending, setPending] = useState(false)
  const [attempted, setAttempted] = useState<{ matchId: string; winner: MatchResult } | null>(null)
  const [ratingChanges, setRatingChanges] = useState<RatingChange[] | null>(null)
  const [rewards, setRewards] = useState<MatchReward[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [synced, setSynced] = useState({ players, courts, attendingIds, rotationMode, initialNow })
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null)
  const [startAttempt, setStartAttempt] = useState<{ entry: QueueEntry; courtNo: number } | null>(null)
  const [completedIds, setCompletedIds] = useState<string[]>([])
  const [heldResults, setHeldResults] = useState<Record<number, { id: string; savedAt: string }>>({})
  const [releasedIds, setReleasedIds] = useState<string[]>([])
  const [lastResults, setLastResults] = useState<Record<number, { id: string; teamA: [string, string]; teamB: [string, string]; winner: MatchResult }>>({})
  const [summaryDraw, setSummaryDraw] = useState(false)
  const [pendingLabel, setPendingLabel] = useState('กำลังบันทึก…')
  const [headToHead, setHeadToHead] = useState<{ key: string; data?: PairHeadToHead; error?: string } | null>(null)
  useEffect(() => {
    if (!Object.keys(lastResults).length) return
    const timer = window.setTimeout(() => setLastResults({}), 8000)
    return () => window.clearTimeout(timer)
  }, [lastResults])
  const present = new Set(attendingIds)

  // Only new server props trigger reconciliation; clock ticks never rebuild the queue.
  // Keep uncertain operations retryable and ignore a late snapshot of a locally completed match.
  if (!pending && (synced.players !== players || synced.courts !== courts || synced.attendingIds !== attendingIds || synced.rotationMode !== rotationMode || synced.initialNow !== initialNow)) {
    setSynced({ players, courts, attendingIds, rotationMode, initialNow })
    const incoming = courts.map(court => ({
      ...court,
      ...(completedIds.includes(court.match?.id ?? '') ? { match: null, startedAt: null, startedAtMin: null }
        : { startedAtMin: court.startedAt ? clockAt(court.startedAt) : null }),
      ...(releasedIds.includes(court.retainedFromMatchId ?? '') ? { retainedPair: null, retainedFromMatchId: null } : {}),
    }))
    const staleHolds = Object.fromEntries(Object.entries(heldResults).filter(([, held]) => initialNow <= held.savedAt))
    const protectedIds = [attempted?.matchId, startAttempt?.entry.id, ...Object.values(staleHolds).map(held => held.id)].filter((id): id is string => Boolean(id))
    setState(current => {
      const merged = syncSessionCourts({ ...current, rotationMode, nowMs: now, clockMin: Math.max(current.clockMin, (now - midnight) / 60_000) }, incoming, nextId, protectedIds)
      const active = new Set(merged.courts.flatMap(court => court.match ? [...court.match.teamA, ...court.match.teamB] : court.retainedPair ?? []))
      return syncSessionPlayers(merged, players.filter(player => present.has(player.id) || active.has(player.id)), nextId)
    })
    if (Object.keys(staleHolds).length !== Object.keys(heldResults).length) setHeldResults(staleHolds)
    if (startAttempt && incoming.some(court => court.match?.id === startAttempt.entry.id)) {
      setStartAttempt(null)
      setError(null)
    }
  }

  // Rebuild only when a booking boundary is crossed, never on each timer tick.
  if (!pending && !attempted && !startAttempt && state.courts.some(court =>
    [court.startsAt, court.endsAt].some(value => value && Date.parse(value) > (state.nowMs ?? now) && Date.parse(value) <= now))) {
    setState(current => refillQueue({ ...current, nowMs: now, clockMin: (now - midnight) / 60_000 }, nextId))
  }

  const availableCourts = state.courts.filter(court => !court.match && ['open', 'unconfigured'].includes(courtAvailability(court, now)))
  const canUseCourt = (entry: QueueEntry, court: Court) => entry.courtNo === undefined ? !court.retainedPair : entry.courtNo === court.no
  const upcoming = startAttempt?.entry ?? state.queue.find(entry => availableCourts.some(court => canUseCourt(entry, court))) ?? state.queue[0]
  const eligibleCourts = upcoming ? availableCourts.filter(court => canUseCourt(upcoming, court)) : []
  const targetCourt = startAttempt?.courtNo ?? (eligibleCourts.some(court => court.no === selectedCourt) ? selectedCourt : eligibleCourts[0]?.no ?? null)
  const unresolvedStart = Boolean(startAttempt && !state.courts.some(court => court.match?.id === startAttempt.entry.id))
  const headToHeadKey = upcoming ? JSON.stringify([upcoming.teamA, upcoming.teamB]) : ''
  useEffect(() => {
    if (!headToHeadKey) return
    let cancelled = false
    const [teamA, teamB] = JSON.parse(headToHeadKey) as [[string, string], [string, string]]
    void getPairHeadToHead(groupId, teamA, teamB).then(result => {
      if (!cancelled) setHeadToHead({ key: headToHeadKey, ...result })
    }).catch(() => {
      if (!cancelled) setHeadToHead({ key: headToHeadKey, error: 'โหลดสถิติการเจอกันไม่สำเร็จ' })
    })
    return () => { cancelled = true }
  }, [groupId, headToHeadKey])

  function reportError(message: string) {
    setError(message)
    toast.danger(message)
  }

  async function dispatch() {
    if (saving.current || attempted) return
    const entry = startAttempt?.entry ?? upcoming
    const courtNo = startAttempt?.courtNo ?? targetCourt
    if (!entry || courtNo === null) return
    if (!startAttempt && (![...entry.teamA, ...entry.teamB].every(id => present.has(id)) || (entry.courtNo !== undefined && entry.courtNo !== courtNo))) {
      reportError('ตรวจสอบรายชื่อและสนามของทีมที่อยู่ต่อก่อนเริ่มเกม')
      return
    }
    const court = state.courts.find(court => court.no === courtNo)
    if (!startAttempt && (!court || court.match || !['open', 'unconfigured'].includes(courtAvailability(court, Date.now())))) {
      reportError('สนามนี้ยังไม่พร้อมใช้งาน กรุณาเลือกสนามที่อยู่ในเวลาจอง')
      return
    }
    saving.current = true
    setPending(true)
    setPendingLabel('กำลังยืนยันเริ่มเกม…')
    setError(null)
    setStartAttempt({ entry, courtNo })
    setState(current => ({ ...current, queue: current.queue.map(item => item.id === entry.id ? { ...item, locked: true } : item) }))
    try {
      const result = await startMatch({
        clientId: entry.id, groupId, sessionId, courtNo, mode: state.mode,
        balanceWeight: state.balanceWeight, teamA: entry.teamA, teamB: entry.teamB,
      })
      if (result.error || !result.startedAt) {
        if (result.retry === false) {
          setStartAttempt(null)
          setState(current => refillQueue({ ...current, queue: current.queue.map(item => item.id === entry.id ? { ...item, locked: false } : item) }, nextId))
          reportError(result.error ?? 'เริ่มเกมไม่ได้ กรุณาตรวจสอบสนามและรายชื่อ')
        } else {
          reportError(`${result.error ?? 'ยังยืนยันเวลาเริ่มไม่ได้'} ลองยืนยันเกมเดิมอีกครั้งค่ะ`)
        }
        return
      }
      const base = {
        ...state,
        nowMs: Date.parse(result.startedAt),
        courts: state.courts.map(item => item.no === courtNo ? { ...item, mode: state.mode, balanceWeight: state.balanceWeight, rotationMode: state.rotationMode, match: null, startedAt: null, startedAtMin: null } : item),
        queue: [{ ...entry, locked: true }, ...state.queue.filter(item => item.id !== entry.id)],
      }
      setState(sendToCourt(base, 0, nextId, { courtNo, startedAt: result.startedAt, nowMin: clockAt(result.startedAt) }))
      setHeldResults(previous => Object.fromEntries(Object.entries(previous).filter(([no]) => Number(no) !== courtNo)))
      toast.success(`เริ่มเกมสนาม ${courtNo} แล้ว`)
      // Keep this id protected until the refreshed server props acknowledge the start.
    } catch {
      reportError('ยังยืนยันการเริ่มเกมไม่ได้ ลองยืนยันเกมเดิมอีกครั้ง จะไม่สร้างแมตช์ซ้ำค่ะ')
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  async function finish(courtIndex: number, winner: MatchResult) {
    if (saving.current || unresolvedStart) return
    const court = state.courts[courtIndex]
    if (!court.match) return
    if (attempted && (attempted.matchId !== court.match.id || attempted.winner !== winner)) return
    const { teamA, teamB } = court.match
    // The queue entry's own id is stable for this match's whole lifetime
    // (assigned once in refillQueue, unchanged by sendToCourt/finishMatch),
    // unlike a fresh nextId() call here which would mint a new value on
    // every invocation -- including retries -- and defeat the
    // matches.client_id unique constraint this call relies on for
    // idempotency. This is the exact key phase 4's offline outbox will
    // replay against, so it has to be stable now.
    const clientId = court.match.id
    saving.current = true
    setAttempted({ matchId: clientId, winner })
    setPendingLabel('กำลังบันทึกผลการแข่งขัน…')
    setPending(true)
    setError(null)
    try {
      const result = await recordMatch({
        clientId,
        sessionId,
        groupId,
        courtNo: court.no,
        mode: court.mode ?? state.mode,
        balanceWeight: court.balanceWeight ?? state.balanceWeight,
        teamA,
        teamB,
        winnerTeam: winner === 'A' ? 1 : winner === 'B' ? 2 : 0,
      })
      if (result.error) {
        reportError(`${result.error} เกมยังอยู่ในสนาม กรุณากดบันทึกผลเดิมอีกครั้งค่ะ`)
        return
      }
      // Only the saved court snapshot may retain players; a failed summary read
      // leaves the court clear until refreshed props arrive.
      const finishedAt = result.snapshotAt ? Date.parse(result.snapshotAt) : now
      const finishState = { ...state, nowMs: finishedAt, courts: state.courts.map((item, index) => index === courtIndex
        ? { ...item, rotationMode: result.rotationMode ?? 'all_out' as const } : item) }
      const next = finishMatch(finishState, courtIndex, winner, nextId, (finishedAt - midnight) / 60_000)
      const retained = result.retainedCourt
      next.courts[courtIndex] = { ...next.courts[courtIndex],
        retainedPair: retained?.retained_pair?.length === 2 ? retained.retained_pair as [string, string] : null,
        retainedFromMatchId: retained?.retained_match_id ?? null }
      if (next.courts[courtIndex].retainedPair && retained?.retained_match_id && result.snapshotAt) {
        setHeldResults(previous => ({ ...previous, [court.no]: { id: retained.retained_match_id!, savedAt: result.snapshotAt! } }))
      } else setHeldResults(previous => Object.fromEntries(Object.entries(previous).filter(([no]) => Number(no) !== court.no)))
      setLastResults(previous => ({ ...previous, [court.no]: { id: clientId, teamA, teamB, winner } }))
      setSummaryDraw(winner === 'draw')
      setRewards(result.rewards ?? null)
      setNotice(result.notice ?? null)
      setRatingChanges(result.ratingChanges ?? [...teamA, ...teamB].map(id => ({
        id,
        before: state.players.find(player => player.id === id)!.elo,
        after: next.players.find(player => player.id === id)!.elo,
        winStreak: next.players.find(player => player.id === id)!.winStreak ?? 0,
        multiplier: streakMultiplier(next.players.find(player => player.id === id)!.winStreak ?? 0),
      })))
      if (result.standings) {
        const saved = new Map(result.standings.map(player => [player.id, player]))
        next.players = next.players.map(player => {
          const standing = saved.get(player.id)
          return standing ? { ...player, elo: standing.elo, winStreak: standing.winStreak, seasonGames: standing.seasonGames } : player
        })
      }
      if (result.durations) {
        const durations = new Map(result.durations.map(player => [player.player_id, player]))
        next.players = next.players.map(player => {
          const duration = durations.get(player.id)
          return duration ? { ...player, averageMinutes: duration.average_minutes, timedGames: duration.timed_games } : player
        })
      }
      setState(syncSessionPlayers(next, players.filter(player => present.has(player.id)), nextId))
      setCompletedIds(previous => [...previous, clientId])
      if (startAttempt?.entry.id === clientId) setStartAttempt(null)
      setAttempted(null)
      if (result.notice) toast.warning('บันทึกผลแล้ว แต่โหลดสรุปไม่ครบ', { description: result.notice })
      else toast.success(`บันทึก${winner === 'draw' ? 'ผลเสมอ' : 'ผลการแข่งขัน'}สนาม ${court.no} แล้ว`)
    } catch {
      reportError('ยังยืนยันการบันทึกไม่ได้ เกมยังอยู่ในสนาม ลองบันทึกผลเดิมอีกครั้งค่ะ')
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  async function release(courtIndex: number) {
    if (saving.current || attempted || startAttempt) return
    const court = state.courts[courtIndex]
    if (!court.retainedFromMatchId) return
    saving.current = true
    setPending(true)
    setPendingLabel('กำลังให้ทีมออกจากสนาม…')
    setError(null)
    try {
      const result = await releaseCourtPair(groupId, sessionId, court.no, court.retainedFromMatchId)
      if (result.error) { reportError(result.error); return }
      setState(current => releaseRetainedPair(current, courtIndex, nextId))
      if (court.retainedFromMatchId) setReleasedIds(previous => [...previous, court.retainedFromMatchId!])
      setHeldResults(previous => Object.fromEntries(Object.entries(previous).filter(([no]) => Number(no) !== court.no)))
      toast.success(`ให้ทีมออกจากสนาม ${court.no} แล้ว`)
    } catch {
      reportError('ยังยืนยันการออกจากสนามไม่ได้ กรุณาลองอีกครั้ง')
    } finally {
      saving.current = false
      setPending(false)
    }
  }

  const name = (id: string) => names[id] ?? id
  const genderBadge = (id: string) => <GenderIcon gender={state.players.find(player => player.id === id)?.gender} />
  const teamAverage = (ids: readonly string[]) => {
    const members = ids.map(id => state.players.find(player => player.id === id))
    if (members.some(player => !player)) return '—'
    return Math.round(members.reduce((total, player) => total + blendedRating(player!.elo, player!.seasonGames, player!.skill), 0) / members.length)
  }
  const genderNote = (entry: QueueEntry) => {
    const genders = (ids: readonly string[]) => ids.map(id => state.players.find(player => player.id === id)?.gender)
    const difference = genderCompositionDifference(genders(entry.teamA), genders(entry.teamB))
    if (difference === null) return <p className="text-xs text-muted">ยังระบุเพศไม่ครบ · จับคู่ตามเรตและลำดับคิว</p>
    if (difference > 0) return <p className="text-xs text-orange-700">สัดส่วนเพศของสองทีมต่างกัน · จัดตามผู้เล่นว่าง ลำดับคิว และทีมที่อยู่ต่อ</p>
    return <p className="text-xs text-muted">สัดส่วนเพศของสองทีมสมดุล</p>
  }
  const sceneTeam = (ids: readonly string[]) => ids.map(id => ({ id, name: name(id), appearance: mascots[id] }))
  const estimateLabel = (ids: readonly string[]) => {
    const estimate = estimateMatchMinutes(ids, state.players)
    return estimate.knownPlayers === 0 ? `ประมาณ ${estimate.minutes.toFixed(1)} นาที · ค่าเริ่มต้น ยังไม่มีประวัติจับเวลา`
      : `ประมาณ ${estimate.minutes.toFixed(1)} นาที · เฉลี่ยจาก ${estimate.knownPlayers} คนที่มีประวัติจับเวลา`
  }
  const availabilityLabel = { open: 'พร้อมใช้งาน', upcoming: 'ยังไม่ถึงเวลาจอง', closed: 'หมดเวลาจอง', unconfigured: 'ยังไม่ตั้งเวลาจอง' }

  const team = (ids: readonly [string, string], large = false) => (
    <div className="min-w-0 space-y-3">
      {ids.map(id => {
        const player = state.players.find(player => player.id === id)
        return (
          <div key={id} className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Mascot appearance={mascots[id]} portrait className={`shrink-0 rounded-full ${large ? 'size-9 sm:size-11' : 'size-8'}`} label={`มาสคอตของ ${name(id)}`} />
            <span className="min-w-0">
              <span className={`block break-words font-semibold ${large ? 'text-sm sm:text-base' : 'text-sm'}`}>{name(id)}{genderBadge(id)}{(player?.winStreak ?? 0) >= 2 && <span className="ml-2 whitespace-nowrap text-xs font-semibold text-orange-700">🔥 {player?.winStreak}</span>}</span>
              <span className="block text-xs text-muted">{player?.averageMinutes ? `เฉลี่ย ${player.averageMinutes.toFixed(1)} นาที (${player.timedGames ?? 0} เกม)` : 'ยังไม่มีเวลาที่จับจริง'}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
  const waiting = freePlayers(state)
  const absentActive = state.courts.flatMap(court => court.match ? [...court.match.teamA, ...court.match.teamB] : [])
    .filter(id => !present.has(id))

  return (
    <div className="space-y-8">
      {error && <div className="rounded-2xl bg-danger/10 p-4 text-danger" role="alert">{error}</div>}
      {absentActive.length > 0 && <p className="rounded-2xl bg-warning/10 p-4 text-sm" role="alert">มีผู้เล่นที่อยู่ในสนามถูกนำออกจากรายชื่อวันนี้: {absentActive.map(name).join(', ')} กรุณาเช็กชื่อกลับก่อนบันทึกผล แมตช์เดิมยังอยู่ค่ะ</p>}
      {unresolvedStart && <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
        <p className="mb-3 text-sm">กำลังรอยืนยันเกมเดิมในสนาม {startAttempt!.courtNo} กรุณายืนยันอีกครั้งก่อนจัดเกมถัดไป</p>
        <Button variant="outline" isDisabled={pending} onPress={dispatch}>ลองยืนยันเริ่มเกมเดิม</Button>
      </div>}
      <section aria-labelledby="courts-heading">
        {ratingChanges && <div className="mb-6"><MatchRatingSummary changes={ratingChanges} names={names}
          description={summaryDraw ? 'ผลเสมอปรับ Elo ตามความคาดหมาย และเริ่ม Win Streak ใหม่' : 'คะแนนอันดับในซีซั่นนี้ รวมโบนัส Win Streak ของแต่ละคน'} /></div>}
        {notice && <p role="status" className="mb-4 rounded-xl bg-accent/10 p-4 text-sm">{notice}</p>}
        {rewards && <section aria-label="รางวัลหลังจบแมตช์" className="mb-6 rounded-2xl border border-accent/20 bg-surface p-5">
          <h3 className="font-semibold">รางวัลหลังจบแมตช์</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">{rewards.map(reward => <li key={reward.player_id} className="text-sm">
            <span className="font-semibold">{name(reward.player_id)}</span> · +{reward.coins} เหรียญ · กล่อง {reward.chest_tier}
            {reward.multiplier > 1 && <span className="text-orange-700"> · 🔥 ×{reward.multiplier}</span>}
            {reward.bonus > 0 && <span className="block text-xs text-muted">รวมโบนัสเข้าร่วมวันนี้ +{reward.bonus} เหรียญ</span>}
          </li>)}</ul>
          {rewards.length < 4 && <p className="mt-3 text-xs text-muted">ผู้เล่นที่ยังไม่มีบัญชีจะเริ่มรับของเมื่อเข้าร่วมด้วยชื่อผู้ใช้ของตัวเอง</p>}
          <a href="/mascot" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">เปิดกระเป๋าและแต่ง mascot</a>
        </section>}
        {pending && <p role="status" className="mb-4 text-sm text-muted">{pendingLabel}</p>}
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="courts-heading" className="text-xl font-semibold">สนามวันนี้</h2>
          <span className="text-sm text-muted">{state.courts.filter(c => c.match).length} จาก {state.courts.length} สนามกำลังเล่น</span>
        </div>
        <RotationSettings groupId={groupId} sessionId={sessionId} mode={rotationMode}
          disabled={pending || state.courts.some(court => Boolean(court.match)) || Boolean(startAttempt) || Boolean(attempted) || Object.keys(heldResults).length > 0} />
        {state.courts.length === 0 && <p className="mb-4 text-sm text-muted">เพิ่มสนามและเวลาจองก่อนเริ่มเกม</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {state.courts.map((court, i) => (
            court.match ? (
              <article key={court.no} className="overflow-hidden rounded-3xl border border-accent/25 bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-accent px-5 py-4 text-accent-foreground">
                  <h3 className="font-semibold">สนาม {court.no}</h3>
                  <span className="flex items-center gap-2 text-sm"><span className="size-2 rounded-full bg-current" />กำลังเล่น</span>
                </div>
                <div className="space-y-5 p-5 sm:p-6">
                  <CourtScene teamA={sceneTeam(court.match.teamA)} teamB={sceneTeam(court.match.teamB)} phase="playing" />
                  <p className="text-xs text-muted">{[...court.match.teamA, ...court.match.teamB].map(id => {
                    const average = state.players.find(player => player.id === id)?.averageMinutes
                    return `${name(id)} ${average ? `เฉลี่ย ${average.toFixed(1)} นาที` : 'ยังไม่มีเวลาที่จับจริง'}`
                  }).join(' · ')}</p>
                  <p className="text-center text-xs text-muted">เรตทีมต่างกัน {court.match.gap} แต้ม · จอง {courtBooking(court)}</p>
                  <div className="rounded-2xl bg-background p-4 text-sm">
                    {court.startedAt ? <p>เริ่ม {courtTime(court.startedAt)} · เล่นมา <strong className="tabular-nums">{Math.max(0, (now - Date.parse(court.startedAt)) / 60_000).toFixed(1)}</strong> นาที</p> : <p>ยังไม่มีเวลาเริ่มจริง</p>}
                    <p className="mt-1 text-muted">{estimateLabel([...court.match.teamA, ...court.match.teamB])}</p>
                    {court.startedAt && <p className="mt-1">คาดว่าจบ {courtTime(new Date(Date.parse(court.startedAt) + estimateMatchMinutes([...court.match!.teamA, ...court.match!.teamB], state.players).minutes * 60_000).toISOString())}</p>}
                    {court.endsAt && court.startedAt && Date.parse(court.startedAt) + estimateMatchMinutes([...court.match.teamA, ...court.match.teamB], state.players).minutes * 60_000 > Date.parse(court.endsAt) && <p className="mt-2 text-orange-700">เกมนี้อาจเล่นเกินเวลาจอง</p>}
                    {courtAvailability(court, now) === 'closed' && <p className="mt-2 text-orange-700">หมดเวลาจองแล้ว ยังบันทึกผลของเกมนี้ได้</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="secondary" isDisabled={pending || unresolvedStart || Boolean(attempted && (attempted.matchId !== court.match.id || attempted.winner !== 'A'))} onPress={() => finish(i, 'A')}>ทีมซ้ายชนะ</Button>
                    <Button variant="secondary" isDisabled={pending || unresolvedStart || Boolean(attempted && (attempted.matchId !== court.match.id || attempted.winner !== 'B'))} onPress={() => finish(i, 'B')}>ทีมขวาชนะ</Button>
                    <Button variant="outline" className="col-span-2" isDisabled={pending || unresolvedStart || Boolean(attempted && (attempted.matchId !== court.match.id || attempted.winner !== 'draw'))} onPress={() => finish(i, 'draw')}>เสมอ / หมดเวลา</Button>
                  </div>
                </div>
              </article>
            ) : (
              <article key={court.no} className="flex min-h-60 flex-col rounded-3xl border border-dashed border-foreground/20 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">สนาม {court.no}</h3>
                  <span className="rounded-full bg-foreground/5 px-3 py-1 text-xs text-muted">{availabilityLabel[courtAvailability(court, now)]}</span>
                </div>
                {lastResults[court.no] && <div className="mt-4"><CourtScene teamA={sceneTeam(lastResults[court.no].teamA)} teamB={sceneTeam(lastResults[court.no].teamB)}
                  phase="result" winner={lastResults[court.no].winner} resultId={lastResults[court.no].id} /></div>}
                {court.retainedPair && <div className="mt-4 space-y-3 rounded-2xl bg-accent/10 p-4">
                  <p className="text-sm font-semibold">ทีมชนะอยู่ต่อ · รอคู่ท้าชิง</p>
                  {team(court.retainedPair)}
                  {!court.retainedPair.every(id => present.has(id)) && <p className="text-sm text-orange-700">ทีมนี้เช็กชื่อไม่ครบ กรุณาเช็กชื่อกลับ หรือให้ทีมออกจากสนาม</p>}
                  <Button variant="outline" size="sm" isDisabled={pending || Boolean(startAttempt) || Boolean(attempted)} onPress={() => release(i)}>ให้ทีมออกจากสนาม</Button>
                </div>}
                <div className="my-auto py-8 text-center">
                  <p className="text-lg font-semibold">{courtBooking(court)}</p>
                  <p className="mt-2 text-sm text-muted">{['open', 'unconfigured'].includes(courtAvailability(court, now)) ? (courtAvailability(court, now) === 'unconfigured' ? 'สนามนี้ยังไม่จำกัดเวลาจอง ตั้งเวลาได้ด้านล่าง' : 'เลือกสนามนี้จากคิวเพื่อเริ่มเกม') : 'เริ่มเกมได้เฉพาะในช่วงเวลาจอง'}</p>
                </div>
                <CourtSettings groupId={groupId} sessionId={sessionId} court={court} disabled={pending || Boolean(startAttempt) || Boolean(attempted)} />
              </article>
            )
          ))}
        </div>
        <details className="mt-4 rounded-2xl border border-foreground/15 bg-surface p-5">
          <summary className="cursor-pointer font-semibold">เพิ่มสนาม</summary>
          <div className="mt-4 max-w-lg"><CourtSettings groupId={groupId} sessionId={sessionId}
            court={{ no: Math.max(0, ...state.courts.map(court => court.no)) + 1, match: null, startedAtMin: null }}
            disabled={pending || Boolean(startAttempt) || Boolean(attempted)} /></div>
        </details>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="queue-heading" className="space-y-4">
          <h2 id="queue-heading" className="text-xl font-semibold">คิวถัดไป <span className="ml-2 text-base font-normal text-muted">{state.queue.length} แมตช์</span></h2>
          {state.queue.length === 0 && <p className="rounded-2xl bg-surface p-6 text-sm text-muted">รอผู้เล่นว่างอย่างน้อย 4 คน แล้วระบบจะจัดคิวให้</p>}
          {state.queue.map((entry, i) => (
            <article key={entry.id} className={`space-y-5 rounded-3xl border bg-surface p-5 sm:p-6 ${entry.id === upcoming?.id ? 'border-accent/30' : 'border-foreground/10'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-accent">{entry.id === upcoming?.id ? 'คู่ถัดไป' : `คิวที่ ${i + 1}`}{entry.courtNo !== undefined ? ` · สนาม ${entry.courtNo}` : ''}</h3>
                <span className="text-xs text-muted">เรตทีมต่างกัน {entry.gap} แต้ม</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                <div className="min-w-0 space-y-3"><h4 className="text-xs font-semibold text-muted">ทีม A · เรตจัดคู่เฉลี่ย {teamAverage(entry.teamA)}</h4>{team(entry.teamA)}</div>
                <span className="text-xs font-semibold text-muted">VS</span>
                <div className="min-w-0 space-y-3"><h4 className="text-xs font-semibold text-muted">ทีม B · เรตจัดคู่เฉลี่ย {teamAverage(entry.teamB)}</h4>{team(entry.teamB)}</div>
              </div>
              {genderNote(entry)}
              <p className="text-xs text-muted">{estimateLabel([...entry.teamA, ...entry.teamB])}</p>
              {entry.id === upcoming?.id && <div className="space-y-3">
                <div className="rounded-xl bg-background p-3 text-sm" aria-live="polite">
                  <p className="font-semibold">การเจอกันของสองทีมนี้ · ประวัติทั้งห้อง</p>
                  {headToHead?.key !== headToHeadKey ? <p className="mt-1 text-muted">กำลังโหลด…</p> : headToHead.error ? <p className="mt-1 text-muted">{headToHead.error}</p>
                    : headToHead.data && <div className="mt-3 grid gap-3 text-muted md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
                      <div className="md:border-r md:border-foreground/10 md:pr-4"><p className="font-semibold text-foreground">เจอกัน {headToHead.data.played} ครั้ง</p><p className="text-xs">เสมอ {headToHead.data.draws} ครั้ง</p></div>
                      <div className="min-w-0"><p className="break-words text-xs">{entry.teamA.map(name).join(' + ')}</p><p className="mt-1 font-semibold text-foreground">ชนะ {headToHead.data.team_a_wins} / แพ้ {headToHead.data.team_b_wins}</p></div>
                      <div className="min-w-0"><p className="break-words text-xs">{entry.teamB.map(name).join(' + ')}</p><p className="mt-1 font-semibold text-foreground">ชนะ {headToHead.data.team_b_wins} / แพ้ {headToHead.data.team_a_wins}</p></div>
                    </div>}
                </div>
                <label className="block text-sm font-semibold">เลือกสนาม
                  <select className="mt-2 min-h-12 w-full rounded-xl border border-foreground/20 bg-background px-3 font-normal" value={targetCourt ?? ''}
                    disabled={pending || Boolean(startAttempt) || Boolean(attempted)} onChange={event => setSelectedCourt(Number(event.target.value))}>
                    {eligibleCourts.length === 0 && <option value="">ไม่มีสนามว่างที่พร้อมใช้งาน</option>}
                    {eligibleCourts.map(court => <option key={court.no} value={court.no}>สนาม {court.no} · {courtBooking(court)}</option>)}
                  </select>
                </label>
                {availableCourts.some(court => court.no === targetCourt) && <p className="text-xs text-muted">ถ้าเริ่มตอนนี้ คาดว่าจบ {courtTime(new Date(now + estimateMatchMinutes([...entry.teamA, ...entry.teamB], state.players).minutes * 60_000).toISOString())}</p>}
                {targetCourt !== null && state.courts.find(court => court.no === targetCourt)?.endsAt
                  && now + estimateMatchMinutes([...entry.teamA, ...entry.teamB], state.players).minutes * 60_000 > Date.parse(state.courts.find(court => court.no === targetCourt)!.endsAt!)
                  && <p className="text-sm text-orange-700">เกมนี้คาดว่าจะจบหลังหมดเวลาจอง กรุณาเผื่อเวลาก่อนเริ่ม</p>}
                <Button fullWidth isDisabled={targetCourt === null || pending || Boolean(startAttempt) || Boolean(attempted) || ![...entry.teamA, ...entry.teamB].every(id => present.has(id))} onPress={dispatch}>ยืนยันเริ่มเกม</Button>
              </div>}
            </article>
          ))}
        </section>
        <section className="rounded-3xl border border-foreground/10 bg-surface p-5 sm:p-6">
          <h2 className="text-xl font-semibold">ผู้เล่นว่าง <span className="text-base font-normal text-muted">{waiting.length} คน</span></h2>
          {waiting.length === 0 && <p className="mt-4 text-sm text-muted">ทุกคนอยู่ในสนามหรือมีคิวแล้ว</p>}
          <ol className="mt-3 divide-y divide-foreground/10">
            {waiting.map(p => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <Mascot appearance={mascots[p.id]} portrait className="size-9 shrink-0 rounded-full" label={`มาสคอตของ ${name(p.id)}`} />
                <div className="min-w-0 flex-1"><p className="break-words font-semibold">{name(p.id)}{genderBadge(p.id)}</p><p className="text-xs text-muted">เล่นแล้ว {p.gamesToday} เกม · {p.averageMinutes ? `เฉลี่ย ${p.averageMinutes.toFixed(1)} นาที (${p.timedGames ?? 0} เกมที่จับเวลา)` : 'ยังไม่มีเวลาที่จับจริง'}</p></div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
