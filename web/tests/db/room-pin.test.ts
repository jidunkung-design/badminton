import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { preserveSeedRoomPins, SEED_ROOM, TEST_ROOM_PIN } from './room-pin-fixture'

it('requires a private PIN before requesting membership and persists room-wide lockout across identities', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const owner = client(), otherOwner = client(), guest = client(), anotherGuest = client()
  const userIds: string[] = []
  let restorePins: (() => Promise<void>) | undefined
  const pinState = async () => {
    const result = await service.from('room_entry_pins').select('*').eq('group_id', SEED_ROOM).single()
    expect(result.error).toBeNull()
    return result.data!
  }
  const join = async (c = guest, pin: string | null = TEST_ROOM_PIN) => {
    const result = await c.rpc('join_room', { p_group_id: SEED_ROOM, p_pin: pin })
    // PIN errors must return normally so the failed-attempt update commits.
    expect(result.error).toBeNull()
    return result.data
  }
  try {
    expect((await owner.auth.signInWithPassword({ email: 'realowner@example.com', password: 'password123' })).error).toBeNull()
    expect((await otherOwner.auth.signInWithPassword({ email: 'owner@example.com', password: 'password123' })).error).toBeNull()
    restorePins = await preserveSeedRoomPins(service, [SEED_ROOM])
    for (const c of [guest, anotherGuest]) {
      const signed = await c.auth.signInAnonymously()
      expect(signed.error).toBeNull()
      userIds.push(signed.data.user!.id)
      expect((await c.rpc('claim_username', { p_username: `pin_${crypto.randomUUID().slice(0, 8)}` })).error).toBeNull()
    }

    // Simulate an existing room without a configured PIN, preserving its state.
    expect((await service.from('room_entry_pins').delete().eq('group_id', SEED_ROOM)).error).toBeNull()
    expect((await owner.rpc('room_pin_configured', { p_group_id: SEED_ROOM })).data).toBe(false)
    expect(await join()).toEqual({ error: 'pin_not_configured' })
    expect((await guest.from('room_join_requests').select('user_id').eq('group_id', SEED_ROOM)).data).toEqual([])
    expect((await guest.from('groups').select('id').eq('id', SEED_ROOM)).data).toEqual([])
    expect((await guest.rpc('join_room', { p_group_id: SEED_ROOM })).error).not.toBeNull()
    expect((await guest.rpc('create_room', { p_name: 'No PIN', p_room_id: crypto.randomUUID() })).error).not.toBeNull()
    expect((await client().rpc('join_room', { p_group_id: SEED_ROOM, p_pin: TEST_ROOM_PIN })).error).not.toBeNull()
    for (const pin of ['12345', '1234567', '１２３４５６', 'abc123', ' 12345']) {
      expect((await owner.rpc('set_room_pin', { p_group_id: SEED_ROOM, p_pin: pin })).error?.message).toContain('pin_invalid')
      expect((await guest.rpc('create_room', { p_name: 'Invalid PIN', p_room_id: crypto.randomUUID(), p_pin: pin })).error?.message).toContain('pin_invalid')
    }
    expect((await owner.rpc('set_room_pin', { p_group_id: SEED_ROOM, p_pin: TEST_ROOM_PIN })).data).toBe(SEED_ROOM)
    expect((await owner.rpc('room_pin_configured', { p_group_id: SEED_ROOM })).data).toBe(true)
    const firstHash = (await pinState()).pin_hash
    expect(firstHash).toMatch(/^\$2[aby]\$/)
    expect(firstHash).not.toBe(TEST_ROOM_PIN)
    for (const c of [guest, otherOwner]) {
      expect((await c.rpc('set_room_pin', { p_group_id: SEED_ROOM, p_pin: '654321' })).error?.message).toContain('owner_required')
      expect((await c.rpc('room_pin_configured', { p_group_id: SEED_ROOM })).error?.message).toContain('owner_required')
    }
    for (const c of [guest, owner, otherOwner]) {
      expect((await c.from('room_entry_pins').select('pin_hash').eq('group_id', SEED_ROOM)).error).not.toBeNull()
      expect((await c.from('room_entry_pins').update({ failed_attempts: 0 }).eq('group_id', SEED_ROOM)).error).not.toBeNull()
    }
    expect((await guest.from('room_join_requests').insert({ group_id: SEED_ROOM, user_id: userIds[0], username: 'forged', pin_verified: true })).error).not.toBeNull()
    expect(await join(guest, '000000')).toEqual({ error: 'pin_invalid' })
    expect((await pinState()).failed_attempts).toBe(1)
    expect(await join()).toEqual({ room_id: SEED_ROOM })
    expect((await pinState()).failed_attempts).toBe(1)
    expect((await guest.from('groups').select('id').eq('id', SEED_ROOM)).data).toEqual([])
    expect((await guest.from('room_join_requests').select('pin_verified').eq('group_id', SEED_ROOM).single()).data?.pin_verified).toBe(true)

    // Rotation invalidates an already verified request without deleting it.
    const rotatedPin = '975310'
    expect((await owner.rpc('set_room_pin', { p_group_id: SEED_ROOM, p_pin: rotatedPin })).data).toBe(SEED_ROOM)
    expect((await pinState()).pin_hash).not.toBe(firstHash)
    expect((await guest.from('room_join_requests').select('pin_verified').eq('group_id', SEED_ROOM).single()).data?.pin_verified).toBe(false)
    expect((await owner.rpc('approve_room_member', { p_group_id: SEED_ROOM, p_user_id: userIds[0] })).error?.message).toContain('join_request_expired')
    expect((await guest.from('room_join_requests').update({ pin_verified: true }).eq('group_id', SEED_ROOM)).error).not.toBeNull()
    expect(await join()).toEqual({ error: 'pin_invalid' })
    const guesses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      join(index % 2 ? guest : anotherGuest, '000000')))
    expect(guesses).toEqual(Array.from({ length: 8 }, () => ({ error: 'pin_invalid' })))
    expect((await pinState()).failed_attempts).toBe(9)
    expect(await join(guest, rotatedPin)).toEqual({ room_id: SEED_ROOM })
    expect((await pinState()).failed_attempts).toBe(9)
    // A different anonymous account shares the same room's attempt budget.
    expect(await join(anotherGuest, '000000')).toEqual({ error: 'pin_locked' })
    const locked = await pinState()
    expect(locked.failed_attempts).toBe(10)
    expect(Date.parse(locked.locked_until)).toBeGreaterThan(Date.now() + 14 * 60_000)
    expect(await join(guest, rotatedPin)).toEqual({ error: 'pin_locked' })
    expect(await join(anotherGuest, rotatedPin)).toEqual({ error: 'pin_locked' })
    expect((await anotherGuest.from('room_join_requests').select('user_id').eq('group_id', SEED_ROOM)).data).toEqual([])
    expect(await join(owner, null)).toEqual({ room_id: SEED_ROOM })
    expect((await pinState()).failed_attempts).toBe(10)

    // Move only our fixture's lock into the past instead of waiting 15 minutes.
    expect((await service.from('room_entry_pins').update({ locked_until: new Date(Date.now() - 1000).toISOString() }).eq('group_id', SEED_ROOM)).error).toBeNull()
    expect(await join(anotherGuest, rotatedPin)).toEqual({ room_id: SEED_ROOM })
    expect((await pinState()).failed_attempts).toBe(0)
    expect((await owner.rpc('approve_room_member', { p_group_id: SEED_ROOM, p_user_id: userIds[0] })).data).toBe(SEED_ROOM)
    expect((await owner.rpc('set_room_pin', { p_group_id: SEED_ROOM, p_pin: '654321' })).data).toBe(SEED_ROOM)
    expect(await join(guest, '000000')).toEqual({ room_id: SEED_ROOM })
    expect((await owner.rpc('approve_room_member', { p_group_id: SEED_ROOM, p_user_id: userIds[1] })).error?.message).toContain('join_request_expired')
  } finally {
    if (restorePins) await restorePins()
    for (const userId of userIds) {
      expect((await service.from('players').delete().eq('user_id', userId)).error).toBeNull()
      expect((await service.auth.admin.deleteUser(userId)).error).toBeNull()
    }
  }
}, 30_000)
