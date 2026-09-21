'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { roleInGroup } from '@/lib/roles'

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export async function addPlayer(formData: FormData) {
  const groupId = String(formData.get('groupId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const skill = Number(formData.get('skill') ?? 3)
  const gender = formData.get('gender')
  if (!UUID.test(groupId)) return { error: 'ห้องไม่ถูกต้อง' }
  if (!name) return { error: 'ยังไม่ได้ใส่ชื่อ' }
  if (!Number.isInteger(skill) || skill < 1 || skill > 7) return { error: 'ระดับฝีมือต้องเป็นจำนวนเต็ม 1–7' }
  if (gender !== 'male' && gender !== 'female' && gender !== 'unspecified') return { error: 'เลือกเพศสำหรับจัดคู่ หรือเลือกไม่ระบุ' }
  if (await roleInGroup(groupId) !== 'owner') return { error: 'เจ้าของห้องเท่านั้นที่เพิ่มสมาชิกได้' }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('players').insert({ group_id: groupId, name, skill, gender })
  if (error) return { error: 'เพิ่มสมาชิกไม่สำเร็จ กรุณาลองใหม่' }
  revalidatePath(`/g/${groupId}/members`)
  return { error: null }
}

export async function setPlayerGender(formData: FormData) {
  const groupId = String(formData.get('groupId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const gender = formData.get('gender')
  if (!UUID.test(groupId) || !UUID.test(playerId)) return { error: 'ข้อมูลสมาชิกไม่ถูกต้อง' }
  if (gender !== 'male' && gender !== 'female' && gender !== 'unspecified') return { error: 'เลือกเพศสำหรับจัดคู่ หรือเลือกไม่ระบุ' }
  try {
    if (await roleInGroup(groupId) !== 'owner') return { error: 'เจ้าของห้องเท่านั้นที่แก้ไขเพศสำหรับจัดคู่ได้' }
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_player_gender', { p_group_id: groupId, p_player_id: playerId, p_gender: gender })
    if (error) return { error: 'บันทึกเพศสำหรับจัดคู่ไม่สำเร็จ กรุณาลองใหม่' }
  } catch {
    return { error: 'เชื่อมต่อไม่ได้ กรุณาลองบันทึกอีกครั้ง' }
  }
  revalidatePath(`/g/${groupId}/members`)
  revalidatePath(`/g/${groupId}/play`)
  return { error: null }
}

export async function archivePlayer(formData: FormData) {
  const groupId = String(formData.get('groupId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  if (!UUID.test(groupId) || !UUID.test(playerId)) return { error: 'ข้อมูลสมาชิกไม่ถูกต้อง' }
  const supabase = await createServerSupabase()
  // Archive only. Admins keep this permission; the database enforces it.
  const { data, error } = await supabase.from('players')
    .update({ archived_at: new Date().toISOString() }).eq('id', playerId).eq('group_id', groupId).select('id').maybeSingle()
  if (error || !data) return { error: 'เก็บเข้ากรุไม่สำเร็จ คุณอาจไม่มีสิทธิ์จัดการก๊วนนี้' }
  revalidatePath(`/g/${groupId}/members`)
  return { error: null }
}

export async function reviewJoinRequest(formData: FormData) {
  const groupId = String(formData.get('groupId') ?? '')
  const userId = String(formData.get('userId') ?? '')
  const decision = formData.get('decision')
  if (!UUID.test(groupId) || !UUID.test(userId) || (decision !== 'approve' && decision !== 'reject')) {
    return { error: 'คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่' }
  }
  if (await roleInGroup(groupId) !== 'owner') return { error: 'เจ้าของห้องเท่านั้นที่จัดการคำขอได้' }
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc(decision === 'approve' ? 'approve_room_member' : 'reject_room_member', {
    p_group_id: groupId, p_user_id: userId,
  })
  if (error) return { error: 'จัดการคำขอไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' }
  revalidatePath(`/g/${groupId}/members`)
  revalidatePath(`/g/${groupId}`)
  revalidatePath(`/join/${groupId}`)
  revalidatePath('/')
  return { error: null }
}

export async function setRoomPin(_previous: { error?: string; success?: string }, formData: FormData): Promise<{ error?: string; success?: string }> {
  const groupId = String(formData.get('groupId') ?? '')
  const pin = String(formData.get('pin') ?? '')
  const confirmation = String(formData.get('pinConfirmation') ?? '')
  if (!UUID.test(groupId)) return { error: 'ห้องไม่ถูกต้อง' }
  if (!/^[0-9]{6}$/.test(pin)) return { error: 'กรอก PIN เป็นตัวเลข 6 หลัก' }
  if (pin !== confirmation) return { error: 'PIN ทั้งสองช่องไม่ตรงกัน' }
  try {
    if (await roleInGroup(groupId) !== 'owner') return { error: 'เจ้าของห้องเท่านั้นที่ตั้ง PIN ได้' }
    const supabase = await createServerSupabase()
    const { error } = await supabase.rpc('set_room_pin', { p_group_id: groupId, p_pin: pin })
    if (error) return { error: 'บันทึก PIN ไม่สำเร็จ กรุณาลองใหม่' }
  } catch {
    return { error: 'เชื่อมต่อไม่ได้ กรุณาลองบันทึก PIN อีกครั้ง' }
  }
  revalidatePath(`/g/${groupId}/members`)
  revalidatePath(`/g/${groupId}`)
  revalidatePath(`/join/${groupId}`)
  return { success: 'บันทึก PIN แล้ว แจ้ง PIN ใหม่ให้เพื่อนแยกจากลิงก์เชิญ ผู้ที่ยังรออนุมัติต้องกรอก PIN ใหม่อีกครั้ง' }
}
