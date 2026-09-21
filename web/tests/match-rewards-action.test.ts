import { beforeEach, expect, it, vi } from 'vitest'
const { rpc, standings, query } = vi.hoisted(() => ({ rpc: vi.fn(), standings: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), single: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc, from: () => query }) }))
vi.mock('@/lib/group-standings', () => ({ getGroupStandings: standings }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { recordMatch } from '@/app/g/[groupId]/play/actions'
const input = { clientId: 'same-request', sessionId: 'session', groupId: 'room', courtNo: 1, mode: 'mix' as const, balanceWeight: .5, teamA: ['a','b'] as [string,string], teamB: ['c','d'] as [string,string], winnerTeam: 1 as const }
beforeEach(() => { vi.resetAllMocks(); query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.single.mockResolvedValue({data:{rotation_mode:'all_out',retained_pair:null,retained_match_id:null},error:null}); standings.mockResolvedValue({players: [],ratingChanges: [],error:null}) })
it('loads persisted rewards only after the match commits', async () => {
  rpc.mockResolvedValueOnce({data:'match',error:null}).mockResolvedValueOnce({data:[{player_id:'a',coins:32,bonus:20,chest_tier:'bronze',win_streak:3,multiplier:1.2}],error:null}).mockResolvedValueOnce({data:[{player_id:'a',average_minutes:12,timed_games:1}],error:null})
  const result = await recordMatch(input)
  expect(result.error).toBeNull()
  expect(result.rewards?.[0]).toMatchObject({coins:32,multiplier:1.2})
  expect(rpc).toHaveBeenCalledWith('get_match_rewards',{p_match_id:'match'})
  expect(result.durations).toEqual([{player_id:'a',average_minutes:12,timed_games:1}])
  expect(standings).toHaveBeenCalledWith('room', undefined, 'match')
})
it('does not report a saved game as failed if reward summary cannot load', async () => {
  rpc.mockResolvedValueOnce({data:'match',error:null}).mockRejectedValueOnce(new Error('network'))
  const result = await recordMatch(input)
  expect(result.error).toBeNull()
  expect(result.notice).toBeTruthy()
})
it('does not load or display rewards for a rejected save', async () => {
  rpc.mockResolvedValue({error:{message:'unauthorized'}})
  expect((await recordMatch(input)).error).toBeTruthy()
  expect(rpc).toHaveBeenCalledTimes(1)
})

it('persists a draw explicitly and returns the canonical match ID for retention reconciliation', async () => {
  rpc.mockResolvedValueOnce({ data: 'canonical-match', error: null })
    .mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [], error: null })
  const result = await recordMatch({ ...input, winnerTeam: 0 })
  expect(rpc).toHaveBeenCalledWith('record_match', expect.objectContaining({ p_winner_team: 0, p_client_id: input.clientId }))
  expect(result.error).toBeNull()
  expect(result.matchId).toBe('canonical-match')
})

it('uses persisted rotation and actual current reservation instead of inferring a winner hold', async () => {
  rpc.mockResolvedValueOnce({data:'match',error:null}).mockResolvedValue({data:[],error:null})
  query.single.mockResolvedValueOnce({data:{rotation_mode:'winner_stays'},error:null})
    .mockResolvedValueOnce({data:{retained_pair:null,retained_match_id:null},error:null})
  const result = await recordMatch(input)
  expect(result.rotationMode).toBe('winner_stays')
  expect(result.retainedCourt).toEqual({retained_pair:null,retained_match_id:null})
  expect(result.snapshotAt).toEqual(expect.any(String))
})
it('does not invent a retained pair when post-commit rotation and court reads fail', async () => {
  rpc.mockResolvedValueOnce({data:'match',error:null}).mockResolvedValue({data:[],error:null})
  query.single.mockRejectedValue(new Error('network'))
  const result = await recordMatch(input)
  expect(result.error).toBeNull()
  expect(result.rotationMode).toBeUndefined()
  expect(result.retainedCourt).toBeUndefined()
  expect(result.notice).toBeTruthy()
})
