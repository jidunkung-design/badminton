'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import type { QueueMode, RotationMode } from '@/domain/types'
import { getGroupStandings } from '@/lib/group-standings'
import { playingDate } from '@/lib/playing-date'
import { canManage } from '@/lib/roles'

export async function openSession(groupId: string) {
  const supabase = await createServerSupabase()
  const today = playingDate()
  // Keep overnight games/bookings in their original playing day after midnight.
  const { data: active } = await supabase.from('active_court_matches').select('session_id')
    .eq('group_id', groupId).order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (active) return { sessionId: active.session_id, error: null }
  const now = new Date().toISOString()
  const { data: booked } = await supabase.from('session_courts').select('session_id, sessions!inner(group_id)')
    .eq('sessions.group_id', groupId).lte('starts_at', now).gt('ends_at', now)
    .order('starts_at', { ascending: false }).limit(1).maybeSingle()
  if (booked) return { sessionId: booked.session_id, error: null }
  const { data: existing } = await supabase
    .from('sessions').select('id').eq('group_id', groupId).eq('played_on', today)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (existing) return { sessionId: existing.id, error: null }

  const { data: season } = await supabase
    .from('seasons').select('id').eq('group_id', groupId).is('ended_at', null).maybeSingle()
  if (!season) return { sessionId: null, error: 'ก๊วนนี้ยังไม่ได้เปิดซีซั่น' }

  const { data, error } = await supabase
    .from('sessions')
    .insert({ group_id: groupId, season_id: season.id, played_on: today })
    .select('id').single()
  if (error) return { sessionId: null, error: 'เปิดวันเล่นไม่สำเร็จ' }
  // No revalidatePath here: openSession runs directly inside PlayPage's render
  // (not dispatched as a mutation from a client event), and Next 16 now
  // throws "used during render which is unsupported" if you call it there.
  // The page already reads fresh data on this same render pass.
  return { sessionId: data.id, error: null }
}

