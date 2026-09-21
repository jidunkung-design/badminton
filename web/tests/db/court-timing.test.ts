import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { playingDate } from '../../src/lib/playing-date'

it('persists court windows and active games, records real durations once, and excludes legacy clocks', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const stranger = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const groupId = '66666666-6666-6666-6666-666666666666'
  const players: string[] = []
  let sessionId: string | undefined
  let secondSessionId: string | undefined
  let createdSeason: string | undefined
  try {
    expect((await owner.auth.signInWithPassword({ email: 'realowner@example.com', password: 'password123' })).error).toBeNull()
    expect((await stranger.auth.signInWithPassword({ email: 'member@example.com', password: 'password123' })).error).toBeNull()
    const existing = await service.from('seasons').select('id').eq('group_id', groupId).is('ended_at', null).maybeSingle()
    expect(existing.error).toBeNull()
    let seasonId = existing.data?.id
    if (!seasonId) {
      const season = await owner.from('seasons').insert({ group_id: groupId, name: 'Court timing test' }).select('id').single()
      expect(season.error).toBeNull()
      seasonId = season.data!.id
      createdSeason = seasonId
    }
    const today = playingDate()
    const start = new Date(`${today}T00:00:00+07:00`)
    const end = new Date(start.getTime() + 24 * 60 * 60_000)
    const created = await owner.from('sessions').insert({ group_id: groupId, season_id: seasonId, played_on: today }).select('id').single()
    expect(created.error).toBeNull()
    sessionId = created.data!.id
    const courts = await owner.from('session_courts').select('court_no,starts_at,ends_at').eq('session_id', sessionId).order('court_no')
    expect(courts.error).toBeNull()
    expect(courts.data).toEqual([{ court_no: 1, starts_at: null, ends_at: null }, { court_no: 2, starts_at: null, ends_at: null }])
    expect((await stranger.from('session_courts').select('*').eq('session_id', sessionId)).data).toEqual([])
    const added = await owner.from('players').insert(Array.from({ length: 4 }, (_, i) => ({ group_id: groupId, name: `timing ${i} ${crypto.randomUUID().slice(0, 8)}` }))).select('id')
    expect(added.error).toBeNull()
    players.push(...added.data!.map(p => p.id))
    expect((await owner.from('attendance').insert(players.map(player_id => ({ session_id: sessionId!, player_id })))).error).toBeNull()
    const args = { p_client_id: crypto.randomUUID(), p_session_id: sessionId, p_group_id: groupId,
      p_court_no: 1, p_mode: 'manual', p_balance_weight: 0.5, p_team_a: players.slice(0, 2), p_team_b: players.slice(2) }
    const booking = { p_group_id: groupId, p_session_id: sessionId, p_court_no: 1, p_starts_at: start.toISOString(), p_ends_at: end.toISOString() }
    expect((await stranger.rpc('save_session_court', booking)).error?.message).toContain('room_forbidden')
    expect((await owner.rpc('save_session_court', { ...booking, p_ends_at: start.toISOString() })).error?.message).toContain('booking_invalid')
    expect((await owner.rpc('save_session_court', { ...booking, p_ends_at: new Date(end.getTime() + 1).toISOString() })).error?.message).toContain('booking_invalid')
    expect((await owner.rpc('save_session_court', { ...booking, p_starts_at: new Date(start.getTime() - 60_000).toISOString() })).error?.message).toContain('booking_invalid')
    expect((await owner.rpc('save_session_court', booking)).error).toBeNull()
    const overnightStart = new Date(start.getTime() + 23 * 60 * 60_000).toISOString()
    const overnightEnd = new Date(end.getTime() + 60 * 60_000).toISOString()
    expect((await owner.rpc('save_session_court', { ...booking, p_court_no: 3, p_starts_at: overnightStart, p_ends_at: overnightEnd })).error).toBeNull()
    expect((await owner.from('session_courts').update({ ends_at: overnightEnd }).eq('session_id', sessionId).eq('court_no', 1)).error).not.toBeNull()
    expect((await owner.rpc('begin_match', { ...args, p_court_no: 99 })).error?.message).toContain('court_not_configured')
    expect((await stranger.rpc('begin_match', args)).error?.message).toContain('room_forbidden')
    expect((await owner.rpc('begin_match', { ...args, p_team_b: [players[0], players[2]] })).error?.message).toContain('match_invalid')

    // Old clients can finish without a timer, but their insert-at-finish clock
    // must never appear as a near-zero measured match in duration averages.
    expect((await owner.rpc('record_match', { ...args, p_client_id: crypto.randomUUID(), p_winner_team: 1 })).error?.message).toContain('match_start_required')
    expect((await owner.rpc('record_match', { ...args, p_court_no: 99, p_client_id: crypto.randomUUID(), p_winner_team: 1 })).error?.message).toContain('court_invalid')
    const legacyArgs = { ...args, p_court_no: 2, p_client_id: crypto.randomUUID(), p_winner_team: 1 }
    const legacy = await owner.rpc('record_match', legacyArgs)
    expect(legacy.error).toBeNull()
    expect((await owner.from('matches').select('play_started_at,play_ended_at').eq('id', legacy.data).single()).data).toEqual({ play_started_at: null, play_ended_at: null })
    const legacyDurations = await owner.rpc('get_player_durations', { p_group_id: groupId })
    expect(legacyDurations.error).toBeNull()
    expect(legacyDurations.data.filter((p: { player_id: string }) => players.includes(p.player_id))).toEqual([])
    expect((await stranger.rpc('get_player_durations', { p_group_id: groupId })).error?.message).toContain('room_forbidden')
    expect((await owner.rpc('record_match_core', { ...args, p_winner_team: 1 })).error).not.toBeNull()

    // Choose a window outside now even when the test runs near midnight.
    const nearMidnight = Date.now() - start.getTime() < 120_000
    const closedStart = nearMidnight ? new Date(start.getTime() + 60 * 60_000) : start
    const closedEnd = new Date(closedStart.getTime() + 60_000)
    expect((await owner.rpc('save_session_court', { ...booking, p_court_no: 2, p_starts_at: closedStart.toISOString(), p_ends_at: closedEnd.toISOString() })).error).toBeNull()
    expect((await owner.rpc('begin_match', { ...args, p_court_no: 2 })).error?.message).toContain('court_unavailable')
    expect((await owner.rpc('save_session_court', { ...booking, p_court_no: 2 })).error).toBeNull()
    const starts = await Promise.all([0, 1].map(() => owner.rpc('begin_match', args)))
    expect(starts.map(result => result.error)).toEqual([null, null])
    expect(starts[0].data).toBe(starts[1].data)
    expect((await owner.from('active_court_matches').select('client_id,started_at').eq('session_id', sessionId)).data).toEqual([{ client_id: args.p_client_id, started_at: starts[0].data }])
    expect((await stranger.from('active_court_matches').select('*').eq('session_id', sessionId)).data).toEqual([])
    expect((await owner.from('active_court_matches').delete().eq('client_id', args.p_client_id)).error).not.toBeNull()
    expect((await owner.rpc('begin_match', { ...args, p_mode: 'fair' })).error?.message).toContain('match_replay_conflict')
    expect((await owner.rpc('begin_match', { ...args, p_client_id: crypto.randomUUID() })).error?.message).toContain('court_busy')
    expect((await owner.rpc('begin_match', { ...args, p_client_id: crypto.randomUUID(), p_court_no: 2 })).error?.message).toContain('players_busy')
    expect((await owner.rpc('save_session_court', booking)).error?.message).toContain('court_busy')
    const secondSession = await owner.from('sessions').insert({ group_id: groupId, season_id: seasonId, played_on: today }).select('id').single()
    expect(secondSession.error).toBeNull()
    secondSessionId = secondSession.data!.id
    expect((await owner.from('attendance').insert(players.map(player_id => ({ session_id: secondSessionId!, player_id })))).error).toBeNull()
    expect((await owner.rpc('begin_match', { ...args, p_session_id: secondSessionId, p_client_id: crypto.randomUUID() })).error?.message).toContain('players_busy')
    expect((await owner.rpc('record_match', { ...args, p_session_id: secondSessionId, p_client_id: crypto.randomUUID(), p_winner_team: 1 })).error?.message).toContain('players_busy')
    // An already-saved legacy game remains retryable after its booking changes.
    expect((await owner.rpc('record_match', legacyArgs)).data).toBe(legacy.data)

    expect((await owner.rpc('record_match', { ...args, p_team_a: args.p_team_b, p_team_b: args.p_team_a, p_winner_team: 1 })).error?.message).toContain('match_replay_conflict')
    expect((await owner.rpc('record_match', { ...args, p_winner_team: 3 })).error?.message).toContain('match_invalid')
    expect((await owner.from('active_court_matches').select('client_id').eq('session_id', sessionId)).data).toHaveLength(1)

    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    expect((await service.from('active_court_matches').update({ started_at: tenMinutesAgo }).eq('client_id', args.p_client_id)).error).toBeNull()
    const finished = await Promise.all([0, 1].map(() => owner.rpc('record_match', { ...args, p_winner_team: 1 })))
    expect(finished.map(result => result.error)).toEqual([null, null])
    expect(finished[0].data).toBe(finished[1].data)
    const measured = await owner.from('matches').select('started_at,ended_at,play_started_at,play_ended_at').eq('id', finished[0].data).single()
    expect(measured.error).toBeNull()
    expect(Date.parse(measured.data!.play_started_at)).toBe(Date.parse(tenMinutesAgo))
    expect(measured.data!.play_ended_at).toBe(measured.data!.ended_at)
    expect(Date.parse(measured.data!.started_at) - Date.parse(measured.data!.play_started_at)).toBeGreaterThanOrEqual(10 * 60_000)
    expect((await owner.from('active_court_matches').select('*').eq('session_id', sessionId)).data).toEqual([])
    const firstAverages = await owner.rpc('get_player_durations', { p_group_id: groupId })
    expect(firstAverages.error).toBeNull()
    for (const id of players) {
      const average = firstAverages.data.find((p: { player_id: string }) => p.player_id === id)
      expect(average.timed_games).toBe(1)
      expect(average.average_minutes).toBeCloseTo(10, 1)
    }
    expect((await owner.rpc('begin_match', args)).error?.message).toContain('match_already_recorded')
    const next = { ...args, p_client_id: crypto.randomUUID(), p_court_no: 2 }
    expect((await owner.rpc('begin_match', next)).error).toBeNull()
    expect((await owner.rpc('record_match', { ...args, p_winner_team: 1 })).data).toBe(finished[0].data)
    expect((await owner.from('active_court_matches').select('client_id').eq('session_id', sessionId)).data).toEqual([{ client_id: next.p_client_id }])
    expect((await service.from('active_court_matches').update({ started_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('client_id', next.p_client_id)).error).toBeNull()
    expect((await owner.rpc('record_match', { ...next, p_winner_team: 2 })).error).toBeNull()
    const averages = await owner.rpc('get_player_durations', { p_group_id: groupId })
    expect(averages.error).toBeNull()
    for (const id of players) {
      const average = averages.data.find((p: { player_id: string }) => p.player_id === id)
      expect(average.timed_games).toBe(2)
      expect(average.average_minutes).toBeCloseTo(15, 1)
    }
  } finally {
    if (sessionId) {
      expect((await service.from('matches').delete().eq('session_id', sessionId)).error).toBeNull()
      expect((await service.from('sessions').delete().eq('id', sessionId)).error).toBeNull()
    }
    if (secondSessionId) expect((await service.from('sessions').delete().eq('id', secondSessionId)).error).toBeNull()
    if (players.length) expect((await service.from('players').delete().in('id', players)).error).toBeNull()
    if (createdSeason) expect((await service.from('seasons').delete().eq('id', createdSeason)).error).toBeNull()
  }
}, 60_000)
