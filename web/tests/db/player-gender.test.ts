import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

it('keeps gender explicit, inherits linked profiles, and allows only self or room-owner changes', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const owner = client(), manager = client(), member = client(), unauthenticated = client()
  const groupId = '66666666-6666-6666-6666-666666666666'
  const users: string[] = [], playerIds: string[] = []
  try {
    expect((await owner.auth.signInWithPassword({ email: 'realowner@example.com', password: 'password123' })).error).toBeNull()
    for (const c of [manager, member]) {
      const email = `gender-${crypto.randomUUID()}@example.com`, password = crypto.randomUUID()
      const user = await service.auth.admin.createUser({ email, password, email_confirm: true })
      expect(user.error).toBeNull()
      users.push(user.data.user!.id)
      expect((await c.auth.signInWithPassword({ email, password })).error).toBeNull()
      expect((await c.rpc('claim_username', { p_username: `gender_${crypto.randomUUID().slice(0, 8)}` })).error).toBeNull()
      expect((await c.from('profiles').select('gender').eq('id', user.data.user!.id).single()).data?.gender).toBe('unspecified')
    }
    expect((await unauthenticated.rpc('set_profile_gender', { p_gender: 'male' })).error).not.toBeNull()
    expect((await manager.rpc('set_profile_gender', { p_gender: 'invalid' })).error?.message).toContain('gender_invalid')
    expect((await manager.from('profiles').update({ gender: 'male' }).eq('id', users[0])).error).not.toBeNull()
    expect((await manager.rpc('set_profile_gender', { p_gender: 'male' })).data).toBe('male')
    expect((await member.rpc('set_profile_gender', { p_gender: 'female' })).data).toBe('female')
    expect((await service.from('group_members').insert({ group_id: groupId, user_id: users[0], role: 'admin' })).error).toBeNull()
    const linked = await owner.from('players').insert({ group_id: groupId, user_id: users[0], name: 'Linked gender fixture', gender: 'female' }).select('id,gender').single()
    expect(linked.error).toBeNull()
    playerIds.push(linked.data!.id)
    expect(linked.data!.gender).toBe('male') // Account inheritance wins at insertion.
    const manual = await owner.from('players').insert({ group_id: groupId, name: 'Manual gender fixture', gender: 'female' }).select('id,gender').single()
    expect(manual.error).toBeNull()
    playerIds.push(manual.data!.id)
    expect(manual.data!.gender).toBe('female')
    const neutral = await owner.from('players').insert({ group_id: groupId, name: 'Explicit unspecified fixture' }).select('id,gender').single()
    expect(neutral.error).toBeNull()
    playerIds.push(neutral.data!.id)
    expect(neutral.data!.gender).toBe('unspecified')
    const invalidId = crypto.randomUUID()
    playerIds.push(invalidId)
    expect((await owner.from('players').insert({ id: invalidId, group_id: groupId, name: 'Invalid gender fixture', gender: 'invalid' })).error).not.toBeNull()
    const edit = { p_group_id: groupId, p_player_id: linked.data!.id, p_gender: 'female' }
    expect((await manager.rpc('set_player_gender', edit)).error?.message).toContain('owner_required')
    expect((await manager.from('players').update({ gender: 'female' }).eq('id', linked.data!.id)).error).not.toBeNull()
    expect((await owner.from('players').update({ gender: 'female' }).eq('id', linked.data!.id)).error).not.toBeNull()
    expect((await manager.from('players').update({ skill: 4 }).eq('id', manual.data!.id).select('skill').single()).data?.skill).toBe(4)
    expect((await owner.rpc('set_player_gender', { ...edit, p_gender: 'invalid' })).error?.message).toContain('gender_invalid')
    expect((await owner.rpc('set_player_gender', { ...edit, p_player_id: crypto.randomUUID() })).error?.message).toContain('player_not_found')
    expect((await owner.rpc('set_player_gender', edit)).data).toBe('female')
    expect((await manager.from('profiles').select('gender').eq('id', users[0]).single()).data?.gender).toBe('male')
    expect((await owner.from('players').select('gender').eq('id', linked.data!.id).single()).data?.gender).toBe('female')
    expect((await manager.rpc('set_profile_gender', { p_gender: 'male' })).data).toBe('male')
    expect((await owner.from('players').select('gender').eq('id', linked.data!.id).single()).data?.gender).toBe('female')
    // A changed self selection propagates to linked room players, not peers.
    expect((await manager.rpc('set_profile_gender', { p_gender: 'unspecified' })).data).toBe('unspecified')
    expect((await owner.from('players').select('gender').eq('id', linked.data!.id).single()).data?.gender).toBe('unspecified')
    expect((await owner.from('players').select('gender').eq('id', manual.data!.id).single()).data?.gender).toBe('female')
    expect((await member.from('profiles').select('gender').eq('id', users[1]).single()).data?.gender).toBe('female')
    // Exercise the same insert trigger used by room creation and approval,
    // without changing the existing room's PIN or pending requests.
    expect((await service.from('group_members').insert({ group_id: groupId, user_id: users[1], role: 'member' })).error).toBeNull()
    expect((await owner.from('players').insert({ group_id: groupId, user_id: users[1], name: 'New linked gender fixture' })).error).toBeNull()
    const approved = await owner.from('players').select('id,gender').eq('group_id', groupId).eq('user_id', users[1]).single()
    expect(approved.error).toBeNull()
    playerIds.push(approved.data!.id)
    expect(approved.data!.gender).toBe('female')
    expect((await member.rpc('set_player_gender', { ...edit, p_player_id: approved.data!.id, p_gender: 'male' })).error?.message).toContain('owner_required')
    expect((await member.rpc('set_profile_gender', { p_gender: 'male' })).data).toBe('male')
    expect((await owner.from('players').select('gender').eq('id', approved.data!.id).single()).data?.gender).toBe('male')
  } finally {
    if (playerIds.length) expect((await service.from('players').delete().in('id', playerIds)).error).toBeNull()
    for (const id of users) {
      // Include a just-inserted linked row if a later assertion failed before capture.
      expect((await service.from('players').delete().eq('user_id', id)).error).toBeNull()
      expect((await service.auth.admin.deleteUser(id)).error).toBeNull()
    }
  }
}, 30_000)
