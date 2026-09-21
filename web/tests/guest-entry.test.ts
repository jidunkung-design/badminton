import { beforeEach, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({ client: {
  auth: { getUser: vi.fn(), signInAnonymously: vi.fn() }, rpc: vi.fn(), from: vi.fn(),
} }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => client }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/login/LoginForm', () => ({ default: () => null }))
import { enterRoom } from '@/app/login/actions'
import LoginPage from '@/app/login/page'
import JoinStatusPage from '@/app/join/[groupId]/page'

const roomId = 'b4279a39-1731-4e1c-abd4-40d84927137f'
function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ username: 'มิน', roomName: 'ก๊วนวันพุธ', roomId, intent: 'create', pin: '012345', gender: 'unspecified', ...overrides })) data.set(key, value)
  return data
}
beforeEach(() => {
  vi.resetAllMocks()
  client.auth.getUser.mockResolvedValue({ data: { user: null } })
  client.auth.signInAnonymously.mockResolvedValue({ data: { user: { id: 'guest' } }, error: null })
  client.rpc.mockImplementation(async name => ({ data: name === 'join_room' ? { room_id: roomId } : roomId, error: null }))
})
it('rejects malformed input before creating any identity', async () => {
  expect((await enterRoom({}, form({ username: ' ' }))).error).toBeTruthy()
  expect((await enterRoom({}, form({ roomId: '//evil.example' }))).error).toBeTruthy()
  expect((await enterRoom({}, form({ intent: 'owner' }))).error).toBeTruthy()
  expect(client.auth.signInAnonymously).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
})
it('creates an anonymous session, claims unique name, and creates room with stable request ID', async () => {
  await expect(enterRoom({}, form())).resolves.toEqual({ destination: `/g/${roomId}` })
  expect(client.auth.signInAnonymously).toHaveBeenCalledOnce()
  expect(client.rpc.mock.calls).toEqual([
    ['claim_username', { p_username: 'มิน' }],
    ['set_profile_gender', { p_gender: 'unspecified' }],
    ['create_room', { p_name: 'ก๊วนวันพุธ', p_room_id: roomId, p_pin: '012345' }],
  ])
})
it('keeps existing session, stops on username collision, and maps cap errors', async () => {
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'existing' } } })
  client.rpc.mockResolvedValueOnce({ error: { message: 'username_taken' } })
  expect((await enterRoom({}, form())).error).toContain('ชื่อนี้มีคนใช้แล้ว')
  expect(client.auth.signInAnonymously).not.toHaveBeenCalled()
  expect(client.rpc).toHaveBeenCalledTimes(1)
  client.rpc.mockResolvedValueOnce({ data: 'มิน', error: null }).mockResolvedValueOnce({ data: 'unspecified', error: null }).mockResolvedValueOnce({ error: { message: 'group_cap' } })
  expect((await enterRoom({}, form())).error).toContain('ครบ 3 ห้อง')
})
it('requests only the supplied room and returns pending approval navigation without assigning a role', async () => {
  await expect(enterRoom({}, form({ intent: 'join', roomName: '' }))).resolves.toEqual({ destination: `/join/${roomId}` })
  expect(client.rpc).toHaveBeenLastCalledWith('join_room', { p_group_id: roomId, p_pin: '012345' })
})
it('shows a useful error when anonymous auth is disabled and writes no room', async () => {
  client.auth.signInAnonymously.mockResolvedValue({ data: { user: null }, error: { code: 'anonymous_provider_disabled' } })
  expect((await enterRoom({}, form())).error).toContain('ยังไม่เปิด')
  expect(client.rpc).not.toHaveBeenCalled()
})

it('waiting page reads only own membership and request; approval redirects into the room', async () => {
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'guest' } } })
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { created_at: '2026-09-17' }, error: null })
  client.from.mockReturnValue(query)
  await JoinStatusPage({ params: Promise.resolve({ groupId: roomId }) })
  expect(client.from.mock.calls.map(call => call[0])).toEqual(['group_members', 'room_join_requests'])
  expect(query.eq.mock.calls).toEqual([
    ['group_id', roomId], ['user_id', 'guest'], ['group_id', roomId], ['user_id', 'guest'], ['pin_verified', true],
  ])
  query.maybeSingle.mockResolvedValueOnce({ data: { role: 'member' }, error: null })
  await expect(JoinStatusPage({ params: Promise.resolve({ groupId: roomId }) })).rejects.toThrow(`REDIRECT:/g/${roomId}`)
})

