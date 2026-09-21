import { beforeEach, expect, it, vi } from 'vitest'

const { client, role } = vi.hoisted(() => ({
  client: { from: vi.fn(), rpc: vi.fn(), insert: vi.fn() }, role: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => client }))
vi.mock('@/lib/roles', () => ({ roleInGroup: role }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { addPlayer, archivePlayer, reviewJoinRequest, setRoomPin, setPlayerGender } from '@/app/g/[groupId]/members/actions'

const groupId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
function form(extra: Record<string, string> = {}) {
  const result = new FormData()
  for (const [key, value] of Object.entries({ groupId, userId, playerId: userId, decision: 'approve', name: 'มิน', skill: '3', gender: 'unspecified', pin: '012345', pinConfirmation: '012345', ...extra })) result.set(key, value)
  return result
}
beforeEach(() => {
  vi.resetAllMocks()
  role.mockResolvedValue('owner')
  client.from.mockReturnValue({ insert: client.insert })
  client.insert.mockResolvedValue({ error: null })
  client.rpc.mockResolvedValue({ data: userId, error: null })
})
it('allows only the exact room owner to add players or review requests, including no super override', async () => {
  for (const denied of ['admin', 'member', 'super', null]) {
    role.mockResolvedValue(denied)
    expect((await addPlayer(form())).error).toContain('เจ้าของห้องเท่านั้น')
    expect((await reviewJoinRequest(form())).error).toContain('เจ้าของห้องเท่านั้น')
    expect((await setRoomPin({}, form())).error).toContain('เจ้าของห้องเท่านั้น')
    expect((await setPlayerGender(form())).error).toContain('เจ้าของห้องเท่านั้น')
  }
  expect(client.insert).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
})
it('uses scoped owner actions and the selected approve or reject RPC', async () => {
  expect(await addPlayer(form())).toEqual({ error: null })
  expect(client.insert).toHaveBeenCalledWith({ group_id: groupId, name: 'มิน', skill: 3, gender: 'unspecified' })
  expect(await reviewJoinRequest(form())).toEqual({ error: null })
  expect(client.rpc).toHaveBeenLastCalledWith('approve_room_member', { p_group_id: groupId, p_user_id: userId })
  expect(await reviewJoinRequest(form({ decision: 'reject' }))).toEqual({ error: null })
  expect(client.rpc).toHaveBeenLastCalledWith('reject_room_member', { p_group_id: groupId, p_user_id: userId })
})

it('uses explicitly selected gender for new and existing room players and rejects malformed values', async () => {
  for (const gender of ['male', 'female', 'unspecified']) {
    expect(await addPlayer(form({ gender }))).toEqual({ error: null })
    expect(client.insert).toHaveBeenLastCalledWith({ group_id: groupId, name: 'มิน', skill: 3, gender })
    expect(await setPlayerGender(form({ gender }))).toEqual({ error: null })
    expect(client.rpc).toHaveBeenLastCalledWith('set_player_gender', { p_group_id: groupId, p_player_id: userId, p_gender: gender })
  }
  vi.clearAllMocks()
  for (const gender of ['', 'woman', 'MALE']) {
    expect((await addPlayer(form({ gender }))).error).toContain('เพศสำหรับจัดคู่')
    expect((await setPlayerGender(form({ gender }))).error).toContain('เพศสำหรับจัดคู่')
  }
  expect((await setPlayerGender(form({ playerId: 'invalid' }))).error).toBeTruthy()
  expect(client.insert).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
  client.rpc.mockRejectedValueOnce(new Error('offline'))
  expect((await setPlayerGender(form())).error).toContain('เชื่อมต่อไม่ได้')
})
it('validates identifiers, decision and skill before writing and surfaces backend refusal', async () => {
  expect((await addPlayer(form({ skill: '2.5' }))).error).toBeTruthy()
  expect((await reviewJoinRequest(form({ userId: 'invalid' }))).error).toBeTruthy()
  expect((await reviewJoinRequest(form({ decision: 'make-owner' }))).error).toBeTruthy()
  expect(client.insert).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
  client.rpc.mockResolvedValue({ error: { message: 'owner_required' } })
  expect((await reviewJoinRequest(form())).error).toContain('ไม่สำเร็จ')
})

it('validates PIN and confirmation before writes and never returns the PIN', async () => {
  expect((await setRoomPin({}, form({ pin: '12345' }))).error).toContain('6 หลัก')
  expect((await setRoomPin({}, form({ pinConfirmation: '654321' }))).error).toContain('ไม่ตรงกัน')
  expect(client.rpc).not.toHaveBeenCalled()
  const result = await setRoomPin({}, form())
  expect(client.rpc).toHaveBeenLastCalledWith('set_room_pin', { p_group_id: groupId, p_pin: '012345' })
  expect(result.success).toContain('บันทึก PIN แล้ว')
  expect(JSON.stringify(result)).not.toContain('012345')
  client.rpc.mockRejectedValueOnce(new Error('offline'))
  expect((await setRoomPin({}, form())).error).toContain('เชื่อมต่อไม่ได้')
})

it('does not report archive success when no player was updated', async () => {
  const query = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() }
  query.update.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue({ data: null, error: null })
  client.from.mockReturnValue(query)
  expect((await archivePlayer(form())).error).toContain('ไม่สำเร็จ')
  query.maybeSingle.mockResolvedValue({ data: { id: userId }, error: null })
  expect(await archivePlayer(form())).toEqual({ error: null })
  expect(query.eq).toHaveBeenCalledWith('id', userId)
  expect(query.eq).toHaveBeenCalledWith('group_id', groupId)
})
