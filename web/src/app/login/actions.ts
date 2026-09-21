'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'

function roomError(message: string) {
  if (message.includes('username_taken')) return 'ชื่อนี้มีคนใช้แล้ว ลองใช้ชื่ออื่นนะคะ'
  if (message.includes('username_locked')) return 'เบราว์เซอร์นี้มีชื่อผู้ใช้แล้ว กรุณาโหลดหน้าใหม่เพื่อใช้ชื่อเดิม'
  if (message.includes('username_invalid')) return 'ใช้ชื่อ 2–30 ตัวอักษร ตัวเลข ขีดกลาง หรือขีดล่าง โดยไม่มีเว้นวรรค'
  if (message.includes('group_cap')) return 'ตอนนี้ครบ 3 ห้องแล้ว เข้าร่วมห้องเดิมผ่านลิงก์เชิญได้ค่ะ'
  if (message.includes('pin_locked')) return 'กรอก PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่'
  if (message.includes('pin_not_configured')) return 'ห้องนี้ยังไม่ได้ตั้ง PIN กรุณาให้เจ้าของห้องตั้ง PIN ก่อน'
  if (message.includes('pin_invalid')) return 'PIN ไม่ถูกต้อง กรุณาตรวจสอบกับเจ้าของห้อง'
  if (message.includes('room_not_found')) return 'ไม่พบห้องนี้ กรุณาตรวจสอบลิงก์เชิญ'
  return 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง'
}

export type EnterRoomState = { error?: string; destination?: string }

export async function enterRoom(_previous: EnterRoomState, form: FormData): Promise<EnterRoomState> {
  const username = String(form.get('username') ?? '').trim().normalize('NFC')
  const intent = form.get('intent')
  const gender = form.get('gender')
  const pin = String(form.get('pin') ?? '')
  const roomId = String(form.get('roomId') ?? '')
  const roomName = String(form.get('roomName') ?? '').trim() || `ก๊วนของ ${username}`
  if (!/^[A-Za-z0-9ก-๙_-]+$/u.test(username) || [...username].length < 2 || [...username].length > 30) {
    return { error: roomError('username_invalid') }
  }
  if ((intent !== 'create' && intent !== 'join') || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(roomId)) {
    return { error: 'ลิงก์ห้องไม่ถูกต้อง กรุณาเปิดหน้าใหม่' }
  }
  if (!/^[0-9]{6}$/.test(pin)) return { error: 'กรอก PIN เป็นตัวเลข 6 หลัก' }
  if (gender !== 'male' && gender !== 'female' && gender !== 'unspecified') return { error: 'เลือกเพศสำหรับจัดคู่ หรือเลือกไม่ระบุ' }
  if (intent === 'create' && [...roomName].length > 80) return { error: 'ชื่อห้องต้องไม่เกิน 80 ตัวอักษร' }

  let destination: string
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      const { error } = await supabase.auth.signInAnonymously({ options: { data: { display_name: username } } })
      if (error) return { error: error.code === 'anonymous_provider_disabled'
        ? 'ระบบยังไม่เปิดให้เข้าด้วยชื่อเล่น กรุณาให้ผู้ดูแลเปิดการเข้าร่วมแบบไม่ใช้อีเมล'
        : 'เริ่มใช้งานไม่สำเร็จ กรุณาลองอีกครั้งในอีกสักครู่' }
    }
    const { error: nameError } = await supabase.rpc('claim_username', { p_username: username })
    if (nameError) return { error: roomError(nameError.message) }
    const { error: genderError } = await supabase.rpc('set_profile_gender', { p_gender: gender })
    if (genderError) return { error: 'บันทึกเพศสำหรับจัดคู่ไม่สำเร็จ กรุณาลองใหม่' }
    if (intent === 'join') {
      const { data, error } = await supabase.rpc('join_room', { p_group_id: roomId, p_pin: pin })
      if (error) return { error: roomError(error.message) }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: roomError('') }
      if (typeof data.error === 'string') return { error: roomError(data.error) }
      if (data.room_id !== roomId) return { error: roomError('') }
      destination = `/join/${roomId}`
    } else {
      const { data, error } = await supabase.rpc('create_room', { p_name: roomName, p_room_id: roomId, p_pin: pin })
      if (error || typeof data !== 'string' || data.toLowerCase() !== roomId.toLowerCase()) return { error: roomError(error?.message ?? '') }
      destination = `/g/${roomId}`
    }
  } catch {
    return { error: 'เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง' }
  }
  revalidatePath('/')
  return { destination }
}