export async function toggleAttendance(
  groupId: string,
  sessionId: string,
  playerId: string,
  present: boolean,
) {
  if (!await canManage(groupId)) return { error: 'คุณไม่มีสิทธิ์จัดการรายชื่อก๊วนนี้แล้ว' }
  const supabase = await createServerSupabase()
  if (present) {
    const today = playingDate()
    const { error } = await supabase.from('attendance').upsert({ session_id: sessionId, player_id: playerId })
    if (error) return { error: 'เช็กชื่อไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
    // last_seen_on drives the 90 day dormancy rule.
    await supabase.from('players').update({ last_seen_on: today, archived_at: null }).eq('id', playerId)
  } else {
    const { data: removed, error } = await supabase
      .from('attendance')
      .delete()
      .eq('session_id', sessionId)
      .eq('player_id', playerId).select('player_id').maybeSingle()
    if (error) return { error: 'ยกเลิกเช็กชื่อไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
    if (!removed) {
      // A hidden row is not a successful checkout. An already-absent retry is
      // safe only while the caller can still manage this exact session.
      if (!await canManage(groupId)) return { error: 'คุณไม่มีสิทธิ์จัดการรายชื่อก๊วนนี้แล้ว' }
      const { data: session, error: sessionError } = await supabase.from('sessions').select('id')
        .eq('id', sessionId).eq('group_id', groupId).maybeSingle()
      if (sessionError || !session) return { error: 'ไม่พบวันเล่นนี้ หรือคุณไม่มีสิทธิ์จัดการ' }
      const { data: remaining, error: readError } = await supabase.from('attendance').select('player_id')
        .eq('session_id', sessionId).eq('player_id', playerId).maybeSingle()
      if (readError || remaining) return { error: 'ยังยืนยันการยกเลิกเช็กชื่อไม่ได้ กรุณาลองอีกครั้ง' }
    }
  }
  revalidatePath(`/g/${groupId}/play`)
  return { error: null }
}

export interface RecordMatchInput {
  clientId: string
  sessionId: string
  groupId: string
  courtNo: number
  mode: QueueMode
  balanceWeight: number
  teamA: [string, string]
  teamB: [string, string]
  winnerTeam: 0 | 1 | 2
}

export interface MatchReward {
  player_id: string
  coins: number
  bonus: number
  chest_tier: string
  win_streak: number
  multiplier: number
}

export interface PlayerDuration {
  player_id: string
  average_minutes: number
  timed_games: number
}

function matchArgs(input: Omit<RecordMatchInput, 'winnerTeam'>) {
  return {
    p_client_id: input.clientId, p_session_id: input.sessionId, p_group_id: input.groupId,
    p_court_no: input.courtNo, p_mode: input.mode, p_balance_weight: input.balanceWeight,
    p_team_a: input.teamA, p_team_b: input.teamB,
  }
}

export async function startMatch(input: Omit<RecordMatchInput, 'winnerTeam'>): Promise<{ startedAt?: string; error: string | null; retry?: boolean }> {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('begin_match', matchArgs(input))
    if (error || !data) {
      const retry = error?.code !== 'P0001' && error?.code !== '22023'
      revalidatePath(`/g/${input.groupId}/play`)
      return { retry, error: error?.message.includes('court_unavailable')
        ? 'สนามยังไม่ถึงเวลาจองหรือหมดเวลาจองแล้ว'
        : 'เริ่มเกมไม่สำเร็จ ตรวจสอบเวลาจอง สนามว่าง และรายชื่อผู้เล่น' }
    }
    revalidatePath(`/g/${input.groupId}/play`)
    return { startedAt: data, error: null }
  } catch {
    return { error: 'ยังยืนยันการเริ่มเกมไม่ได้ กรุณาลองคู่เดิมอีกครั้ง', retry: true }
  }
}

export async function saveCourt(_previous: { error?: string; success?: string }, form: FormData): Promise<{ error?: string; success?: string }> {
  const groupId = String(form.get('groupId') ?? '')
  const sessionId = String(form.get('sessionId') ?? '')
  const courtNo = Number(form.get('courtNo'))
  const startsTime = String(form.get('startsTime') ?? '')
  const endsTime = String(form.get('endsTime') ?? '')
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
  const time = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!uuid.test(groupId) || !uuid.test(sessionId) || !Number.isInteger(courtNo) || courtNo < 1 || courtNo > 32767
    || !time.test(startsTime) || !time.test(endsTime)) return { error: 'ระบุหมายเลขสนามและเวลาเริ่ม–สิ้นสุดให้ครบ' }
  try {
    const supabase = await createServerSupabase()
    const { data: session, error: sessionError } = await supabase.from('sessions').select('played_on')
      .eq('id', sessionId).eq('group_id', groupId).single()
    if (sessionError || !session) return { error: 'ไม่พบวันเล่นนี้ หรือคุณไม่มีสิทธิ์จัดการ' }
    const startsAt = new Date(`${session.played_on}T${startsTime}:00+07:00`)
    const endsAt = new Date(`${session.played_on}T${endsTime}:00+07:00`)
    if (endsAt <= startsAt) endsAt.setTime(endsAt.getTime() + 24 * 60 * 60_000)
    const { error } = await supabase.rpc('save_session_court', {
      p_group_id: groupId, p_session_id: sessionId, p_court_no: courtNo,
      p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(),
    })
    if (error) return { error: error.message.includes('court_busy')
      ? 'สนามนี้กำลังเล่นอยู่ จบแมตช์ก่อนเปลี่ยนเวลาจองนะคะ'
      : 'บันทึกสนามไม่สำเร็จ ตรวจสอบเวลาและสิทธิ์จัดการก๊วน' }
    revalidatePath(`/g/${groupId}/play`)
    return { success: `บันทึกเวลาจองสนาม ${courtNo} แล้ว` }
  } catch { return { error: 'เชื่อมต่อไม่ได้ กรุณาลองบันทึกสนามอีกครั้ง' } }
}

