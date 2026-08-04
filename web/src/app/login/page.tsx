'use client'

import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    if (error) setError('ส่งลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง')
    else setSent(true)
  }

  if (sent) {
    return (
      <main className="screen">
        <h1>ส่งลิงก์เข้าอีเมลแล้ว</h1>
        <div className="note info">
          <em>ขั้นตอนถัดไป</em>
          เปิดอีเมลแล้วกดลิงก์เพื่อเข้าใช้งาน
        </div>
      </main>
    )
  }

  return (
    <main className="screen">
      <h1>เข้าสู่ระบบ</h1>
      <form onSubmit={send} className="c screen">
        <label htmlFor="email" className="fg">
          <span>อีเมล</span>
          <input
            id="email"
            type="email"
            required
            className="in"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>
        <button type="submit" className="b">ส่งลิงก์เข้าอีเมล</button>
      </form>
      {error && <div className="note err" role="alert"><em>ผิดพลาด</em>{error}</div>}
    </main>
  )
}
