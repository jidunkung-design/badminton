import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function GroupListPage() {
  await requireUser()
  const supabase = await createServerSupabase()
  // RLS decides what comes back. Do not filter by membership here.
  const { data: groups, error } = await supabase.from('groups').select('id, name').order('name')

  return (
    <main className="space-y-8 py-4 sm:py-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">ก๊วนของฉัน</h1>
        <p className="text-muted">เลือกก๊วน แล้วไปเจอกันที่สนาม</p>
      </header>
      <Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-accent-foreground">สร้างห้องใหม่</Link>
      <p className="text-sm text-muted">เปิดได้รวม 3 ห้อง · คะแนนอันดับและประวัติแยกกันในแต่ละห้อง</p>
      {error ? <p role="alert" className="rounded-2xl bg-danger/10 p-5 text-danger">โหลดรายชื่อห้องไม่สำเร็จ กรุณาลองใหม่</p> : (groups ?? []).length === 0 ? (
        <div className="rounded-3xl border border-dashed border-foreground/20 px-6 py-16 text-center">
          <h2 className="text-xl font-semibold">ยังไม่มีก๊วนในรายการ</h2>
          <p className="mt-3 text-muted">เมื่อหัวก๊วนส่งลิงก์เชิญมา เข้าร่วมแล้วจะเห็นก๊วนที่นี่ค่ะ</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups!.map(g => (
            <li key={g.id}>
              <Link href={`/g/${g.id}`} className="group flex min-h-36 items-center gap-5 rounded-3xl border border-foreground/10 bg-surface p-6 transition-colors hover:border-accent">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl font-semibold text-accent">{g.name.charAt(0)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-xl font-semibold">{g.name}</span>
                  <span className="mt-1 block text-sm text-muted">เปิดก๊วน</span>
                </span>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 7 7-7 7" /></svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
