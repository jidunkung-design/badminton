import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { roleInGroup } from '@/lib/roles'
import { GroupNav } from '@/components/group-nav'
import { RoomInvite } from '@/components/room-invite'
import { GroupRankings } from '@/components/group-rankings'

const ROLE_LABEL: Record<string, string> = {
  super: 'ซูเปอร์แอดมิน', owner: 'หัวก๊วน', admin: 'แอดมิน', member: 'สมาชิก',
}

export default async function GroupHome({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createServerSupabase()
  const { data: group } = await supabase.from('groups').select('id, name').eq('id', groupId).maybeSingle()
  if (!group) notFound()

  const role = await roleInGroup(groupId)
  const manage = role === 'owner' || role === 'admin' || role === 'super'
  const pinStatus = role === 'owner'
    ? await supabase.rpc('room_pin_configured', { p_group_id: groupId }) : null

  return (
    <main className="space-y-8 py-4 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted underline underline-offset-4">ก๊วนของฉัน</Link>
          <h1 className="mt-4 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{group.name}</h1>
        </div>
        <span className="rounded-full bg-surface px-4 py-2 text-sm">{ROLE_LABEL[role ?? 'member']}</span>
      </header>
      <GroupNav groupId={groupId} active="overview" manage={manage} />
      <section className="relative overflow-hidden rounded-3xl bg-accent p-7 text-accent-foreground sm:p-10">
        <div className="relative z-10 max-w-xl">
          <h2 className="text-2xl font-semibold sm:text-3xl">พร้อมลงสนามกันหรือยัง?</h2>
          <p className="mt-3 leading-relaxed opacity-85">{manage ? 'เช็กชื่อคนที่มา จัดคู่ให้สูสี แล้วเริ่มเกมด้วยกัน' : 'ดูรายชื่อเพื่อนร่วมก๊วน แล้วนัดเจอกันที่สนาม'}</p>
          <Link href={`/g/${groupId}/${manage ? 'play' : 'members'}`} className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-background px-6 font-semibold text-foreground transition-opacity hover:opacity-90">
            {manage ? 'ไปเช็กชื่อและจัดสนาม' : 'ดูสมาชิกก๊วน'}
          </Link>
        </div>
      </section>
      {role === 'owner' && (pinStatus?.data === true ? <RoomInvite groupId={groupId} /> : (
        <section className="space-y-3 rounded-2xl border border-accent/30 bg-surface p-5">
          <h2 className="font-semibold">ตั้ง PIN ก่อนชวนเพื่อนเข้าห้อง</h2>
          <p className="text-sm text-muted">หัวก๊วนตั้งรหัส 6 หลัก แล้วแจ้งให้เพื่อนใส่พร้อมลิงก์เชิญ สมาชิกเดิมเข้าได้ตามปกติ</p>
          {pinStatus?.error && <p role="alert" className="text-sm text-danger">ตรวจสอบ PIN ไม่สำเร็จ กรุณาลองอีกครั้ง</p>}
          <Link href={`/g/${groupId}/members#room-pin`} className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4">ตั้ง PIN เข้าห้อง</Link>
        </section>
      ))}
      <GroupRankings groupId={groupId} groupName={group.name} />
      {manage ? (
        <Link href={`/g/${groupId}/members`} className="flex items-center justify-between gap-4 border-b border-foreground/10 py-5">
          <span><span className="block text-lg font-semibold">สมาชิกก๊วน</span><span className="mt-1 block text-sm text-muted">{role === 'owner' ? 'เพิ่มสมาชิก อนุมัติคำขอ และจัดการระดับฝีมือ' : 'ดูสมาชิกและจัดการระดับฝีมือ'}</span></span>
          <span className="shrink-0 text-sm font-semibold text-accent">จัดการสมาชิก</span>
        </Link>
      ) : (
        <p className="text-sm text-muted">หัวก๊วนและแอดมินเป็นผู้เช็กชื่อ จัดคิว และบันทึกผลการแข่งขันค่ะ</p>
      )}
    </main>
  )
}
