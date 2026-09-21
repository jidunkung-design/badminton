import { afterEach, expect, it, vi } from 'vitest'
import { shareRoomInvite } from '@/lib/share-room-invite'

afterEach(() => vi.unstubAllGlobals())

it('shares the invitation and distinguishes cancellation, failure and unsupported browsers', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const writeText = vi.fn()
  vi.stubGlobal('navigator', { share, clipboard: { writeText } })
  const url = 'https://club.example/login?join=room-id'
  expect(await shareRoomInvite(url)).toBe('shared')
  expect(share).toHaveBeenCalledWith({ title: 'คำเชิญเข้าห้องก๊วนแบด', text: 'เข้าร่วมห้องก๊วนแบดด้วยลิงก์นี้', url })
  share.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
  expect(await shareRoomInvite(url)).toBe('cancelled')
  expect(writeText).not.toHaveBeenCalled()
  share.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
  expect(await shareRoomInvite(url)).toBe('failed')
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  expect(await shareRoomInvite(url)).toBe('unsupported')
})
