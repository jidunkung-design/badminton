import type { SupabaseClient } from '@supabase/supabase-js'

export const TEST_ROOM_PIN = '246810'
export const SEED_ROOM = '66666666-6666-6666-6666-666666666666'
export const OTHER_SEED_ROOM = '33333333-3333-3333-3333-333333333333'

/** Preserve only the seeded rooms' PIN configuration and existing request flags. */
export async function preserveSeedRoomPins(service: SupabaseClient, groupIds: string[]) {
  if (groupIds.some(id => ![SEED_ROOM, OTHER_SEED_ROOM].includes(id))) {
    throw new Error('PIN fixtures may only modify the two known seed rooms')
  }
  const snapshots = await Promise.all(groupIds.map(async groupId => {
    const [pin, requests] = await Promise.all([
      service.from('room_entry_pins').select('*').eq('group_id', groupId).maybeSingle(),
      service.from('room_join_requests').select('user_id,pin_verified').eq('group_id', groupId),
    ])
    if (pin.error) throw pin.error
    if (requests.error) throw requests.error
    return { groupId, pin: pin.data, requests: requests.data ?? [] }
  }))
  return async () => {
    for (const snapshot of snapshots) {
      const restored = snapshot.pin
        ? await service.from('room_entry_pins').upsert(snapshot.pin, { onConflict: 'group_id' })
        : await service.from('room_entry_pins').delete().eq('group_id', snapshot.groupId)
      if (restored.error) throw restored.error
      for (const request of snapshot.requests) {
        const result = await service.from('room_join_requests').update({ pin_verified: request.pin_verified })
          .eq('group_id', snapshot.groupId).eq('user_id', request.user_id)
        if (result.error) throw result.error
      }
    }
  }
}
