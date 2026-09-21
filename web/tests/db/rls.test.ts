import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SUPER = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222'

let admin: SupabaseClient
let groupId: string

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return c
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  const { data, error } = await admin.from('groups').insert({ name: 'ก๊วนทดสอบ', created_by: SUPER }).select('id').single()
  expect(error).toBeNull()
  groupId = data!.id
  await admin.from('group_members').insert({ group_id: groupId, user_id: SUPER, role: 'owner' })
  await admin.from('players').insert({ group_id: groupId, name: 'บอส', skill: 6 })
})

// Regression coverage for a final-whole-branch-review finding (test suite
// idempotency): this file used to create its group here and never remove
// it, so SUPER (already the owner of the seeded group) permanently used up
// its one-owned-group slot and the system-wide 5-group cap a little more on
// every run. Deleting the group cascades to its group_members and players
// rows, so a second `npm test` with no db reset in between finds the same
// starting state as the first.
afterAll(async () => {
  await admin.from('groups').delete().eq('id', groupId)
})

describe('group visibility', () => {
  it('lets a member read their own group', async () => {
    const c = await signIn('owner@example.com')
    const { data } = await c.from('groups').select('id').eq('id', groupId)
    expect(data).toHaveLength(1)
  })

  it('hides a group from someone who is not in it', async () => {
    const c = await signIn('member@example.com')
    const { data } = await c.from('groups').select('id').eq('id', groupId)
    expect(data).toHaveLength(0)
  })

  it('hides that group\'s players too', async () => {
    const c = await signIn('member@example.com')
    const { data } = await c.from('players').select('id').eq('group_id', groupId)
    expect(data).toHaveLength(0)
  })
})

describe('write permission', () => {
  it('lets an owner add a player', async () => {
    const c = await signIn('owner@example.com')
    const { error } = await c.from('players').insert({ group_id: groupId, name: 'แนน', skill: 5 })
    expect(error).toBeNull()
  })

  it('stops an outsider from adding a player', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('players').insert({ group_id: groupId, name: 'แอบใส่', skill: 3 })
    expect(error).not.toBeNull()
  })

  it('stops a plain member from adding a player to their own group', async () => {
    await admin.from('group_members').insert({ group_id: groupId, user_id: OUTSIDER, role: 'member' })
    const c = await signIn('member@example.com')
    const { error } = await c.from('players').insert({ group_id: groupId, name: 'ไม่มีสิทธิ์', skill: 3 })
    expect(error).not.toBeNull()
    await admin.from('group_members').delete().eq('group_id', groupId).eq('user_id', OUTSIDER)
  })
})

describe('group creation', () => {
  it('stops a normal account from creating a group', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('groups').insert({ name: 'ก๊วนแอบสร้าง' })
    expect(error).not.toBeNull()
  })
})
