import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { preserveSeedRoomPins, SEED_ROOM, TEST_ROOM_PIN } from './room-pin-fixture'

it('claims unique guest names, joins without elevation, and caps concurrent room creation at three', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const guest = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const owner = guest(), member = guest()
  const users: string[] = [], rooms: string[] = []
  let restorePins: (() => Promise<void>) | undefined
  const stamp = crypto.randomUUID().slice(0, 8)
  try {
    for (const client of [owner, member]) {
      const result = await client.auth.signInAnonymously()
      expect(result.error).toBeNull()
      users.push(result.data.user!.id)
    }
    expect((await owner.rpc('create_room', { p_pin: TEST_ROOM_PIN, p_name: 'No name yet', p_room_id: crypto.randomUUID() })).error?.message).toContain('username_required')
    expect((await owner.rpc('claim_username', { p_username: 'x' })).error?.message).toContain('username_invalid')
    expect((await owner.rpc('claim_username', { p_username: `  Guest${stamp}  ` })).data).toBe(`guest${stamp}`)
    expect((await owner.rpc('claim_username', { p_username: `Guest${stamp}` })).data).toBe(`guest${stamp}`)
    expect((await owner.rpc('claim_username', { p_username: `Other${stamp}` })).error?.message).toContain('username_locked')
    expect((await member.rpc('claim_username', { p_username: `GUEST${stamp}` })).error?.message).toContain('username_taken')
    expect((await member.rpc('claim_username', { p_username: `ผู้เล่น${stamp}` })).error).toBeNull()
    expect((await owner.from('profiles').update({ username: 'bypass' }).eq('id', users[0])).error).not.toBeNull()

    const initial = await admin.from('groups').select('id', { count: 'exact' })
    expect(initial.error).toBeNull()
    const roomId = crypto.randomUUID()
    const created = await owner.rpc('create_room', { p_pin: TEST_ROOM_PIN, p_name: 'ห้องทดสอบ', p_room_id: roomId })
    expect(created.error).toBeNull()
    rooms.push(roomId)
    expect(created.data).toBe(roomId)
    expect((await owner.rpc('create_room', { p_pin: TEST_ROOM_PIN, p_name: 'ห้องทดสอบ', p_room_id: roomId })).data).toBe(roomId)
    expect((await member.rpc('create_room', { p_pin: TEST_ROOM_PIN, p_name: 'ห้องทดสอบ', p_room_id: roomId })).error?.message).toContain('room_id_unavailable')
    expect((await member.from('groups').select('id').eq('id', roomId)).data).toEqual([])
    expect((await member.rpc('join_room', { p_group_id: roomId, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: roomId })
    expect((await member.rpc('join_room', { p_group_id: roomId, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: roomId })
    expect((await member.from('groups').select('id').eq('id', roomId)).data).toEqual([])
    expect((await owner.rpc('approve_room_member', { p_group_id: roomId, p_user_id: users[1] })).error).toBeNull()
    expect((await member.from('group_members').select('role').eq('group_id', roomId).eq('user_id', users[1]).single()).data?.role).toBe('member')
    expect((await member.from('players').insert({ group_id: roomId, name: 'forbidden' })).error).not.toBeNull()
    expect((await owner.from('seasons').select('id').eq('group_id', roomId).is('ended_at', null)).data).toHaveLength(1)

    // Release our room (only test-owned rows) so concurrent calls compete for
    // at least one slot even when the two standard seed rooms already exist.
    expect((await admin.from('groups').delete().eq('id', roomId)).error).toBeNull()
    rooms.splice(rooms.indexOf(roomId), 1)
    const attempts = await Promise.all(Array.from({ length: 4 }, async () => {
      const id = crypto.randomUUID()
      const result = await owner.rpc('create_room', { p_pin: TEST_ROOM_PIN, p_name: 'ห้องเพิ่ม', p_room_id: id })
      if (!result.error) rooms.push(id)
      return result
    }))
    expect(attempts.filter(result => !result.error)).toHaveLength(3 - initial.count!)
    expect(attempts.filter(result => result.error).every(result => result.error?.message.includes('group_cap'))).toBe(true)
    expect((await admin.from('groups').select('id', { count: 'exact', head: true })).count).toBe(3)
    const anotherRoom = rooms[1] ?? SEED_ROOM
    expect(anotherRoom).toBeTruthy()
    if (anotherRoom) {
      expect((await member.rpc('join_room', { p_group_id: rooms[0], p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: rooms[0] })
      expect((await owner.rpc('approve_room_member', { p_group_id: rooms[0], p_user_id: users[1] })).error).toBeNull()
      expect((await member.from('players').select('id').eq('group_id', anotherRoom)).data).toEqual([])
      const approver = rooms.includes(anotherRoom) ? owner : guest()
      if (approver !== owner) {
        const email = anotherRoom === '33333333-3333-3333-3333-333333333333' ? 'owner@example.com' : 'realowner@example.com'
        expect((await approver.auth.signInWithPassword({ email, password: 'password123' })).error).toBeNull()
      }
      if (approver !== owner) {
        restorePins = await preserveSeedRoomPins(admin, [anotherRoom])
        expect((await approver.rpc('set_room_pin', { p_group_id: anotherRoom, p_pin: TEST_ROOM_PIN })).error).toBeNull()
      }
      expect((await member.rpc('join_room', { p_group_id: anotherRoom, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: anotherRoom })
      expect((await approver.rpc('approve_room_member', { p_group_id: anotherRoom, p_user_id: users[1] })).error).toBeNull()
      const players = await member.from('players').select('id, group_id').eq('user_id', users[1])
      expect(players.data).toHaveLength(2)
      expect(new Set(players.data!.map(player => player.id)).size).toBe(2)
    }
  } finally {
    if (restorePins) await restorePins()
    for (const id of rooms) await admin.from('groups').delete().eq('id', id)
    for (const id of users) {
      await admin.from('players').delete().eq('user_id', id)
      await admin.auth.admin.deleteUser(id)
    }
  }
}, 30_000)
