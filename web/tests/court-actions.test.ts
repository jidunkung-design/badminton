import { beforeEach, expect, it, vi } from 'vitest'

const { rpc, query, canManage } = vi.hoisted(() => ({ rpc: vi.fn(), canManage: vi.fn(), query: { delete: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), lte: vi.fn(), gt: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc, from: () => query }) }))
vi.mock('@/lib/roles', () => ({ canManage }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { toggleAttendance, openSession, saveCourt, startMatch, saveRotation, releaseCourtPair, getPairHeadToHead } from '@/app/g/[groupId]/play/actions'

const groupId = '33333333-3333-3333-3333-333333333333'
const sessionId = '44444444-4444-4444-4444-444444444444'
beforeEach(() => {
  vi.resetAllMocks()
  canManage.mockResolvedValue(true)
  query.delete.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  for (const key of ['order', 'limit', 'lte', 'gt'] as const) query[key].mockReturnValue(query)
  query.single.mockResolvedValue({ data: { played_on: '2026-09-16' }, error: null })
  rpc.mockResolvedValue({ data: sessionId, error: null })
})

it('saves court booking in Bangkok time and supports crossing midnight', async () => {
  const form = new FormData()
  for (const [key, value] of Object.entries({ groupId, sessionId, courtNo: '3', startsTime: '22:00', endsTime: '01:00' })) form.set(key, value)
  expect((await saveCourt({}, form)).success).toBeTruthy()
  expect(rpc).toHaveBeenCalledWith('save_session_court', {
    p_group_id: groupId, p_session_id: sessionId, p_court_no: 3,
    p_starts_at: '2026-09-16T15:00:00.000Z', p_ends_at: '2026-09-16T18:00:00.000Z',
  })
  rpc.mockClear()
  form.set('startsTime', '25:00')
  expect((await saveCourt({}, form)).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})

it('starts the same queued match ID through the server and reports booking rejection', async () => {
  const input = { groupId, sessionId, clientId: '55555555-5555-5555-5555-555555555555', courtNo: 2, mode: 'mix' as const, balanceWeight: .5, teamA: ['a', 'b'] as [string,string], teamB: ['c','d'] as [string,string] }
  rpc.mockResolvedValue({ data: '2026-09-16T12:00:00Z', error: null })
  expect(await startMatch(input)).toEqual({ startedAt: '2026-09-16T12:00:00Z', error: null })
  expect(rpc).toHaveBeenCalledWith('begin_match', expect.objectContaining({ p_client_id: input.clientId, p_court_no: 2 }))
  rpc.mockResolvedValue({ data: null, error: { message: 'court_unavailable', code: 'P0001' } })
  const rejected = await startMatch(input)
  expect(rejected.error).toContain('เวลาจอง')
  expect(rejected.retry).toBe(false)
  rpc.mockRejectedValue(new Error('connection lost'))
  expect((await startMatch(input)).retry).toBe(true)
})

it('resumes the original session for an active game or an overnight booking', async () => {
  query.maybeSingle.mockResolvedValueOnce({ data: { session_id: sessionId }, error: null })
  expect(await openSession(groupId)).toEqual({ sessionId, error: null })
  expect(query.maybeSingle).toHaveBeenCalledTimes(1)
  query.maybeSingle.mockClear().mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { session_id: sessionId }, error: null })
  expect(await openSession(groupId)).toEqual({ sessionId, error: null })
  expect(query.maybeSingle).toHaveBeenCalledTimes(2)
  expect(query.lte).toHaveBeenCalledWith('starts_at', expect.any(String))
  expect(query.gt).toHaveBeenCalledWith('ends_at', expect.any(String))
})

it('saves the session rotation mode and reports active-game refusal', async () => {
  const form = new FormData()
  for (const [key, value] of Object.entries({ groupId, sessionId, rotationMode: 'winner_stays' })) form.set(key, value)
  expect((await saveRotation({}, form)).success).toBeTruthy()
  expect(rpc).toHaveBeenCalledWith('set_session_rotation', { p_group_id: groupId, p_session_id: sessionId, p_rotation_mode: 'winner_stays' })
  rpc.mockResolvedValueOnce({ error: { message: 'session_busy' } })
  expect((await saveRotation({}, form)).error).toContain('ทุกสนามจบเกม')
  rpc.mockClear()
  form.set('rotationMode', 'invented')
  expect((await saveRotation({}, form)).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it('releases only the requested retained court and keeps the failure retryable', async () => {
  expect(await releaseCourtPair(groupId, sessionId, 2, 'held-match')).toEqual({ error: null })
  expect(rpc).toHaveBeenCalledWith('release_retained_pair', { p_group_id: groupId, p_session_id: sessionId, p_court_no: 2, p_retained_match_id: 'held-match' })
  rpc.mockResolvedValueOnce({ error: { message: 'court_busy' } })
  expect((await releaseCourtPair(groupId, sessionId, 2, 'held-match')).error).toContain('สนามกำลังเล่น')
  rpc.mockResolvedValueOnce({ error: { message: 'retained_pair_changed' } })
  expect((await releaseCourtPair(groupId, sessionId, 2, 'held-match')).error).toContain('ทีมที่อยู่ต่อเปลี่ยนแล้ว')
})
it('reads head-to-head with the exact upcoming team orientation', async () => {
  const data = { played: 7, team_a_wins: 3, team_b_wins: 2, draws: 2 }
  rpc.mockResolvedValueOnce({ data: [data], error: null })
  expect(await getPairHeadToHead(groupId, ['a', 'b'], ['c', 'd'])).toEqual({ data })
  expect(rpc).toHaveBeenCalledWith('get_pair_head_to_head', { p_group_id: groupId, p_team_a: ['a', 'b'], p_team_b: ['c', 'd'] })
  rpc.mockResolvedValueOnce({ error: { message: 'room_forbidden' } })
  expect((await getPairHeadToHead(groupId, ['a', 'b'], ['c', 'd'])).error).toBeTruthy()
})

it('does not report checkout success after manager permission is lost', async () => {
  canManage.mockResolvedValue(false)
  expect((await toggleAttendance(groupId, sessionId, 'player', false)).error).toBeTruthy()
  expect(query.delete).not.toHaveBeenCalled()
})
it('rejects an RLS-filtered checkout when permission changes during the request', async () => {
  canManage.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  query.maybeSingle.mockResolvedValue({ data: null, error: null })
  expect((await toggleAttendance(groupId, sessionId, 'player', false)).error).toBeTruthy()
})
it('allows an authorized retry only after confirming the player is already absent from this session', async () => {
  query.maybeSingle.mockResolvedValueOnce({data:null,error:null})
    .mockResolvedValueOnce({data:{id:sessionId},error:null})
    .mockResolvedValueOnce({data:null,error:null})
  expect(await toggleAttendance(groupId, sessionId, 'player', false)).toEqual({error:null})
  expect(query.eq).toHaveBeenCalledWith('group_id', groupId)
  query.maybeSingle.mockResolvedValueOnce({data:null,error:null})
    .mockResolvedValueOnce({data:{id:sessionId},error:null})
    .mockResolvedValueOnce({data:{player_id:'player'},error:null})
  expect((await toggleAttendance(groupId, sessionId, 'player', false)).error).toBeTruthy()
})
