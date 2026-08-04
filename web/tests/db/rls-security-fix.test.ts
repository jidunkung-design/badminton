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

  // Group B: a separate tenant with its own season/session, so we have a
  // foreign resource to try to smuggle a reference to from group A. No
  // group_members row is needed for SUPER here -- SUPER is_super_admin, so
  // is_group_member/can_manage_group already pass for SUPER on every group via
  // the is_super_admin() bypass, and skipping the membership row avoids a
  // second 'owner' assignment competing with rls.test.ts's own group for SUPER.
  const { data: b } = await admin.from('groups').insert({ name: 'กลุ่มบี', created_by: SUPER }).select('id').single()
  groupB = b!.id
  const { data: se } = await admin.from('seasons').insert({ group_id: groupB, name: 'ซีซั่นบี' }).select('id').single()
  seasonB = se!.id
  const { data: ss } = await admin.from('sessions').insert({ group_id: groupB, season_id: seasonB }).select('id').single()
  sessionB = ss!.id
})

afterAll(async () => {
  // Deleting the two groups cascades (on delete cascade) to every
  // group_members, seasons, sessions, and matches row this file created, so
  // no leftover state (in particular OUTSIDER's group_members row) survives
  // for other test files that assume a clean slate.
  await admin.from('groups').delete().eq('id', groupA)
  await admin.from('groups').delete().eq('id', groupB)
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
  it('stops a manager of group A from inserting a match that points at group B\'s session', async () => {
    const c = await signIn('member@example.com') // admin of group A only
    const { error } = await c.from('matches').insert({
      group_id: groupA,
      session_id: sessionB, // foreign group's session
      court_no: 1,
      mode: 'manual',
      client_id: crypto.randomUUID(),
    })
    expect(error).not.toBeNull()
  })

  it('still lets a manager insert a match against their own group\'s session', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('matches').insert({
      group_id: groupA,
      session_id: sessionA,
      court_no: 1,
      mode: 'manual',
      client_id: crypto.randomUUID(),
    })
    expect(error).toBeNull()
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
