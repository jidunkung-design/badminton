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
  it('refuses to create a sixth group', async () => {
    const { count } = await admin.from('groups').select('*', { count: 'exact', head: true })
    const room = 5 - (count ?? 0)
    for (let i = 0; i < room; i++) {
      const { error } = await admin.from('groups').insert({ name: `filler ${i}` })
      expect(error).toBeNull()
    }
    const { error } = await admin.from('groups').insert({ name: 'one too many' })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('group_cap')
  })
})

describe('ownership rules', () => {
  it('allows only one owner per group', async () => {
    const { data: group } = await admin.from('groups').select('id').limit(1).single()
    const { data: users } = await admin.auth.admin.listUsers()
    const [a, b] = users.users
    await admin.from('group_members').delete().eq('group_id', group!.id)
    const first = await admin
      .from('group_members')
      .insert({ group_id: group!.id, user_id: a.id, role: 'owner' })
    expect(first.error).toBeNull()
    const second = await admin
      .from('group_members')
      .insert({ group_id: group!.id, user_id: b.id, role: 'owner' })
    expect(second.error).not.toBeNull()
  })
})

describe('players', () => {
  it('allows a player row with no linked account', async () => {
    const { data: group } = await admin.from('groups').select('id').limit(1).single()
    const { error } = await admin
      .from('players')
      .insert({ group_id: group!.id, name: 'ยังไม่มีบัญชี', skill: 3 })
    expect(error).toBeNull()
  })
})