export async function recordMatch(input: RecordMatchInput) {
  const supabase = await createServerSupabase()
  // record_match (0006_record_match_rpc.sql) inserts the match row and its
  // four match_players rows in one transaction, so a failure partway through
  // can never leave the append-only matches table holding a match with no
  // roster. client_id stays unique, and the function upserts around it, so
  // this call is idempotent: replaying the same clientId is a no-op.
  const { data: matchId, error } = await supabase.rpc('record_match', { ...matchArgs(input), p_winner_team: input.winnerTeam })

  if (error || !matchId) return { error: 'บันทึกผลไม่สำเร็จ' }
  // A summary read failure must never make a committed game look unsaved.
  const snapshotAt = new Date().toISOString()
  const [rewardRead, ratingRead, durationRead, rotationRead, courtRead] = await Promise.allSettled([
    supabase.rpc('get_match_rewards', { p_match_id: matchId }),
    getGroupStandings(input.groupId, undefined, matchId),
    supabase.rpc('get_player_durations', { p_group_id: input.groupId }),
    supabase.from('matches').select('rotation_mode').eq('id', matchId).single(),
    supabase.from('session_courts').select('retained_pair, retained_match_id').eq('session_id', input.sessionId).eq('court_no', input.courtNo).single(),
  ])
  const rewards = rewardRead.status === 'fulfilled' && !rewardRead.value.error
    ? rewardRead.value.data as unknown as MatchReward[] : undefined
  const standings = ratingRead.status === 'fulfilled' && !ratingRead.value.error ? ratingRead.value : undefined
  const durations = durationRead.status === 'fulfilled' && !durationRead.value?.error
    ? durationRead.value?.data as PlayerDuration[] | undefined : undefined
  const savedMode = rotationRead.status === 'fulfilled' && !rotationRead.value.error ? rotationRead.value.data?.rotation_mode : undefined
  const rotationMode: RotationMode | undefined = savedMode === 'all_out' || savedMode === 'winner_stays' ? savedMode : undefined
  const retainedCourt = courtRead.status === 'fulfilled' && !courtRead.value.error ? courtRead.value.data ?? undefined : undefined
  revalidatePath(`/g/${input.groupId}/play`)
  revalidatePath(`/g/${input.groupId}`)
  revalidatePath('/mascot')
  return {
    error: null, matchId, rotationMode, retainedCourt, snapshotAt, rewards, ratingChanges: standings?.ratingChanges, standings: standings?.players, durations,
    notice: !rewards || !standings || !rotationMode || !retainedCourt ? 'บันทึกเกมและรางวัลแล้ว แต่โหลดสรุปหรือสถานะสนามไม่ครบ กรุณารีเฟรชเพื่อตรวจสอบ' : undefined,
  }
}

export async function saveRotation(_previous: { error?: string; success?: string }, form: FormData): Promise<{ error?: string; success?: string }> {
  const groupId = String(form.get('groupId') ?? '')
  const sessionId = String(form.get('sessionId') ?? '')
  const mode = String(form.get('rotationMode') ?? '')
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
  if (!uuid.test(groupId) || !uuid.test(sessionId) || !['all_out', 'winner_stays'].includes(mode)) return { error: 'เลือกวิธีเวียนสนามให้ถูกต้อง' }
  try {
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_session_rotation', { p_group_id: groupId, p_session_id: sessionId, p_rotation_mode: mode })
    if (error) return { error: error.message.includes('session_busy') ? 'รอให้ทุกสนามจบเกมก่อนเปลี่ยนวิธีเวียนสนาม' : 'บันทึกวิธีเวียนสนามไม่สำเร็จ กรุณาลองใหม่' }
    revalidatePath(`/g/${groupId}/play`)
    return { success: 'บันทึกวิธีเวียนสนามแล้ว' }
  } catch { return { error: 'เชื่อมต่อไม่ได้ กรุณาลองบันทึกอีกครั้ง' } }
}

export async function releaseCourtPair(groupId: string, sessionId: string, courtNo: number, retainedMatchId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('release_retained_pair', { p_group_id: groupId, p_session_id: sessionId, p_court_no: courtNo, p_retained_match_id: retainedMatchId })
    revalidatePath(`/g/${groupId}/play`)
    if (error) return { error: error.message.includes('retained_pair_changed') ? 'ทีมที่อยู่ต่อเปลี่ยนแล้ว กรุณาตรวจสอบสนามอีกครั้ง' : error.message.includes('court_busy') ? 'สนามกำลังเล่นอยู่ จบเกมก่อนให้ทีมออกจากสนาม' : 'ยังปล่อยทีมออกจากสนามไม่ได้ กรุณาลองใหม่' }
    return { error: null }
  } catch { return { error: 'ยังยืนยันการออกจากสนามไม่ได้ กรุณาลองอีกครั้ง' } }
}

export interface PairHeadToHead { played: number; team_a_wins: number; team_b_wins: number; draws: number }

export async function getPairHeadToHead(groupId: string, teamA: [string, string], teamB: [string, string]): Promise<{ data?: PairHeadToHead; error?: string }> {
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('get_pair_head_to_head', { p_group_id: groupId, p_team_a: teamA, p_team_b: teamB })
    if (error || !data?.[0]) return { error: 'โหลดสถิติการเจอกันไม่สำเร็จ' }
    return { data: data[0] }
  } catch { return { error: 'โหลดสถิติการเจอกันไม่สำเร็จ' } }
}
