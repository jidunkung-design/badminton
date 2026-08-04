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
  if (!season) return { sessionId: null, error: 'ก๊วนนี้ยังไม่มีซีซั่นที่เปิดอยู่' }

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

export async function toggleAttendance(sessionId: string, playerId: string, present: boolean) {
  const supabase = await createServerSupabase()
  if (present) {
    const today = new Date().toISOString().slice(0, 10)
    await supabase.from('attendance').upsert({ session_id: sessionId, player_id: playerId })
    // last_seen_on drives the 90 day dormancy rule.
    await supabase.from('players').update({ last_seen_on: today, archived_at: null }).eq('id', playerId)
  } else {
    await supabase.from('attendance').delete().eq('session_id', sessionId).eq('player_id', playerId)
  }
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
  // client_id is unique, so replaying a queued offline write is a no-op.
  const { data, error } = await supabase
    .from('matches')
    .insert({
      client_id: input.clientId,
      session_id: input.sessionId,
      group_id: input.groupId,
      court_no: input.courtNo,
      mode: input.mode,
      balance_weight: input.balanceWeight,
      winner_team: input.winnerTeam,
      ended_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: null } // already recorded
    return { error: 'บันทึกผลไม่สำเร็จ' }
  }

  const rows = [
    ...input.teamA.map(id => ({ match_id: data.id, player_id: id, team: 1 })),
    ...input.teamB.map(id => ({ match_id: data.id, player_id: id, team: 2 })),
  ]
  const { error: linkError } = await supabase.from('match_players').insert(rows)
  if (linkError) return { error: 'บันทึกรายชื่อผู้เล่นไม่สำเร็จ' }
  revalidatePath(`/g/${input.groupId}/play`)
  return { error: null }
}
