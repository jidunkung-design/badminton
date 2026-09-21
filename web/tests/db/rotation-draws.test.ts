import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { playingDate } from '../../src/lib/playing-date'

it('persists winners, releases draws, protects retries/reservations, and counts exact pairs across seasons', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const outsider = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const group = '66666666-6666-6666-6666-666666666666'
  const sessions: string[] = [], seasons: string[] = [], players: string[] = []
  let userId: string | undefined
  try {
    expect((await owner.auth.signInWithPassword({ email: 'realowner@example.com', password: 'password123' })).error).toBeNull()
    expect((await outsider.auth.signInWithPassword({ email: 'member@example.com', password: 'password123' })).error).toBeNull()
    const user = await service.auth.admin.createUser({ email: `rotation-${crypto.randomUUID()}@example.com`, password: crypto.randomUUID(), email_confirm: true })
    expect(user.error).toBeNull()
    userId = user.data.user!.id
    const existing = await service.from('seasons').select('id').eq('group_id', group).is('ended_at', null).maybeSingle()
    expect(existing.error).toBeNull()
    let season = existing.data?.id
    if (!season) {
      const created = await owner.from('seasons').insert({ group_id: group, name: 'Rotation test' }).select('id').single()
      expect(created.error).toBeNull()
      season = created.data!.id
      seasons.push(season)
    }
    const today = playingDate()
    const sessionResult = await owner.from('sessions').insert({ group_id: group, season_id: season, played_on: today }).select('id,rotation_mode').single()
    expect(sessionResult.error).toBeNull()
    expect(sessionResult.data!.rotation_mode).toBe('all_out')
    const session = sessionResult.data!.id
    sessions.push(session)
    const added = await owner.from('players').insert(Array.from({ length: 6 }, (_, i) => ({ group_id: group, name: `rotation ${i} ${crypto.randomUUID().slice(0, 6)}`, user_id: i === 0 ? userId : null }))).select('id,user_id')
    expect(added.error).toBeNull()
    const linked = added.data!.find(p => p.user_id === userId)!
    players.push(linked.id, ...added.data!.filter(p => p.id !== linked.id).map(p => p.id))
    expect((await owner.from('attendance').insert(players.map(player_id => ({ session_id: session, player_id })))).error).toBeNull()
    const a = players.slice(0, 2), b = players.slice(2, 4), c = players.slice(4, 6)
    const rotation = { p_group_id: group, p_session_id: session, p_rotation_mode: 'winner_stays' }
    const release = { p_group_id: group, p_session_id: session, p_court_no: 1, p_retained_match_id: crypto.randomUUID() }
    const args = (teamA = a, teamB = b, court = 1) => ({ p_client_id: crypto.randomUUID(), p_session_id: session, p_group_id: group,
      p_court_no: court, p_mode: 'manual', p_balance_weight: 0.5, p_team_a: teamA, p_team_b: teamB })
    const retained = async () => {
      const result = await owner.from('session_courts').select('retained_pair,retained_match_id').eq('session_id', session).eq('court_no', 1).single()
      expect(result.error).toBeNull()
      return result.data!
    }
    const complete = async (input: ReturnType<typeof args>, winner: number) => {
      expect((await owner.rpc('begin_match', input)).error).toBeNull()
      if (winner === 0) expect((await service.from('active_court_matches').update({ started_at: new Date(Date.now() - 300_000).toISOString() }).eq('client_id', input.p_client_id)).error).toBeNull()
      const result = await owner.rpc('record_match', { ...input, p_winner_team: winner })
      expect(result.error).toBeNull()
      return result.data as string
    }
    const headToHead = async (teamA = a, teamB = b) => {
      const result = await owner.rpc('get_pair_head_to_head', { p_group_id: group, p_team_a: teamA, p_team_b: teamB })
      expect(result.error).toBeNull()
      return result.data[0]
    }
    expect((await outsider.rpc('set_session_rotation', rotation)).error?.message).toContain('room_forbidden')
    expect((await outsider.rpc('release_retained_pair', release)).error?.message).toContain('room_forbidden')
    expect((await outsider.rpc('get_pair_head_to_head', { p_group_id: group, p_team_a: a, p_team_b: b })).error?.message).toContain('room_forbidden')
    expect((await owner.from('sessions').update({ rotation_mode: 'winner_stays' }).eq('id', session)).error).not.toBeNull()
    expect((await owner.rpc('set_session_rotation', rotation)).error).toBeNull()
    const firstArgs = args()
    expect((await owner.rpc('begin_match', firstArgs)).error).toBeNull()
    expect((await owner.from('active_court_matches').select('rotation_mode').eq('client_id', firstArgs.p_client_id).single()).data?.rotation_mode).toBe('winner_stays')
    expect((await owner.rpc('set_session_rotation', { ...rotation, p_rotation_mode: 'all_out' })).error?.message).toContain('session_busy')
    expect((await owner.rpc('set_session_rotation', rotation)).error).toBeNull()
    expect((await owner.rpc('release_retained_pair', release)).error?.message).toContain('court_busy')
    const first = await owner.rpc('record_match', { ...firstArgs, p_winner_team: 1 })
    expect(first.error).toBeNull()
    expect(await retained()).toEqual({ retained_pair: [...a].sort(), retained_match_id: first.data })
    expect((await owner.from('matches').select('rotation_mode').eq('id', first.data).single()).data?.rotation_mode).toBe('winner_stays')
    expect((await owner.from('session_courts').update({ retained_pair: null }).eq('session_id', session)).error).not.toBeNull()
    expect((await owner.rpc('begin_match', args(b, c))).error?.message).toContain('retained_pair_required')
    expect((await owner.rpc('begin_match', args(a, b, 2))).error?.message).toContain('players_reserved')
    expect((await owner.rpc('record_match', { ...args(a, b, 2), p_winner_team: 1 })).error?.message).toContain('match_start_required')
    const secondArgs = args(a, c)
    const secondId = await complete(secondArgs, 1)
    expect((await owner.rpc('record_match', { ...firstArgs, p_winner_team: 1 })).data).toBe(first.data)
    expect((await owner.rpc('release_retained_pair', { ...release, p_retained_match_id: first.data })).error?.message).toContain('retained_pair_changed')
    expect(await retained()).toEqual({ retained_pair: [...a].sort(), retained_match_id: secondId })
    expect((await owner.rpc('set_session_rotation', rotation)).error).toBeNull()
    expect((await retained()).retained_match_id).toBe(secondId)
    const drawArgs = args()
    const drawId = await complete(drawArgs, 0)
    expect(await retained()).toEqual({ retained_pair: null, retained_match_id: null })
    const drawRewards = await owner.rpc('get_match_rewards', { p_match_id: drawId })
    expect(drawRewards.error).toBeNull()
    expect(drawRewards.data.find((r: { player_id: string }) => r.player_id === linked.id)).toMatchObject({ win_streak: 0, multiplier: 1, coins: 10, bonus: 0 })
    const durations = await owner.rpc('get_player_durations', { p_group_id: group })
    expect(durations.error).toBeNull()
    expect(durations.data.find((p: { player_id: string }) => p.player_id === linked.id).timed_games).toBe(3)
    const reverseId = await complete(args([...b].reverse(), [...a].reverse()), 2)
    const afterDraw = await owner.rpc('get_match_rewards', { p_match_id: reverseId })
    expect(afterDraw.data.find((r: { player_id: string }) => r.player_id === linked.id)).toMatchObject({ win_streak: 1, multiplier: 1, coins: 10 })
    expect(await headToHead()).toEqual({ played: 3, team_a_wins: 2, team_b_wins: 0, draws: 1 })
    expect(await headToHead([...b].reverse(), [...a].reverse())).toEqual({ played: 3, team_a_wins: 0, team_b_wins: 2, draws: 1 })
    expect(await headToHead(a, c)).toEqual({ played: 1, team_a_wins: 1, team_b_wins: 0, draws: 0 })
    expect((await owner.rpc('get_pair_head_to_head', { p_group_id: group, p_team_a: [a[0], a[0]], p_team_b: b })).error?.message).toContain('pair_invalid')
    // An unavailable retained player can be released without fabricating a game.
    release.p_retained_match_id = reverseId
    expect((await owner.from('attendance').delete().eq('session_id', session).eq('player_id', a[0])).error).toBeNull()
    expect((await owner.rpc('begin_match', args())).error?.message).toContain('roster_invalid')
    expect((await owner.rpc('release_retained_pair', release)).error).toBeNull()
    expect((await owner.rpc('release_retained_pair', release)).error).toBeNull()
    expect(await retained()).toEqual({ retained_pair: null, retained_match_id: null })
    expect((await owner.from('attendance').insert({ session_id: session, player_id: a[0] })).error).toBeNull()
    await complete(args(), 1)
    expect((await owner.rpc('set_session_rotation', { ...rotation, p_rotation_mode: 'all_out' })).error).toBeNull()
    expect(await retained()).toEqual({ retained_pair: null, retained_match_id: null })
    await complete(args(), 2)
    expect(await retained()).toEqual({ retained_pair: null, retained_match_id: null })

    // Old-season results remain part of an exact-pair rivalry.
    const oldSeason = await service.from('seasons').insert({ group_id: group, name: 'Old rotation test', started_at: '2025-01-01', ended_at: '2025-01-02' }).select('id').single()
    expect(oldSeason.error).toBeNull()
    seasons.push(oldSeason.data!.id)
    const oldSession = await service.from('sessions').insert({ group_id: group, season_id: oldSeason.data!.id, played_on: '2025-01-01' }).select('id').single()
    expect(oldSession.error).toBeNull()
    sessions.push(oldSession.data!.id)
    const oldMatch = await service.from('matches').insert({ group_id: group, session_id: oldSession.data!.id, court_no: 1, mode: 'manual', client_id: crypto.randomUUID(), winner_team: 2, ended_at: new Date().toISOString() }).select('id').single()
    expect(oldMatch.error).toBeNull()
    expect((await service.from('match_players').insert([...a.map(player_id => ({ match_id: oldMatch.data!.id, player_id, team: 1 })), ...b.map(player_id => ({ match_id: oldMatch.data!.id, player_id, team: 2 }))])).error).toBeNull()
    expect(await headToHead()).toEqual({ played: 6, team_a_wins: 3, team_b_wins: 2, draws: 1 })
    // Controlled fixture reservations simulate expired bookings and old days;
    // neither may strand participants in the current session.
    expect((await service.from('session_courts').update({ retained_pair: a, retained_match_id: oldMatch.data!.id }).eq('session_id', oldSession.data!.id).eq('court_no', 1)).error).toBeNull()
    expect((await service.from('session_courts').update({ retained_pair: a, retained_match_id: reverseId, starts_at: new Date(Date.now() - 120_000).toISOString(), ends_at: new Date(Date.now() - 60_000).toISOString() }).eq('session_id', session).eq('court_no', 2)).error).toBeNull()
    await complete(args(), 0)
    expect(await retained()).toEqual({ retained_pair: null, retained_match_id: null })
  } finally {
    if (sessions.length) {
      expect((await service.from('matches').delete().in('session_id', sessions)).error).toBeNull()
      expect((await service.from('sessions').delete().in('id', sessions)).error).toBeNull()
    }
    if (players.length) expect((await service.from('players').delete().in('id', players)).error).toBeNull()
    if (seasons.length) expect((await service.from('seasons').delete().in('id', seasons)).error).toBeNull()
    if (userId) expect((await service.auth.admin.deleteUser(userId)).error).toBeNull()
  }
}, 60_000)
