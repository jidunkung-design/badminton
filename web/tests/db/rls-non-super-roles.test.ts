import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Regression coverage for the RLS infinite-recursion bug found after Task 8's
// security-review round. Every earlier RLS test signed in as owner@example.com,
// whose profile has is_super_admin = true. is_group_member()/can_manage_group()
// short-circuit on is_super_admin() before ever planning the correlated
// exists() subquery against group_members, so no earlier test ever exercised
// that subquery for a real request. A genuine non-super owner/admin/member
// hits it on every query and gets "infinite recursion detected in policy for
// relation group_members" from Postgres. These tests sign in as
// realowner@example.com (seed.sql, is_super_admin = false, owns group
// 66666666-...) and as member@example.com (also non-super, seed.sql), so the
// exists() path is unavoidable, and each test fails against the pre-fix
// migrations with that recursion error, not a plain assertion mismatch.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const REAL_OWNER = '55555555-5555-5555-5555-555555555555' // realowner@example.com, non-super
const MEMBER = '22222222-2222-2222-2222-222222222222' // member@example.com, non-super
const GROUP_A = '66666666-6666-6666-6666-666666666666' // seeded, owned by REAL_OWNER
const GROUP_B = '33333333-3333-3333-3333-333333333333' // seeded, owned by the super-admin account, unrelated to REAL_OWNER

const admin: SupabaseClient = createClient(URL, SERVICE, { auth: { persistSession: false } })

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return c
}

// Tests 2 and 3 temporarily add MEMBER to GROUP_A with a specific role, then
// remove the row again -- member@example.com must end each test still "in no
// group", which tests/db/group-list.test.ts's "returns nothing for an account
// in no group" case depends on regardless of file execution order.
afterEach(async () => {
  await admin.from('group_members').delete().eq('group_id', GROUP_A).eq('user_id', MEMBER)
})

describe('non-super owner', () => {
  it('can select from group_members, players, and groups for their own group', async () => {
    const c = await signIn('realowner@example.com')

    const groups = await c.from('groups').select('id').eq('id', GROUP_A)
    expect(groups.error).toBeNull()
    expect(groups.data).toHaveLength(1)

    const members = await c.from('group_members').select('user_id').eq('group_id', GROUP_A)
    expect(members.error).toBeNull()
    expect(members.data).not.toBeNull()
    expect(members.data!.length).toBeGreaterThan(0)

    const players = await c.from('players').select('id').eq('group_id', GROUP_A)
    expect(players.error).toBeNull()
    expect(players.data).not.toBeNull()
  })
})

describe('non-super admin', () => {
  it('cannot add a player even within their own group', async () => {
    await admin.from('group_members').insert({ group_id: GROUP_A, user_id: MEMBER, role: 'admin' })
    const c = await signIn('member@example.com')

    // Mirrors web/src/lib/roles.ts's roleInGroup(), which queries
    // group_members directly (not through players' own policy) -- this is
    // the exact query shape that reliably recurses pre-fix, so it must
    // succeed before the write attempt is a meaningful assertion.
    const role = await c.from('group_members').select('role').eq('group_id', GROUP_A).eq('user_id', MEMBER).maybeSingle()
    expect(role.error).toBeNull()
    expect(role.data?.role).toBe('admin')

    const { error } = await c.from('players').insert({ group_id: GROUP_A, name: 'ผู้เล่นใหม่', skill: 4 })
    expect(error).not.toBeNull()
  })
})

describe('non-super member', () => {
  it('can read players but cannot insert one', async () => {
    await admin.from('group_members').insert({ group_id: GROUP_A, user_id: MEMBER, role: 'member' })
    const c = await signIn('member@example.com')

    const role = await c.from('group_members').select('role').eq('group_id', GROUP_A).eq('user_id', MEMBER).maybeSingle()
    expect(role.error).toBeNull()
    expect(role.data?.role).toBe('member')

    const read = await c.from('players').select('id').eq('group_id', GROUP_A)
    expect(read.error).toBeNull()
    expect(read.data).not.toBeNull()
    expect(read.data!.length).toBeGreaterThan(0)

    const write = await c.from('players').insert({ group_id: GROUP_A, name: 'แอบใส่', skill: 3 })
    expect(write.error).not.toBeNull()
  })
})

describe('cross-group isolation for a non-super owner', () => {
  it('still cannot read or write a group they do not belong to', async () => {
    const c = await signIn('realowner@example.com')

    const read = await c.from('groups').select('id').eq('id', GROUP_B)
    expect(read.error).toBeNull()
    expect(read.data).toHaveLength(0)

    const members = await c.from('group_members').select('user_id').eq('group_id', GROUP_B)
    expect(members.error).toBeNull()
    expect(members.data).toHaveLength(0)

    const write = await c.from('players').insert({ group_id: GROUP_B, name: 'แอบใส่ข้ามกลุ่ม', skill: 3 })
    expect(write.error).not.toBeNull()
  })
})
