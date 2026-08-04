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
    return <main><h1>ส่งลิงก์เข้าอีเมลแล้ว</h1><p>เปิดอีเมลแล้วกดลิงก์เพื่อเข้าใช้งาน</p></main>
  }

  return (
    <main>
      <h1>เข้าสู่ระบบ</h1>
      <form onSubmit={send}>
        <label htmlFor="email">อีเมล</label>
        <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <button type="submit">ส่งลิงก์เข้าอีเมล</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
