'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'

export async function addPlayer(formData: FormData) {
  const groupId = String(formData.get('groupId'))
  const name = String(formData.get('name') ?? '').trim()
  const skill = Number(formData.get('skill') ?? 3)
  if (!name) return { error: 'กรุณากรอกชื่อ' }
  const supabase = await createServerSupabase()
  // No client-side permission check: the RLS policy is the gate.
  const { error } = await supabase.from('players').insert({ group_id: groupId, name, skill })
  if (error) return { error: 'เพิ่มสมาชิกไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
  revalidatePath(`/g/${groupId}/members`)
  return { error: null }
}

export async function archivePlayer(formData: FormData) {
  const groupId = String(formData.get('groupId'))
  const playerId = String(formData.get('playerId'))
  const supabase = await createServerSupabase()
  // Archive only. There is no delete path anywhere in this app.
  const { error } = await supabase
    .from('players')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', playerId)
  if (error) return { error: 'เก็บเข้ากรุไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
  revalidatePath(`/g/${groupId}/members`)
  return { error: null }
}
