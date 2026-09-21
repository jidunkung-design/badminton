import { beforeEach, expect, it, vi } from 'vitest'

const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc, auth: { getUser } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { updateLocker } from '@/app/mascot/actions'

const requestId = 'beacb1d0-a985-4d83-a862-9f313cd6fb61'
beforeEach(() => { vi.resetAllMocks(); getUser.mockResolvedValue({ data: { user: { id: 'current-user' } } }) })

it('rejects malformed actions before any RPC and requires an authenticated user', async () => {
  expect((await updateLocker({ kind: 'save', skin: 'warm', hair: 'short', equipped: { coins: '9999' } }, requestId)).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
  getUser.mockResolvedValue({ data: { user: null } })
  expect((await updateLocker({ kind: 'buyChest', target: 'gold' }, requestId)).error).toContain('เข้าห้อง')
  expect(rpc).not.toHaveBeenCalled()
})

it('preserves retry when the write succeeds but refreshing the locker fails', async () => {
  const operation = { kind: 'openChest', target: 'bronze' }
  const opened = { item: { id: 'shirt' }, duplicate: false, refund: 0 }
  rpc.mockResolvedValueOnce({ data: opened, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'network' } })
  expect((await updateLocker(operation, requestId)).retry).toBe(true)
  rpc.mockResolvedValueOnce({ data: opened, error: null }).mockResolvedValueOnce({ data: { coins: 20 }, error: null })
  expect(await updateLocker(operation, requestId)).toEqual({ locker: { coins: 20 }, opened })
  expect(rpc.mock.calls.filter(([name]) => name === 'open_chest')).toEqual([
    ['open_chest', { p_tier: 'bronze', p_request_id: requestId }],
    ['open_chest', { p_tier: 'bronze', p_request_id: requestId }],
  ])
})

it('handles rejected purchases without implying a charge and uncertain failures with retry', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'insufficient_coins', code: 'P0001' } })
  const rejected = await updateLocker({ kind: 'buyItem', target: 'shirt' }, requestId)
  expect(rejected.error).toContain('เหรียญยังไม่พอ')
  expect(rejected.retry).toBeUndefined()
  rpc.mockRejectedValueOnce(new Error('connection reset'))
  expect((await updateLocker({ kind: 'buyChest', target: 'silver' }, requestId)).retry).toBe(true)
})
