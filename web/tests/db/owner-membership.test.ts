import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { preserveSeedRoomPins, TEST_ROOM_PIN } from './room-pin-fixture'

it('keeps join requests private until the exact room owner approves and blocks insertion bypasses', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const owner = client(), strangerOwner = client(), guest = client(), manager = client()
  const groupId = '66666666-6666-6666-6666-666666666666'
  const otherGroup = '33333333-3333-3333-3333-333333333333'
  const users: string[] = []
  let manualPlayer: string | undefined
  let restorePins: (() => Promise<void>) | undefined
  try {
    expect((await owner.auth.signInWithPassword({ email: 'realowner@example.com', password: 'password123' })).error).toBeNull()
    expect((await strangerOwner.auth.signInWithPassword({ email: 'owner@example.com', password: 'password123' })).error).toBeNull()
    restorePins = await preserveSeedRoomPins(service, [groupId, otherGroup])
    expect((await owner.rpc('set_room_pin', { p_group_id: groupId, p_pin: TEST_ROOM_PIN })).error).toBeNull()
    expect((await strangerOwner.rpc('set_room_pin', { p_group_id: otherGroup, p_pin: TEST_ROOM_PIN })).error).toBeNull()
    for (const c of [guest, manager]) {
      const signed = await c.auth.signInAnonymously()
      expect(signed.error).toBeNull()
      users.push(signed.data.user!.id)
      expect((await c.rpc('claim_username', { p_username: `member_${crypto.randomUUID().slice(0, 8)}` })).error).toBeNull()
    }
    expect((await service.from('group_members').insert({ group_id: groupId, user_id: users[1], role: 'admin' })).error).toBeNull()
    expect((await guest.rpc('join_room', { p_group_id: groupId, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: groupId })
    expect((await guest.rpc('join_room', { p_group_id: groupId, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: groupId })
    expect((await guest.from('groups').select('id').eq('id', groupId)).data).toEqual([])
    expect((await service.from('group_members').select('user_id').eq('group_id', groupId).eq('user_id', users[0])).data).toEqual([])
    expect((await guest.from('room_join_requests').select('user_id').eq('group_id', groupId)).data).toEqual([{ user_id: users[0] }])
    expect((await manager.from('room_join_requests').select('user_id').eq('group_id', groupId)).data).toEqual([])
    expect((await strangerOwner.from('room_join_requests').select('user_id').eq('group_id', groupId)).data).toEqual([])
    expect((await owner.from('room_join_requests').select('username').eq('group_id', groupId).eq('user_id', users[0])).data?.[0]?.username).toMatch(/^member_/)
    for (const unauthorized of [guest, manager, strangerOwner]) {
      expect((await unauthorized.rpc('approve_room_member', { p_group_id: groupId, p_user_id: users[0] })).error?.message).toContain('owner_required')
      expect((await unauthorized.rpc('reject_room_member', { p_group_id: groupId, p_user_id: users[0] })).error?.message).toContain('owner_required')
      expect((await unauthorized.from('players').insert({ group_id: groupId, name: 'forbidden' })).error).not.toBeNull()
      expect((await unauthorized.from('group_members').insert({ group_id: groupId, user_id: users[0], role: 'member' })).error).not.toBeNull()
    }
    const approved = await Promise.all([0, 1].map(() => owner.rpc('approve_room_member', { p_group_id: groupId, p_user_id: users[0] })))
    expect(approved.every(result => !result.error && result.data === groupId)).toBe(true)
    expect((await guest.from('group_members').select('role').eq('group_id', groupId).eq('user_id', users[0]).single()).data?.role).toBe('member')
    expect((await guest.from('players').select('id').eq('group_id', groupId).eq('user_id', users[0])).data).toHaveLength(1)
    expect((await guest.from('room_join_requests').select('user_id').eq('group_id', groupId)).data).toEqual([])
    // Denied RLS updates can succeed with zero rows; verify the actual roles too.
    for (const unauthorized of [guest, manager]) {
      for (const target of [
        { id: '55555555-5555-5555-5555-555555555555', role: 'member', expected: 'owner' },
        { id: users[0], role: 'admin', expected: 'member' },
      ]) {
        const changed = await unauthorized.from('group_members').update({ role: target.role })
          .eq('group_id', groupId).eq('user_id', target.id).select('user_id')
        expect(changed.data ?? []).toHaveLength(0)
        expect((await service.from('group_members').select('role').eq('group_id', groupId).eq('user_id', target.id).single()).data?.role).toBe(target.expected)
      }
    }
    expect((await guest.rpc('join_room', { p_group_id: groupId, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: groupId })
    expect((await owner.rpc('approve_room_member', { p_group_id: groupId, p_user_id: '55555555-5555-5555-5555-555555555555' })).error).toBeNull()
    expect((await owner.from('group_members').select('role').eq('group_id', groupId).eq('user_id', '55555555-5555-5555-5555-555555555555').single()).data?.role).toBe('owner')

    const added = await owner.from('players').insert({ group_id: groupId, name: 'manual owner test' }).select('id').single()
    expect(added.error).toBeNull()
    manualPlayer = added.data!.id
    expect((await manager.from('players').update({ archived_at: new Date().toISOString() }).eq('id', manualPlayer).select('id')).data).toHaveLength(1)
    for (const c of [owner, manager]) {
      expect((await c.from('players').update({ user_id: users[1] }).eq('id', manualPlayer)).error).not.toBeNull()
      expect((await c.from('players').update({ group_id: otherGroup }).eq('id', manualPlayer)).error).not.toBeNull()
      expect((await c.from('group_members').update({ user_id: users[1] }).eq('group_id', groupId).eq('user_id', users[0])).error).not.toBeNull()
      expect((await c.from('group_members').update({ group_id: otherGroup }).eq('group_id', groupId).eq('user_id', users[0])).error).not.toBeNull()
    }
    expect((await guest.rpc('join_room', { p_group_id: otherGroup, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: otherGroup })
    expect((await strangerOwner.rpc('reject_room_member', { p_group_id: otherGroup, p_user_id: users[0] })).error).toBeNull()
    expect((await strangerOwner.rpc('reject_room_member', { p_group_id: otherGroup, p_user_id: users[0] })).error).toBeNull()
    expect((await guest.from('room_join_requests').select('user_id').eq('group_id', otherGroup)).data).toEqual([])
    expect((await strangerOwner.rpc('approve_room_member', { p_group_id: otherGroup, p_user_id: users[0] })).error?.message).toContain('join_request_required')
  } finally {
    if (restorePins) await restorePins()
    if (manualPlayer) await service.from('players').delete().eq('id', manualPlayer)
    for (const userId of users) {
      await service.from('players').delete().eq('user_id', userId)
      await service.auth.admin.deleteUser(userId)
    }
  }
}, 30_000)
