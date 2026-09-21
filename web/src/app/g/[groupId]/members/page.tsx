import { Button } from '@heroui/react'
import { createServerSupabase } from '@/lib/supabase/server'
import { roleInGroup } from '@/lib/roles'
import { GroupNav } from '@/components/group-nav'
import { addPlayer, archivePlayer, reviewJoinRequest, setPlayerGender } from './actions'
import RoomPinForm from './RoomPinForm'
import { GenderIcon, GenderSelector } from '@/components/gender-selector'
import ActionForm from '@/components/action-form'

export default async function MembersPage({ params }: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const supabase = await createServerSupabase()
  const role = await roleInGroup(groupId)
  const owner = role === 'owner'
  const manage = owner || role === 'admin' || role === 'super'
  const { data: requests, error: requestsError } = owner
    ? await supabase.from('room_join_requests').select('user_id, username, created_at').eq('group_id', groupId).eq('pin_verified', true).order('created_at')
    : { data: [], error: null }
  const pinStatus = owner ? await supabase.rpc('room_pin_configured', { p_group_id: groupId }) : null
  const { data: players } = await supabase.from('players')
    .select('id, name, skill, gender, user_id, archived_at').eq('group_id', groupId)
    .order('skill', { ascending: false })
  const active = (players ?? []).filter(p => !p.archived_at)
  const archived = (players ?? []).filter(p => p.archived_at)

  return (
    <main className="space-y-8 py-4 sm:py-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">เพื่อนร่วมก๊วน</h1>
        <p className="mt-3 text-muted">รายชื่อและระดับฝีมือของสมาชิกทุกคน</p>
      </header>
      <GroupNav groupId={groupId} active="members" manage={manage} />
      {owner && <RoomPinForm groupId={groupId} configured={pinStatus?.error ? null : pinStatus?.data ?? null} />}
      {owner && (
        <section className="rounded-3xl border border-accent/20 bg-surface p-5 sm:p-7">
          <h2 className="text-xl font-semibold">คำขอเข้าร่วมห้อง</h2>
          <p className="mt-2 text-sm text-muted">ตรวจสอบชื่อก่อนอนุมัติ สมาชิกใหม่จะเข้าถึงข้อมูลของห้องได้หลังคุณอนุมัติ</p>
          {requestsError ? <p role="alert" className="mt-4 text-sm text-danger">โหลดคำขอไม่สำเร็จ กรุณาโหลดหน้าใหม่</p>
            : (requests ?? []).length === 0 ? <p className="mt-5 text-sm text-muted">ไม่มีคำขอที่รออนุมัติ</p>
            : <ul className="mt-4 divide-y divide-foreground/10">
              {requests!.map(request => (
                <li key={request.user_id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <span className="min-w-0 break-words font-semibold">{request.username}</span>
                  <ActionForm className="flex flex-wrap gap-2" action={reviewJoinRequest} successMessage="จัดการคำขอแล้ว">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="userId" value={request.user_id} />
                    <Button type="submit" name="decision" value="approve" data-success-message={`อนุมัติ ${request.username} เข้าห้องแล้ว`} aria-label={`อนุมัติ ${request.username}`}>อนุมัติ</Button>
                    <Button type="submit" name="decision" value="reject" variant="outline" data-success-message={`ปฏิเสธคำขอของ ${request.username} แล้ว`} aria-label={`ปฏิเสธ ${request.username}`}>ปฏิเสธ</Button>
                  </ActionForm>
                </li>
              ))}
            </ul>}
        </section>
      )}
      <div className={`grid items-start gap-6 ${owner ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : ''}`}>
        <div className="space-y-6">
          <section className="rounded-3xl border border-foreground/10 bg-surface p-5 sm:p-7">
            <h2 className="mb-4 text-xl font-semibold">สมาชิกปัจจุบัน <span className="ml-2 text-base font-normal text-muted">{active.length} คน</span></h2>
            {active.length === 0 && <p className="py-8 text-center text-muted">ยังไม่มีสมาชิกในก๊วน{owner ? ' เพิ่มคนแรกได้จากแบบฟอร์ม' : ''}</p>}
            <ul className="divide-y divide-foreground/10">
              {active.map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/10 font-semibold text-accent">{p.name.charAt(0)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 break-words font-semibold">{p.name}<GenderIcon gender={p.gender === 'male' || p.gender === 'female' ? p.gender : 'unspecified'} /></p>
                    <p className="mt-1 text-sm text-muted">มือ {p.skill} · {p.user_id ? 'ผูกบัญชีแล้ว' : 'ยังไม่มีบัญชี'}</p>
                  </div>
                  {manage && (
                    <ActionForm action={archivePlayer} successMessage={`เก็บ ${p.name} เข้ากรุแล้ว`}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="playerId" value={p.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`เก็บ ${p.name} เข้ากรุ`}>เก็บเข้ากรุ</Button>
                    </ActionForm>
                  )}
                  {owner && <details className="w-full rounded-xl bg-foreground/[.025] px-3 py-2">
                    <summary className="min-h-8 cursor-pointer py-1 text-sm text-accent">แก้ไขเพศสำหรับจัดคู่</summary>
                    <ActionForm className="flex flex-wrap items-end gap-3 pb-2 pt-3" action={setPlayerGender} successMessage={`บันทึกเพศสำหรับจัดคู่ของ ${p.name} แล้ว`}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="playerId" value={p.id} />
                      <GenderSelector key={p.gender} defaultValue={p.gender === 'male' || p.gender === 'female' ? p.gender : 'unspecified'} label={`เพศสำหรับจัดคู่ของ ${p.name}`} />
                      <Button type="submit" size="sm" aria-label={`บันทึกเพศสำหรับจัดคู่ของ ${p.name}`}>บันทึก</Button>
                    </ActionForm>
                  </details>}
                </li>
              ))}
            </ul>
          </section>
          {archived.length > 0 && (
            <section className="px-2">
              <h2 className="text-lg font-semibold">อยู่ในกรุ <span className="font-normal text-muted">{archived.length} คน</span></h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {archived.map(p => <li key={p.id} className="rounded-full bg-foreground/5 px-4 py-2 text-sm text-muted">{p.name}</li>)}
              </ul>
              <p className="mt-4 text-sm text-muted">ไม่ขึ้นหน้าเช็กชื่อ แต่ประวัติการเล่นยังอยู่ครบ</p>
            </section>
          )}
        </div>
        {owner ? (
          <ActionForm className="space-y-5 rounded-3xl border border-foreground/10 bg-surface p-6" action={addPlayer} successMessage="เพิ่มสมาชิกแล้ว" resetOnSuccess>
            <h2 className="text-xl font-semibold">เพิ่มเพื่อนเข้าก๊วน</h2>
            <input type="hidden" name="groupId" value={groupId} />
            <div className="space-y-2">
              <label htmlFor="name" className="block text-sm font-semibold">ชื่อที่ใช้ในก๊วน</label>
              <input id="name" name="name" required className="min-h-12 w-full rounded-xl border border-foreground/15 bg-background px-4" placeholder="เช่น อู๋" />
            </div>
            <div className="space-y-2">
              <label htmlFor="skill" className="block text-sm font-semibold">ระดับฝีมือ</label>
              <input id="skill" name="skill" type="number" min={1} max={7} defaultValue={3} aria-describedby="skill-help" className="min-h-12 w-full rounded-xl border border-foreground/15 bg-background px-4" />
              <p id="skill-help" className="text-sm text-muted">ระดับ 1–7 ใช้ช่วยจัดทีมให้สูสี</p>
            </div>
            <GenderSelector />
            <Button type="submit" fullWidth size="lg">เพิ่มสมาชิก</Button>
          </ActionForm>
        ) : <p className="text-sm text-muted">เจ้าของห้องเป็นผู้เพิ่มสมาชิกและอนุมัติคำขอเข้าร่วม ส่วนแอดมินช่วยจัดการสมาชิกเดิมได้ค่ะ</p>}
      </div>
    </main>
  )
}
