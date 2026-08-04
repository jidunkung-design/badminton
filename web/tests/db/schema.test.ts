import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

let admin: SupabaseClient

beforeAll(() => {
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
})

describe('group cap', () => {
  // Regression coverage for a final-whole-branch-review finding: this test
  // used to fill the system-wide 5-group cap with `filler N` groups and
  // never remove them, so every later run of the whole suite (and every
  // other tests/db/*.test.ts file that needs to insert its own group) found
  // less and less headroom until a `npx supabase db reset` was required.
  // Fixed with try/finally teardown: whatever headroom existed before this
  // test is exactly what exists after it, regardless of pass or fail.
  it('refuses to create a sixth group', async () => {
    const created: string[] = []
    try {
      const { count } = await admin.from('groups').select('*', { count: 'exact', head: true })
      const room = 5 - (count ?? 0)
      for (let i = 0; i < room; i++) {
        const { data, error } = await admin.from('groups').insert({ name: `filler ${i}` }).select('id').single()
        expect(error).toBeNull()
        created.push(data!.id)
      }
      const { error } = await admin.from('groups').insert({ name: 'one too many' })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('group_cap')
    } finally {
      for (const id of created) await admin.from('groups').delete().eq('id', id)
    }
  })
})

describe('ownership rules', () => {
  // Regression coverage for a final-whole-branch-review finding: this test
  // used to pick an arbitrary existing group (`select 1 from groups limit
  // 1`) and delete all of its group_members rows, which could -- depending
  // on run order -- wipe out a seeded owner another test file depends on
  // (e.g. realowner@example.com's ownership of the seeded group used by
  // tests/db/rls-non-super-roles.test.ts). Fixed by using a dedicated group
  // and two throwaway auth users created just for this test, so it never
  // reads or mutates any shared/seeded row, and tears everything it created
  // back down afterward.
  it('allows only one owner per group', async () => {
    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({ name: 'ownership rule test group' })
      .select('id')
      .single()
    expect(groupError).toBeNull()
    const groupId = group!.id

    const stamp = Date.now()
    const { data: userA, error: userAError } = await admin.auth.admin.createUser({
      email: `ownership-test-a-${stamp}@example.com`,
      password: 'password123',
      email_confirm: true,
    })
    const { data: userB, error: userBError } = await admin.auth.admin.createUser({
      email: `ownership-test-b-${stamp}@example.com`,
      password: 'password123',
      email_confirm: true,
    })
    expect(userAError).toBeNull()
    expect(userBError).toBeNull()

    try {
      const first = await admin
        .from('group_members')
        .insert({ group_id: groupId, user_id: userA.user!.id, role: 'owner' })
      expect(first.error).toBeNull()
      const second = await admin
        .from('group_members')
        .insert({ group_id: groupId, user_id: userB.user!.id, role: 'owner' })
      expect(second.error).not.toBeNull()
    } finally {
      // Deleting the group cascades to its group_members rows; deleting the
      // throwaway auth users cascades to their profiles rows (and any
      // remaining group_members rows referencing them).
      await admin.from('groups').delete().eq('id', groupId)
      await admin.auth.admin.deleteUser(userA.user!.id)
      await admin.auth.admin.deleteUser(userB.user!.id)
    }
  })
})

describe('players', () => {
  // Regression coverage for a final-whole-branch-review finding: this test
  // used to insert a player row into an arbitrary existing group and never
  // remove it. Fixed by using a dedicated group, deleted afterward (which
  // cascades to the player row).
  it('allows a player row with no linked account', async () => {
    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({ name: 'players rule test group' })
      .select('id')
      .single()
    expect(groupError).toBeNull()
    const groupId = group!.id

    try {
      const { error } = await admin
        .from('players')
        .insert({ group_id: groupId, name: 'ยังไม่มีบัญชี', skill: 3 })
      expect(error).toBeNull()
    } finally {
      await admin.from('groups').delete().eq('id', groupId)
    }
  })
})
