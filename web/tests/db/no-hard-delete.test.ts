import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Required new coverage for a final-whole-branch-review finding: proves the
// two permanent invariants in
// docs/superpowers/specs/2026-08-04-badminton-club-design.md sections 5 and
// 8 -- players are archived, never hard-deleted; matches is append-only --
// actually hold for a REAL, non-super group manager, not service_role
// (which bypasses RLS by design and would trivially pass all three
// assertions regardless of whether the fix below exists).
// realowner@example.com (seed.sql) owns group 66666666-... and is
// explicitly not a super admin, so is_super_admin()'s bypass never masks the
// result -- same account tests/db/rls-non-super-roles.test.ts already
// established exercises the real, non-recursive RLS path.
//
// Each assertion here fails against the migrations as they stood before
// 0005_lock_append_only_deletes.sql (the delete silently succeeds) and
// passes after it.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const GROUP = '66666666-6666-6666-6666-666666666666' // owned by realowner@example.com, non-super

let admin: SupabaseClient
let seasonId: string
let sessionId: string
let playerId: string
let unreferencedPlayerId: string
let matchId: string

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return c
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

  const { data: season, error: seasonError } = await admin
    .from('seasons')
    .insert({ group_id: GROUP, name: 'ซีซั่นทดสอบลบไม่ได้' })
    .select('id')
    .single()
  expect(seasonError).toBeNull()
  seasonId = season!.id

  const { data: session, error: sessionError } = await admin
    .from('sessions')
    .insert({ group_id: GROUP, season_id: seasonId })
    .select('id')
    .single()
  expect(sessionError).toBeNull()
  sessionId = session!.id

  const { data: player, error: playerError } = await admin
    .from('players')
    .insert({ group_id: GROUP, name: 'ผู้เล่นทดสอบลบไม่ได้', skill: 3 })
    .select('id')
    .single()
  expect(playerError).toBeNull()
  playerId = player!.id

  // A second, unreferenced player: match_players.player_id is `on delete
  // restrict`, so trying to delete `playerId` above (which the match roster
  // below references) would already fail on that FK alone, regardless of
  // whether the RLS/grant fix under test exists. Using a player with no
  // match_players row isolates the "cannot delete a player" assertion to
  // exactly the thing this test is supposed to prove.
  const { data: unreferencedPlayer, error: unreferencedPlayerError } = await admin
    .from('players')
    .insert({ group_id: GROUP, name: 'ผู้เล่นทดสอบลบไม่ได้ (ไม่มีแมตช์อ้างอิง)', skill: 3 })
    .select('id')
    .single()
  expect(unreferencedPlayerError).toBeNull()
  unreferencedPlayerId = unreferencedPlayer!.id

  const { data: match, error: matchError } = await admin
    .from('matches')
    .insert({
      group_id: GROUP,
      session_id: sessionId,
      court_no: 1,
      mode: 'manual',
      client_id: crypto.randomUUID(),
    })
    .select('id')
    .single()
  expect(matchError).toBeNull()
  matchId = match!.id

  const { error: matchPlayersError } = await admin
    .from('match_players')
    .insert({ match_id: matchId, player_id: playerId, team: 1 })
  expect(matchPlayersError).toBeNull()
})

afterAll(async () => {
  // Cleanup runs as service_role, which keeps its delete privileges
  // independent of this fix -- 0005_lock_append_only_deletes.sql scopes the
  // no-delete rule to `authenticated` (real app users), not to trusted
  // server-side operations like test teardown or a future admin tool.
  // Deleting matches first cascades to match_players automatically (its FK
  // is `on delete cascade`), which then clears the way for the players
  // delete (match_players.player_id is `on delete restrict`).
  await admin.from('matches').delete().eq('id', matchId)
  await admin.from('players').delete().eq('id', playerId)
  await admin.from('players').delete().eq('id', unreferencedPlayerId)
  await admin.from('sessions').delete().eq('id', sessionId)
  await admin.from('seasons').delete().eq('id', seasonId)
})

describe('a real non-super group manager cannot destroy history', () => {
  it('cannot delete a player row', async () => {
    const c = await signIn('realowner@example.com')
    const { error } = await c.from('players').delete().eq('id', unreferencedPlayerId)
    expect(error).not.toBeNull()

    const { data } = await admin.from('players').select('id').eq('id', unreferencedPlayerId).maybeSingle()
    expect(data).not.toBeNull()
  })

  it('cannot delete a match_players row', async () => {
    const c = await signIn('realowner@example.com')
    const { error } = await c
      .from('match_players')
      .delete()
      .eq('match_id', matchId)
      .eq('player_id', playerId)
    expect(error).not.toBeNull()

    const { data } = await admin
      .from('match_players')
      .select('match_id')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .maybeSingle()
    expect(data).not.toBeNull()
  })

  it('cannot delete a session row (which would cascade-delete its matches)', async () => {
    const c = await signIn('realowner@example.com')
    const { error } = await c.from('sessions').delete().eq('id', sessionId)
    expect(error).not.toBeNull()

    const { data } = await admin.from('sessions').select('id').eq('id', sessionId).maybeSingle()
    expect(data).not.toBeNull()

    // The would-be cascade target must also have survived.
    const { data: matchStillThere } = await admin.from('matches').select('id').eq('id', matchId).maybeSingle()
    expect(matchStillThere).not.toBeNull()
  })
})
