import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Regression coverage for the security review findings on top of Task 8's RLS
// migration (0002_rls.sql). Each test here fails against the pre-fix version
// of that migration and passes against the fixed version.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SUPER = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222'

let admin: SupabaseClient
let groupA: string
let seasonA: string
let sessionA: string
let groupB: string
let seasonB: string
let sessionB: string
let rosterA: string[]

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return c
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

  // Group A: OUTSIDER (member@example.com) is an 'admin' here, not 'owner'.
  // `role` intentionally avoids 'owner': the partial unique indexes
  // one_owner_per_group / one_group_per_owner are global invariants shared
  // with tests/db/schema.test.ts and tests/db/rls.test.ts, which also assign
  // 'owner' rows to these same two fixed seed users. 'admin' still satisfies
  // can_manage_group (owner or admin) for this file's "manager" scenarios
  // without competing for the single-owned-group slot those other files rely on.
  const { data: a } = await admin.from('groups').insert({ name: 'กลุ่มเอ', created_by: SUPER }).select('id').single()
  groupA = a!.id
  await admin.from('group_members').insert({ group_id: groupA, user_id: OUTSIDER, role: 'admin' })
  const { data: seA } = await admin.from('seasons').insert({ group_id: groupA, name: 'ซีซั่นเอ' }).select('id').single()
  seasonA = seA!.id
  const { data: ssA } = await admin.from('sessions').insert({ group_id: groupA, season_id: seasonA }).select('id').single()
  sessionA = ssA!.id
  const roster = await admin.from('players').insert(
    Array.from({ length: 4 }, (_, index) => ({ group_id: groupA, name: `ผู้เล่นทดสอบ ${index + 1}` })),
  ).select('id')
  expect(roster.error).toBeNull()
  rosterA = roster.data!.map(player => player.id)
  expect((await admin.from('attendance').insert(rosterA.map(player_id => ({ session_id: sessionA, player_id })))).error).toBeNull()

  // Reuse the seeded foreign tenant so two seed rooms plus our room fit the
  // global three-room cap. Only this test's new season/session are cleaned up.
  groupB = '66666666-6666-6666-6666-666666666666'
  const { data: se } = await admin.from('seasons').insert({ group_id: groupB, name: 'ซีซั่นบี' }).select('id').single()
  seasonB = se!.id
  const { data: ss } = await admin.from('sessions').insert({ group_id: groupB, season_id: seasonB }).select('id').single()
  sessionB = ss!.id
})

afterAll(async () => {
  // Remove our room and only the test season/session in the seeded foreign room.
  // Clear RESTRICT references before deleting players through the room cascade.
  expect((await admin.from('matches').delete().eq('group_id', groupA)).error).toBeNull()
  expect((await admin.from('sessions').delete().eq('group_id', groupA)).error).toBeNull()
  expect((await admin.from('groups').delete().eq('id', groupA)).error).toBeNull()
  expect((await admin.from('sessions').delete().eq('id', sessionB)).error).toBeNull()
  expect((await admin.from('seasons').delete().eq('id', seasonB)).error).toBeNull()
})

describe('privilege escalation via profiles', () => {
  it('refuses a signed-in non-super user setting is_super_admin on their own row', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('profiles').update({ is_super_admin: true }).eq('id', OUTSIDER)
    expect(error).not.toBeNull()

    // Confirm the flag genuinely did not change, not just that an error came back.
    const { data } = await admin.from('profiles').select('is_super_admin').eq('id', OUTSIDER).single()
    expect(data!.is_super_admin).toBe(false)
  })

  it('still lets a user update their own display_name', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('profiles').update({ display_name: 'ชื่อใหม่' }).eq('id', OUTSIDER)
    expect(error).toBeNull()
  })
})

describe('anonymous access', () => {
  it('refuses an anon client any read of groups', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } })
    const { error } = await c.from('groups').select('id')
    expect(error).not.toBeNull()
  })

  it('refuses an anon client calling is_super_admin via rpc', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } })
    const { error } = await c.rpc('is_super_admin')
    expect(error).not.toBeNull()
  })
})

describe('cross-group tenancy on matches', () => {
  const matchArgs = () => ({
    p_client_id: crypto.randomUUID(),
    p_group_id: groupA,
    p_session_id: sessionA,
    p_court_no: 1,
    p_mode: 'manual',
    p_balance_weight: 0.5,
    p_winner_team: 1,
    p_team_a: rosterA.slice(0, 2),
    p_team_b: rosterA.slice(2, 4),
  })

  it('rejects a foreign session through the guarded completion RPC', async () => {
    const c = await signIn('member@example.com') // admin of group A only
    const { error } = await c.rpc('record_match', { ...matchArgs(), p_session_id: sessionB })
    expect(error?.message).toContain('session_invalid')
  })

  it('lets a manager record a complete checked-in roster through the RPC', async () => {
    const c = await signIn('member@example.com')
    const recorded = await c.rpc('record_match', matchArgs())
    expect(recorded.error).toBeNull()
    const roster = await c.from('match_players').select('player_id').eq('match_id', recorded.data)
    expect(roster.error).toBeNull()
    expect(new Set(roster.data!.map(player => player.player_id))).toEqual(new Set(rosterA))
  })

  it('blocks direct writes even for a manager of the matching room', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('matches').insert({
      group_id: groupA,
      session_id: sessionA,
      court_no: 1,
      mode: 'manual',
      client_id: crypto.randomUUID(),
    })
    expect(error).not.toBeNull()
  })
})

describe('append-only matches', () => {
  it('stops an authenticated manager from deleting a match row', async () => {
    const c = await signIn('member@example.com')
    const { data: match } = await admin
      .from('matches')
      .insert({ group_id: groupA, session_id: sessionA, court_no: 2, mode: 'manual', client_id: crypto.randomUUID() })
      .select('id')
      .single()
    const { error } = await c.from('matches').delete().eq('id', match!.id)
    expect(error).not.toBeNull()
  })
})

describe('group_members writes by a plain member', () => {
  it('stops a plain member of group A from adding another member', async () => {
    // Demote OUTSIDER from admin to plain member for the duration of this test.
    await admin.from('group_members').update({ role: 'member' }).eq('group_id', groupA).eq('user_id', OUTSIDER)
    const c = await signIn('member@example.com')
    const { error } = await c.from('group_members').insert({ group_id: groupA, user_id: SUPER, role: 'member' })
    expect(error).not.toBeNull()
    // Restore OUTSIDER as admin so later tests in this file are unaffected.
    await admin.from('group_members').update({ role: 'admin' }).eq('group_id', groupA).eq('user_id', OUTSIDER)
  })
})