it('rejects missing and malformed PINs before auth or any RPC', async () => {
  for (const pin of ['', '12345', '1234567', '12a456', ' 123456', '１２３４５６']) {
    expect((await enterRoom({}, form({ pin }))).error).toContain('6 หลัก')
  }
  expect(client.auth.getUser).not.toHaveBeenCalled()
  expect(client.auth.signInAnonymously).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
})
it('maps PIN rejection responses and never redirects a failed join', async () => {
  for (const [code, text] of [
    ['pin_invalid', 'PIN ไม่ถูกต้อง'], ['pin_locked', 'กรอก PIN ผิดหลายครั้ง'], ['pin_not_configured', 'ยังไม่ได้ตั้ง PIN'],
  ]) {
    client.rpc.mockResolvedValueOnce({ data: 'มิน', error: null })
      .mockResolvedValueOnce({ data: 'unspecified', error: null })
      .mockResolvedValueOnce({ data: { error: code }, error: null })
    const result = await enterRoom({}, form({ intent: 'join' }))
    expect(result.error).toContain(text)
    expect(result.destination).toBeUndefined()
  }
})

it('rejects invalid or absent gender before identity writes and stores an explicit selection before joining', async () => {
  const missing = form()
  missing.delete('gender')
  for (const input of [missing, form({ gender: 'guess-from-name' }), form({ gender: 'MALE' })]) {
    expect((await enterRoom({}, input)).error).toContain('เพศสำหรับจัดคู่')
  }
  expect(client.auth.getUser).not.toHaveBeenCalled()
  expect(client.rpc).not.toHaveBeenCalled()
  await expect(enterRoom({}, form({ intent: 'join', gender: 'female' }))).resolves.toEqual({ destination: `/join/${roomId}` })
  expect(client.rpc.mock.calls.map(call => call[0])).toEqual(['claim_username', 'set_profile_gender', 'join_room'])
  expect(client.rpc).toHaveBeenCalledWith('set_profile_gender', { p_gender: 'female' })
})

it('keeps a returning profile gender selected and stops if saving gender fails', async () => {
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'existing' } } })
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue({ data: { username: 'มิน', gender: 'female' }, error: null })
  client.from.mockReturnValue(query)
  const page = await LoginPage({ searchParams: Promise.resolve({}) })
  expect(page.props.gender).toBe('female')
  expect(query.select).toHaveBeenCalledWith('username, gender')
  client.rpc.mockResolvedValueOnce({ data: 'มิน', error: null }).mockResolvedValueOnce({ error: { message: 'unavailable' } })
  expect((await enterRoom({}, form({ gender: 'female' }))).error).toContain('บันทึกเพศ')
  expect(client.rpc).not.toHaveBeenCalledWith('create_room', expect.anything())
  query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'offline' } })
  const failedProfile = await LoginPage({ searchParams: Promise.resolve({}) })
  expect(failedProfile.type).toBe('main')
  expect(failedProfile.props.children[0].props.children).toBe('โหลดข้อมูลผู้ใช้ไม่สำเร็จ')
})
it('lets an existing member open an invitation without asking for a PIN', async () => {
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'member' } } })
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.maybeSingle.mockResolvedValue({ data: { role: 'member' }, error: null })
  client.from.mockReturnValue(query)
  await expect(LoginPage({ searchParams: Promise.resolve({ join: roomId }) })).rejects.toThrow(`REDIRECT:/g/${roomId}`)
  expect(client.from).toHaveBeenCalledWith('group_members')
  expect(query.eq.mock.calls).toEqual([['group_id', roomId], ['user_id', 'member']])
  expect(client.rpc).not.toHaveBeenCalled()
})

it('returns navigation only for the requested room and keeps retries on the stable request ID', async () => {
  for (const response of ['javascript:alert(1)', '//example.com', 'e4279a39-1731-4e1c-abd4-40d84927137f']) {
    client.rpc.mockResolvedValueOnce({ data: 'มิน', error: null })
      .mockResolvedValueOnce({ data: 'unspecified', error: null })
      .mockResolvedValueOnce({ data: response, error: null })
    const result = await enterRoom({}, form())
    expect(result.error).toBeTruthy()
    expect(result.destination).toBeUndefined()
  }
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'existing' } } })
  const success = await enterRoom({}, form())
  expect(await enterRoom(success, form())).toEqual(success)
  expect(success).toEqual({ destination: `/g/${roomId}` })
  expect(client.rpc).toHaveBeenLastCalledWith('create_room', { p_name: 'ก๊วนวันพุธ', p_room_id: roomId, p_pin: '012345' })
})
