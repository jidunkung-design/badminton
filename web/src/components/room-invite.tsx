'use client'

import { useState } from 'react'
import { Button, toast } from '@heroui/react'
import { shareRoomInvite } from '@/lib/share-room-invite'

export function RoomInvite({ groupId }: { groupId: string }) {
  const [link, setLink] = useState('')
  const [status, setStatus] = useState('')
  async function copy() {
    const url = `${window.location.origin}/login?join=${encodeURIComponent(groupId)}`
    setLink(url)
    try {
      await navigator.clipboard.writeText(url)
      setStatus('คัดลอกแล้ว อย่าลืมแจ้ง PIN ให้เพื่อนแยกจากลิงก์ จากนั้นอนุมัติคำขอได้ที่หน้าสมาชิก')
      toast.success('คัดลอกลิงก์เชิญแล้ว')
    } catch {
      setStatus('คัดลอกอัตโนมัติไม่ได้ เลือกแล้วคัดลอกลิงก์ด้านล่างได้เลย')
      toast.warning('คัดลอกอัตโนมัติไม่ได้', { description: 'เลือกแล้วคัดลอกลิงก์ด้านล่างได้เลย' })
    }
  }
  async function share() {
    const url = `${window.location.origin}/login?join=${encodeURIComponent(groupId)}`
    setLink(url)
    setStatus('')
    const result = await shareRoomInvite(url)
    if (result === 'unsupported') await copy()
    else if (result === 'shared') {
      setStatus('แชร์ลิงก์เชิญแล้ว')
      toast.success('แชร์ลิงก์เชิญแล้ว')
    } else if (result === 'failed') {
      setStatus('เปิดเมนูแชร์ไม่ได้ ใช้ปุ่มคัดลอกลิงก์หรือลิงก์ด้านล่างได้เลย')
      toast.warning('เปิดเมนูแชร์ไม่ได้', { description: 'ใช้ปุ่มคัดลอกลิงก์แทนได้ค่ะ' })
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-foreground/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="font-semibold">ชวนเพื่อนเข้าห้อง</h2><p className="mt-1 text-sm text-muted">เพื่อนตั้งชื่อและใส่ PIN 6 หลักก่อนส่งคำขอ หัวก๊วนอนุมัติได้ที่หน้าสมาชิก · ลิงก์นี้ไม่รวม PIN</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onPress={share}>แชร์ลิงก์เชิญ</Button>
          <Button variant="outline" onPress={copy}>คัดลอกลิงก์เชิญ</Button>
        </div>
      </div>
      {link && <input aria-label="ลิงก์เชิญเข้าห้อง" value={link} readOnly onFocus={event => event.target.select()} className="min-h-11 w-full rounded-xl border border-foreground/20 bg-surface px-3 text-sm" />}
      <p className="text-sm text-muted" role="status">{status}</p>
    </section>
  )
}
