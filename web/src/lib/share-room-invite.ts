/** Call directly from a user gesture so the browser can open its native share sheet. */
export async function shareRoomInvite(url: string) {
  if (!navigator.share) return 'unsupported'
  try {
    await navigator.share({ title: 'คำเชิญเข้าห้องก๊วนแบด', text: 'เข้าร่วมห้องก๊วนแบดด้วยลิงก์นี้', url })
    return 'shared'
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}
