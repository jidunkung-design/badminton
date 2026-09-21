'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Spinner, TextField, toast } from '@heroui/react'
import { enterRoom, type EnterRoomState } from './actions'
import { GenderSelector } from '@/components/gender-selector'
import type { PlayerGender } from '@/domain/types'

export default function LoginForm({ username, roomId, joining, gender = 'unspecified' }: { username: string; roomId: string; joining: boolean; gender?: PlayerGender }) {
  const router = useRouter()
  const [state, action, pending] = useActionState(async (previous: EnterRoomState, form: FormData) => {
    const result: EnterRoomState = await enterRoom(previous, form).catch(() => ({
      error: 'เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง',
    }))
    if (result.error) toast.danger(result.error)
    else if (result.destination) {
      toast.success(joining ? 'ส่งคำขอเข้าร่วมแล้ว' : 'สร้างก๊วนสำเร็จ')
      router.push(result.destination)
    }
    return result
  }, {})
  const [requestId] = useState(roomId)
  return (
    <main className="login-grid">
      <section className="login-story" aria-label="ยินดีต้อนรับสู่ก๊วนแบด">
        <div>
          <h1>นัดกันมา<br /><span>ตีให้สนุก.</span></h1>
          <p>พื้นที่ของคนในก๊วน<br />ตั้งแต่เช็กชื่อ ก่อนลงสนาม<br />ไปจนถึงเกมที่อยากจำ</p>
        </div>
        <svg className="login-court" viewBox="0 0 420 310" fill="none" aria-hidden="true">
          <rect x="20" y="20" width="380" height="270" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M20 42h380M20 268h380M210 20v270M135 20v270M285 20v270M20 155h115m150 0h115" stroke="currentColor" strokeWidth="2" />
          <path d="M210 20v270" stroke="currentColor" strokeWidth="4" strokeDasharray="3 5" />
        </svg>
        <div className="login-story-footer"><span>ชวนกันตี</span><span>เกมดี ๆ เริ่มจากก๊วนที่ใช่</span></div>
      </section>

      <section className="login-form-area" aria-labelledby="login-heading">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">ไม่ต้องใช้อีเมลหรือบัญชีโซเชียล</span>
        <h2 id="login-heading" className="mt-5">{joining ? 'ขอเข้าร่วมก๊วน' : 'สร้างก๊วนของคุณ'}</h2>
        <p className="mt-3 text-muted">{joining ? 'ตั้งชื่อและกรอก PIN ที่เจ้าของห้องให้มา แล้วส่งคำขอเข้าร่วม' : 'ใช้ชื่อที่ไม่ซ้ำ แล้วชวนเพื่อนมาลงสนาม'}</p>
        <form action={action} className="mt-8 space-y-5">
          <input type="hidden" name="intent" value={joining ? 'join' : 'create'} />
          <input type="hidden" name="roomId" value={requestId} />
          <TextField name="username" isRequired defaultValue={username} isReadOnly={Boolean(username)} fullWidth>
            <Label>ชื่อผู้ใช้ของคุณ</Label>
            <Input placeholder="เช่น มินแบด" autoComplete="username" minLength={2} maxLength={30} aria-describedby="username-help" />
          </TextField>
          <p id="username-help" className="-mt-2 text-xs text-muted">{username ? 'ใช้ชื่อเดิมที่จำไว้ในเบราว์เซอร์นี้' : '2–30 ตัวอักษร ใช้ภาษาไทยได้ ไม่เว้นวรรค และต้องไม่ซ้ำกับคนอื่น'}</p>
          <GenderSelector defaultValue={gender} disabled={pending} />
          <p className="-mt-2 text-xs text-muted">เลือกเองหรือไม่ระบุก็ได้ ใช้ช่วยจัดคู่แบบผสม</p>
          {!joining && <TextField name="roomName" fullWidth>
            <Label>ชื่อห้อง <span className="font-normal text-muted">(ไม่บังคับ)</span></Label>
            <Input placeholder="เช่น ก๊วนเย็นวันพุธ" maxLength={80} />
          </TextField>}
          <TextField name="pin" isRequired fullWidth>
            <Label>{joining ? 'PIN ของห้อง' : 'ตั้ง PIN ของห้อง'}</Label>
            <Input type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete={joining ? 'off' : 'new-password'} aria-describedby="room-pin-help" />
          </TextField>
          <p id="room-pin-help" className="-mt-2 text-xs text-muted">{joining ? 'ตัวเลข 6 หลักจากเจ้าของห้อง เมื่อ PIN ถูกต้อง ยังต้องรอเจ้าของห้องอนุมัติ' : 'ตัวเลข 6 หลัก แจ้งเพื่อนแยกจากลิงก์เชิญ เปลี่ยนได้ที่หน้าสมาชิก'}</p>
          {state.error && <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">{state.error}</p>}
          <Button type="submit" fullWidth size="lg" isPending={pending}>
            {pending ? <><Spinner size="sm" color="current" /> {joining ? 'กำลังส่งคำขอ…' : 'กำลังสร้างห้อง…'}</> : joining ? 'ส่งคำขอเข้าร่วม' : 'สร้างห้องเลย'}
          </Button>
        </form>
        <p className="mt-4 text-xs leading-relaxed text-muted">{!joining && 'เปิดได้รวม 3 ห้อง แต่ละห้องมีคะแนนอันดับแยกกัน · '}จำตัวตนไว้ในเบราว์เซอร์นี้ หากล้างข้อมูลหรือเปลี่ยนเครื่อง จะใช้ชื่อเดิมเข้ากลับมาไม่ได้</p>
        <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-4">ห้องของฉัน</Link>
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-6 border-t border-separator pt-5 text-center">
            <Link href="/preview" className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent underline decoration-accent/30 hover:decoration-accent">เปิดก๊วนตัวอย่าง <span aria-hidden="true">→</span></Link>
          </div>
        )}
      </section>
    </main>
  )
}
