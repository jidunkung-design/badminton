'use client'

import { useActionState } from 'react'
import { Button, Spinner, toast } from '@heroui/react'
import type { Court, RotationMode } from '@/domain/types'
import { saveCourt, saveRotation } from './actions'

async function submitSettings(save: typeof saveCourt, previous: { error?: string; success?: string }, form: FormData) {
  try {
    const result = await save(previous, form)
    if (result.error) toast.danger(result.error)
    else if (result.success) toast.success(result.success)
    return result
  } catch {
    const error = 'ยังยืนยันการบันทึกไม่ได้ กรุณาลองอีกครั้ง'
    toast.danger(error)
    return { error }
  }
}

export function courtTime(value?: string | null) {
  return value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : ''
}

export function courtBooking(court: Court) {
  if (!court.startsAt || !court.endsAt) return 'ยังไม่ได้ตั้งเวลาจอง'
  const startDay = new Date(court.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const endDay = new Date(court.endsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  return `${courtTime(court.startsAt)}–${courtTime(court.endsAt)}${endDay !== startDay ? ' (+1 วัน)' : ''}`
}

export default function CourtSettings({ groupId, sessionId, court, disabled = false }: {
  groupId: string
  sessionId: string
  court: Court
  disabled?: boolean
}) {
  const [state, action, pending] = useActionState((previous: { error?: string; success?: string }, form: FormData) => submitSettings(saveCourt, previous, form), {})
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="courtNo" value={court.no} />
      <fieldset disabled={disabled || pending || Boolean(court.match)} className="space-y-3 disabled:opacity-60">
        <legend className="mb-3 text-sm font-semibold">เวลาจองสนาม {court.no}</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm"><span className="block">เริ่มจอง</span>
            <input type="time" name="startsTime" required defaultValue={courtTime(court.startsAt)} aria-describedby={`court-time-help-${court.no}`} className="min-h-11 w-full min-w-0 rounded-xl border border-foreground/20 bg-background px-3" />
          </label>
          <label className="space-y-1 text-sm"><span className="block">สิ้นสุด</span>
            <input type="time" name="endsTime" required defaultValue={courtTime(court.endsAt)} aria-describedby={`court-time-help-${court.no}`} className="min-h-11 w-full min-w-0 rounded-xl border border-foreground/20 bg-background px-3" />
          </label>
        </div>
        <p id={`court-time-help-${court.no}`} className="text-xs text-muted">เวลาประเทศไทย หากเวลาสิ้นสุดเท่ากับหรือก่อนเริ่ม จะนับเป็นวันถัดไป</p>
        <Button type="submit" variant="outline" size="sm" isDisabled={disabled || Boolean(court.match)} isPending={pending}>{pending ? <><Spinner size="sm" color="current" /> กำลังบันทึก…</> : 'บันทึกเวลาจอง'}</Button>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  )
}

export function RotationSettings({ groupId, sessionId, mode, disabled }: {
  groupId: string; sessionId: string; mode: RotationMode; disabled: boolean
}) {
  const [state, action, pending] = useActionState((previous: { error?: string; success?: string }, form: FormData) => submitSettings(saveRotation, previous, form), {})
  return (
    <form action={action} className="mb-5 space-y-3 rounded-2xl border border-foreground/10 bg-surface p-5">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <fieldset disabled={disabled || pending} className="space-y-3 disabled:opacity-60">
        <legend className="font-semibold">วิธีเวียนสนามวันนี้</legend>
        <label className="block text-sm">เลือกก่อนเริ่มเกม
          <select name="rotationMode" defaultValue={mode} aria-describedby="rotation-help" className="mt-2 min-h-12 w-full max-w-md rounded-xl border border-foreground/20 bg-background px-3">
            <option value="all_out">จบเกมแล้วออกทั้ง 4 คน</option>
            <option value="winner_stays">ทีมชนะอยู่ต่อ · ทีมแพ้ออก</option>
          </select>
        </label>
        <p id="rotation-help" className="text-sm text-muted">เกมเสมอออกทั้ง 4 คนเสมอ เปลี่ยนวิธีได้เมื่อทุกสนามว่าง การเปลี่ยนวิธีจะยกเลิกทีมที่รออยู่ต่อ</p>
        <Button type="submit" variant="outline" isDisabled={disabled} isPending={pending}>{pending ? <><Spinner size="sm" color="current" /> กำลังบันทึก…</> : 'บันทึกวิธีเวียนสนาม'}</Button>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  )
}
