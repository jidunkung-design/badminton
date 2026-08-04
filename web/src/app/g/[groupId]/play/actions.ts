'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import type { QueueMode } from '@/domain/types'

export async function openSession(groupId: string) {
  const supabase = await createServerSupabase()
  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await supabase
    .from('sessions').select('id').eq('group_id', groupId).eq('played_on', today).maybeSingle()
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
  const supabase = await createServerSupabase()
  if (present) {
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('attendance').upsert({ session_id: sessionId, player_id: playerId })
    if (error) return { error: 'เช็กชื่อไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
    // last_seen_on drives the 90 day dormancy rule.
    await supabase.from('players').update({ last_seen_on: today, archived_at: null }).eq('id', playerId)
  } else {
    const { error } = await supabase
      .from('attendance')
      .delete()
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
    if (error) return { error: 'ยกเลิกเช็กชื่อไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
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
  winnerTeam: 1 | 2
}

export async function recordMatch(input: RecordMatchInput) {
  const supabase = await createServerSupabase()
  // record_match (0006_record_match_rpc.sql) inserts the match row and its
  // four match_players rows in one transaction, so a failure partway through
  // can never leave the append-only matches table holding a match with no
  // roster. client_id stays unique, and the function upserts around it, so
  // this call is idempotent: replaying the same clientId is a no-op.
  const { error } = await supabase.rpc('record_match', {
    p_client_id: input.clientId,
    p_session_id: input.sessionId,
    p_group_id: input.groupId,
    p_court_no: input.courtNo,
    p_mode: input.mode,
    p_balance_weight: input.balanceWeight,
    p_winner_team: input.winnerTeam,
    p_team_a: input.teamA,
    p_team_b: input.teamB,
  })

  if (error) return { error: 'บันทึกผลไม่สำเร็จ' }
  revalidatePath(`/g/${input.groupId}/play`)
  return { error: null }
}
