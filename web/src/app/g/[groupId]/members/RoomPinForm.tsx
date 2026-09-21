'use client'

import { Button, Input, Label, TextField } from '@heroui/react'
import { setRoomPin } from './actions'
import ActionForm from '@/components/action-form'

export default function RoomPinForm({ groupId, configured }: { groupId: string; configured: boolean | null }) {
  return (
    <section id="room-pin" className="space-y-4 rounded-3xl border border-accent/20 bg-surface p-5 sm:p-7">
      <div>
        <h2 className="text-xl font-semibold">PIN เข้าร่วมห้อง</h2>
        <p className="mt-2 text-sm text-muted">{configured === null ? 'ยังตรวจสอบสถานะ PIN ไม่ได้ สามารถตั้ง PIN ใหม่ได้จากแบบฟอร์มนี้' : configured
          ? 'ตั้ง PIN แล้ว เปลี่ยนได้ที่นี่ สมาชิกเดิมเข้าห้องได้ตามปกติ'
          : 'ห้องนี้ยังไม่มี PIN กรุณาตั้ง PIN ก่อนส่งลิงก์เชิญให้เพื่อน'}</p>
      </div>
      <ActionForm action={async formData => {
        const result = await setRoomPin({}, formData)
        return { error: result.error }
      }} successMessage="บันทึก PIN แล้ว" resetOnSuccess className="space-y-4">
        <input type="hidden" name="groupId" value={groupId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="pin" isRequired fullWidth>
            <Label>PIN ใหม่</Label>
            <Input type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" aria-describedby="pin-setting-help" />
          </TextField>
          <TextField name="pinConfirmation" isRequired fullWidth>
            <Label>ยืนยัน PIN ใหม่</Label>
            <Input type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" aria-describedby="pin-setting-help" />
          </TextField>
        </div>
        <p id="pin-setting-help" className="text-sm text-muted">ตัวเลข 6 หลัก แจ้งเพื่อนแยกจากลิงก์เชิญ การเปลี่ยน PIN จะให้ผู้ที่ยังรออนุมัติกรอก PIN ใหม่อีกครั้ง</p>
        <Button type="submit">บันทึก PIN</Button>
      </ActionForm>
    </section>
  )
}
