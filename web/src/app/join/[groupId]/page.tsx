import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function JoinStatusPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(groupId)) notFound()
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?join=${groupId}`)
  const { data: membership, error: membershipError } = await supabase.from('group_members')
    .select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
  if (membership) redirect(`/g/${groupId}`)
  const { data: request, error: requestError } = await supabase.from('room_join_requests')
    .select('created_at').eq('group_id', groupId).eq('user_id', user.id).eq('pin_verified', true).maybeSingle()
  const failed = Boolean(membershipError || requestError)

  return (
    <main className="mx-auto max-w-xl space-y-6 py-12 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight">{failed ? 'ยังตรวจสอบคำขอไม่ได้' : request ? 'รอเจ้าของห้องอนุมัติ' : 'ยังไม่มีคำขอที่รออนุมัติ'}</h1>
      <p className="leading-relaxed text-muted" role={failed ? 'alert' : 'status'}>
        {failed ? 'โหลดสถานะไม่สำเร็จ กรุณาลองตรวจสอบอีกครั้ง' : request
          ? 'ส่งคำขอเข้าร่วมแล้ว เมื่อเจ้าของห้องอนุมัติ คุณจะเปิดดูสมาชิกและอันดับของห้องได้ ตรวจสอบสถานะได้จากปุ่มด้านล่าง'
          : 'คำขออาจถูกปฏิเสธหรือ PIN ของห้องเปลี่ยนแล้ว ขอ PIN ปัจจุบันจากหัวก๊วน แล้วส่งคำขออีกครั้งค่ะ'}
      </p>
      <div className="flex flex-wrap gap-3">
        <a href={`/join/${groupId}`} className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-accent-foreground">ตรวจสอบสถานะอีกครั้ง</a>
        {!failed && !request && <Link href={`/login?join=${groupId}`} className="inline-flex min-h-12 items-center justify-center rounded-full border border-foreground/20 px-6 font-semibold">ส่งคำขอเข้าร่วม</Link>}
        <Link href="/" className="inline-flex min-h-12 items-center px-3 text-sm font-semibold text-accent underline underline-offset-4">ห้องของฉัน</Link>
      </div>
      <p className="text-sm text-muted">ใช้เบราว์เซอร์เดิมเพื่อตรวจสอบคำขอของคุณ</p>
    </main>
  )
}
