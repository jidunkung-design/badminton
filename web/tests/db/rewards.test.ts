import { expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { TEST_ROOM_PIN } from './room-pin-fixture'

type Locker = { coins: number; boxes: Record<string, number>; owned: string[]; catalog: { id: string }[] }
type Reward = { player_id: string; coins: number; bonus: number; win_streak: number; multiplier: number }

it('awards matches once, applies room streaks, and securely serializes purchases and loot retries', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local database only')
  const options = { auth: { persistSession: false } }
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)
  const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
  const owner = client(), member = client(), outsider = client()
  const users: string[] = []
  const room = crypto.randomUUID()
  let createdRoom = false
  const locker = async (c = owner) => {
    const result = await c.rpc('get_my_locker')
    expect(result.error).toBeNull()
    return result.data as Locker
  }
  try {
    for (const c of [owner, member]) {
      const signed = await c.auth.signInAnonymously()
      expect(signed.error).toBeNull()
      users.push(signed.data.user!.id)
      expect((await c.rpc('claim_username', { p_username: `loot_${crypto.randomUUID().slice(0, 8)}` })).error).toBeNull()
    }
    expect((await owner.rpc('create_room', { p_pin: TEST_ROOM_PIN, p_name: 'Rewards test', p_room_id: room })).error).toBeNull()
    createdRoom = true
    expect((await member.rpc('join_room', { p_group_id: room, p_pin: TEST_ROOM_PIN })).data).toEqual({ room_id: room })
    expect((await owner.rpc('approve_room_member', { p_group_id: room, p_user_id: users[1] })).error).toBeNull()
    const manual = await owner.from('players').insert([{ group_id: room, name: 'manual one' }, { group_id: room, name: 'manual two' }]).select('id')
    expect(manual.error).toBeNull()
    const linked = await owner.from('players').select('id,user_id').eq('group_id', room).not('user_id', 'is', null)
    const playerA = linked.data!.find(p => p.user_id === users[0])!.id
    const playerB = linked.data!.find(p => p.user_id === users[1])!.id
    const season = (await owner.from('seasons').select('id').eq('group_id', room).single()).data!.id
    const session = await owner.from('sessions').insert({ group_id: room, season_id: season, played_on: '2026-09-01' }).select('id').single()
    expect(session.error).toBeNull()
    const players = [playerA, manual.data![0].id, playerB, manual.data![1].id]
    expect((await owner.from('attendance').insert(players.map(player_id => ({ session_id: session.data!.id, player_id })))).error).toBeNull()
    const args = { p_client_id: crypto.randomUUID(), p_session_id: session.data!.id, p_group_id: room,
      p_court_no: 1, p_mode: 'manual', p_balance_weight: 0.5, p_winner_team: 1,
      p_team_a: players.slice(0, 2), p_team_b: players.slice(2) }
    expect((await member.rpc('record_match', args)).error?.message).toContain('room_forbidden')
    expect((await owner.rpc('record_match', { ...args, p_team_a: [playerA, playerA] })).error?.message).toContain('match_invalid')
    expect((await owner.rpc('record_match', { ...args, p_team_a: [] })).error?.message).toContain('match_invalid')
    expect((await owner.from('matches').insert({ client_id: args.p_client_id, session_id: session.data!.id, group_id: room, court_no: 1, mode: 'manual' })).error).not.toBeNull()
    expect((await owner.from('sessions').update({ season_id: season }).eq('id', session.data!.id)).error).not.toBeNull()
    expect((await owner.rpc('record_match', { ...args, p_team_a: [playerA, crypto.randomUUID()] })).error?.message).toContain('roster_invalid')
    expect((await locker()).coins).toBe(0)
    expect((await owner.from('cosmetic_wallets').update({ coins: 9999 }).eq('user_id', users[0])).error).not.toBeNull()
    expect((await owner.rpc('buy_cosmetic', { p_item_id: 'head-common', p_request_id: crypto.randomUUID() })).error?.message).toContain('insufficient_coins')
    expect((await owner.rpc('save_mascot', { p_skin: 'warm', p_hair: 'short', p_equipped: { head: 'head-common' } })).error?.message).toContain('equipment_not_owned')
    const replay = await Promise.all([0, 1].map(() => owner.rpc('record_match', args)))
    expect(replay.map(r => r.error)).toEqual([null, null])
    expect(replay[0].data).toBe(replay[1].data)
    expect((await owner.rpc('record_match', { ...args, p_winner_team: 2 })).error?.message).toContain('match_replay_conflict')
    const firstRewards = await owner.rpc('get_match_rewards', { p_match_id: replay[0].data })
    expect(firstRewards.error).toBeNull()
    expect(firstRewards.data).toHaveLength(2) // Manual players have no account wallet.
    expect((firstRewards.data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ coins: 30, bonus: 20, win_streak: 1, multiplier: 1 })
    expect((await locker()).coins).toBe(30)
    const second = await owner.rpc('record_match', { ...args, p_client_id: crypto.randomUUID() })
    expect(second.error).toBeNull()
    const secondRewards = await member.rpc('get_match_rewards', { p_match_id: second.data })
    expect((secondRewards.data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ coins: 11, bonus: 0, win_streak: 2, multiplier: 1.1 })
    expect((secondRewards.data as Reward[]).find(r => r.player_id === playerB)).toMatchObject({ coins: 10, win_streak: 0 })
    for (const [streak, multiplier] of [[3, 1.2], [4, 1.3], [5, 1.5]]) {
      const win = await owner.rpc('record_match', { ...args, p_client_id: crypto.randomUUID() })
      expect(win.error).toBeNull()
      const rewards = await owner.rpc('get_match_rewards', { p_match_id: win.data })
      expect((rewards.data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ win_streak: streak, multiplier, coins: 10 * multiplier, bonus: 0 })
    }
    expect((await locker()).coins).toBe(81)
    expect(Object.values((await locker()).boxes).reduce((a, b) => a + b, 0)).toBe(5)
    const extra = await owner.from('players').insert({ group_id: room, name: 'roster replacement F' }).select('id').single()
    expect(extra.error).toBeNull()
    const playerF = extra.data!.id
    const recordDay = async (day: string, roster: string[]) => {
      const nextSession = await owner.from('sessions').insert({ group_id: room, season_id: season, played_on: day }).select('id').single()
      expect(nextSession.error).toBeNull()
      expect((await owner.from('attendance').insert([...roster].reverse().map(player_id => ({ session_id: nextSession.data!.id, player_id })))).error).toBeNull()
      const match = await owner.rpc('record_match', { ...args, p_client_id: crypto.randomUUID(), p_session_id: nextSession.data!.id,
        p_team_a: roster.slice(0, 2), p_team_b: roster.slice(2, 4) })
      expect(match.error).toBeNull()
      const rewards = await owner.rpc('get_match_rewards', { p_match_id: match.data })
      expect(rewards.error).toBeNull()
      const snapshot = await owner.from('matches').select('streak_roster').eq('id', match.data).single()
      expect(snapshot.data!.streak_roster).toEqual([...roster].sort())
      return { match: match.data, session: nextSession.data!.id, reward: (rewards.data as Reward[]).find(r => r.player_id === playerA) }
    }
    // ABCD -> ABCD carries the five wins across weeks; ABCF and the return
    // to ABCD each reset, instead of reviving an earlier roster's streak.
    expect((await recordDay('2026-09-08', players)).reward).toMatchObject({ win_streak: 6, multiplier: 1.5, coins: 15 })
    expect((await recordDay('2026-09-15', [...players.slice(0, 3), playerF])).reward).toMatchObject({ win_streak: 1, multiplier: 1, coins: 10 })
    expect((await recordDay('2026-09-22', players)).reward).toMatchObject({ win_streak: 1, multiplier: 1, coins: 10 })
    expect((await recordDay('2026-09-29', players)).reward).toMatchObject({ win_streak: 2, multiplier: 1.1, coins: 11 })
    // Reset still reaches A when A was absent for the intervening roster.
    await recordDay('2026-10-06', [playerF, ...players.slice(1)])
    expect((await recordDay('2026-10-13', players)).reward).toMatchObject({ win_streak: 1, coins: 10 })
    // Another same-day session contributes a resting fifth person. Repeated
    // attendance across those sessions must be deduplicated in the snapshot.
    const sameDay = await owner.from('sessions').insert({ group_id: room, season_id: season, played_on: '2026-10-20' }).select('id').single()
    expect(sameDay.error).toBeNull()
    expect((await owner.from('attendance').insert([playerF, playerA].map(player_id => ({ session_id: sameDay.data!.id, player_id })))).error).toBeNull()
    const daySession = await owner.from('sessions').insert({ group_id: room, season_id: season, played_on: '2026-10-20' }).select('id').single()
    expect(daySession.error).toBeNull()
    expect((await owner.from('attendance').insert(players.map(player_id => ({ session_id: daySession.data!.id, player_id })))).error).toBeNull()
    const dayArgs = { ...args, p_client_id: crypto.randomUUID(), p_session_id: daySession.data!.id }
    const fiveRosterMatch = await owner.rpc('record_match', dayArgs)
    expect(fiveRosterMatch.error).toBeNull()
    const fiveRoster = [...players, playerF].sort()
    expect((await owner.from('matches').select('streak_roster').eq('id', fiveRosterMatch.data).single()).data?.streak_roster).toEqual(fiveRoster)
    expect(((await owner.rpc('get_match_rewards', { p_match_id: fiveRosterMatch.data })).data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ win_streak: 1, coins: 10 })
    // Rotate the four players without changing the five-person day roster.
    expect((await owner.from('attendance').insert({ session_id: daySession.data!.id, player_id: playerF })).error).toBeNull()
    const rotated = await owner.rpc('record_match', { ...dayArgs, p_client_id: crypto.randomUUID(),
      p_team_a: [playerA, playerF], p_team_b: players.slice(2) })
    expect(rotated.error).toBeNull()
    expect((await owner.from('matches').select('streak_roster').eq('id', rotated.data).single()).data?.streak_roster).toEqual(fiveRoster)
    expect(((await owner.rpc('get_match_rewards', { p_match_id: rotated.data })).data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ win_streak: 2, multiplier: 1.1, coins: 11 })
    expect((await owner.from('attendance').delete().eq('session_id', sameDay.data!.id).eq('player_id', playerF)).error).toBeNull()
    expect((await owner.from('attendance').delete().eq('session_id', daySession.data!.id).eq('player_id', playerF)).error).toBeNull()
    expect((await owner.from('matches').select('streak_roster').eq('id', fiveRosterMatch.data).single()).data?.streak_roster).toEqual(fiveRoster)
    // A retry never recomputes a snapshot after attendance changes.
    expect((await owner.rpc('record_match', dayArgs)).data).toBe(fiveRosterMatch.data)
    const afterChange = await owner.rpc('record_match', { ...dayArgs, p_client_id: crypto.randomUUID() })
    expect(afterChange.error).toBeNull()
    expect(((await owner.rpc('get_match_rewards', { p_match_id: afterChange.data })).data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ win_streak: 1, coins: 10 })
    // Simulate a migrated legacy row; mutable attendance must not fill its unknown snapshot.
    expect((await service.from('matches').update({ streak_roster: null }).eq('id', afterChange.data)).error).toBeNull()
    const afterLegacy = await owner.rpc('record_match', { ...dayArgs, p_client_id: crypto.randomUUID() })
    expect(afterLegacy.error).toBeNull()
    expect(((await owner.rpc('get_match_rewards', { p_match_id: afterLegacy.data })).data as Reward[]).find(r => r.player_id === playerA)).toMatchObject({ win_streak: 1, multiplier: 1, coins: 10 })
    for (const winner of [2, 1]) expect((await owner.rpc('record_match', { ...args, p_client_id: crypto.randomUUID(), p_winner_team: winner })).error).toBeNull()
    expect((await outsider.rpc('get_match_rewards', { p_match_id: second.data })).error).not.toBeNull()
    expect((await outsider.rpc('group_mascots', { p_group_id: room })).error).not.toBeNull()

    expect((await service.from('cosmetic_wallets').update({ coins: 60 }).eq('user_id', users[0])).error).toBeNull()
    const purchases = await Promise.all(['head-common', 'outfit-common'].map(p_item_id => owner.rpc('buy_cosmetic', { p_item_id, p_request_id: crypto.randomUUID() })))
    expect(purchases.filter(r => !r.error)).toHaveLength(1)
    expect((await locker()).coins).toBe(10)
    expect((await owner.rpc('buy_chest', { p_tier: 'gold', p_request_id: crypto.randomUUID() })).error?.message).toContain('insufficient_coins')
    const item = (await locker()).owned[0]
    expect((await owner.rpc('save_mascot', { p_skin: 'deep', p_hair: 'bob', p_equipped: { [item.split('-')[0]]: item } })).error).toBeNull()
    expect((await owner.rpc('save_mascot', { p_skin: 'deep', p_hair: 'bob', p_equipped: { racket: item } })).error?.message).toContain('equipment_not_owned')
    const avatars = await member.rpc('group_mascots', { p_group_id: room })
    expect(avatars.error).toBeNull()
    expect(avatars.data.find((a: { player_id: string }) => a.player_id === playerA)).toMatchObject({ skin: 'deep', hair: 'bob' })
    const allItems = (await locker()).catalog.map(c => c.id)
    expect((await service.from('cosmetic_wallets').update({ coins: 100, owned: allItems, boxes: { bronze: 1, silver: 0, gold: 0 } }).eq('user_id', users[0])).error).toBeNull()
    const request = crypto.randomUUID()
    const opened = await Promise.all([0, 1].map(() => owner.rpc('open_chest', { p_tier: 'bronze', p_request_id: request })))
    expect(opened.map(r => r.error)).toEqual([null, null])
    expect(opened[0].data).toEqual(opened[1].data)
    expect(opened[0].data.duplicate).toBe(true)
    expect([5, 15, 40]).toContain(opened[0].data.refund)
    expect((await locker()).coins).toBe(100 + opened[0].data.refund)
    expect((await locker()).boxes.bronze).toBe(0)
    expect((await owner.rpc('open_chest', { p_tier: 'bronze', p_request_id: crypto.randomUUID() })).error?.message).toContain('chest_empty')
    expect((await owner.rpc('buy_chest', { p_tier: 'bronze', p_request_id: request })).error?.message).toContain('request_conflict')
    const buyRequest = crypto.randomUUID()
    const bought = await Promise.all([0, 1].map(() => owner.rpc('buy_chest', { p_tier: 'bronze', p_request_id: buyRequest })))
    expect(bought.map(r => r.error)).toEqual([null, null])
    expect((await locker()).boxes.bronze).toBe(1)
    expect((await locker()).coins).toBe(70 + opened[0].data.refund)
  } finally {
    if (createdRoom) {
      // Service role may clean up this test's rows; clear RESTRICT references
      // before group cascades reach players, independent of trigger order.
      expect((await service.from('matches').delete().eq('group_id', room)).error).toBeNull()
      expect((await service.from('sessions').delete().eq('group_id', room)).error).toBeNull()
      expect((await service.from('groups').delete().eq('id', room)).error).toBeNull()
    }
    for (const id of users) await service.auth.admin.deleteUser(id)
  }
}, 60_000)
