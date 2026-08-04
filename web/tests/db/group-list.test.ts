import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function signIn(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  await c.auth.signInWithPassword({ email, password: 'password123' })
  return c
}

describe('group list query', () => {
  it('returns every group for a super admin', async () => {
    const c = await signIn('owner@example.com')
    const { data } = await c.from('groups').select('id, name')
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('returns nothing for an account in no group', async () => {
    const c = await signIn('member@example.com')
    const { data } = await c.from('groups').select('id, name')
    expect(data).toEqual([])
  })
})
