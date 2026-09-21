'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { validLockerOperation, type Locker, type OpenedChest } from '@/lib/cosmetics'

export async function updateLocker(operation: unknown, requestId: string): Promise<{ locker?: Locker; opened?: OpenedChest; error?: string; retry?: boolean }> {
  if (!validLockerOperation(operation) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId)) return { error: 'รายการไม่ถูกต้อง กรุณาโหลดหน้าใหม่' }
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'กรุณาเข้าห้องก่อนใช้งานตู้แต่งตัว' }
    const result = operation.kind === 'save'
      ? await supabase.rpc('save_mascot', { p_skin: operation.skin, p_hair: operation.hair, p_equipped: operation.equipped })
      : operation.kind === 'buyItem'
        ? await supabase.rpc('buy_cosmetic', { p_item_id: operation.target, p_request_id: requestId })
        : await supabase.rpc(operation.kind === 'buyChest' ? 'buy_chest' : 'open_chest', { p_tier: operation.target, p_request_id: requestId })
    if (result.error) {
      const message = result.error.message
      if (message.includes('insufficient_coins')) return { error: 'เหรียญยังไม่พอ เก็บเพิ่มจากการเล่นแมตช์ได้เลย' }
      if (message.includes('item_owned')) return { error: 'มีของชิ้นนี้อยู่ในกระเป๋าแล้ว' }
      if (message.includes('chest_empty')) return { error: 'ไม่มีกล่องประเภทนี้เหลือแล้ว' }
      if (result.error.code === 'P0001' || result.error.code === '22023') return { error: 'รายการนี้ใช้ไม่ได้ กรุณาโหลดหน้าใหม่เพื่อตรวจของในกระเป๋า' }
      if (result.error.code === 'PGRST202') return { error: 'ตู้แต่งตัวยังไม่พร้อมใช้งาน กรุณาลองอีกครั้งภายหลัง' }
      return { error: 'ยังยืนยันรายการไม่ได้ กดลองรายการเดิมเพื่อเช็กผลโดยไม่หักเหรียญซ้ำ', retry: true }
    }
    const { data, error } = await supabase.rpc('get_my_locker')
    if (error || !data) return { error: 'ทำรายการแล้ว แต่โหลดกระเป๋าไม่สำเร็จ กดลองรายการเดิมเพื่อดูผล', retry: true }
    revalidatePath('/', 'layout')
    return { locker: data as unknown as Locker, ...(operation.kind === 'openChest' ? { opened: result.data as unknown as OpenedChest } : {}) }
  } catch {
    return { error: 'การเชื่อมต่อขัดข้อง กดลองรายการเดิมเมื่อพร้อม ระบบจะไม่ทำรายการซ้ำ', retry: true }
  }
}
