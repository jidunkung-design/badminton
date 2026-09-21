import type { RatingChange } from '@/domain/rating'

const format = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })

export function MatchRatingSummary({
  changes,
  names,
  title = 'เรตหลังจบแมตช์',
  description = 'คะแนนอันดับจาก Elo พร้อมโบนัสเมื่อชนะต่อเนื่อง',
}: {
  changes: RatingChange[]
  names: Record<string, string>
  title?: string
  description?: string
}) {
  return (
    <section aria-label={title} aria-live="polite" aria-atomic="true" className="rounded-3xl border border-accent/20 bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <ul className="mt-4 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
        {changes.map(change => {
          const before = Math.round(change.before * 10) / 10
          const after = Math.round(change.after * 10) / 10
          const delta = Math.round((change.after - change.before) * 10) / 10
          return (
            <li key={change.id} className="flex min-w-0 items-center justify-between gap-3 border-t border-separator py-4">
              <div className="min-w-0">
                <p className="break-words font-semibold">{names[change.id] ?? change.id}</p>
                <p className="mt-1 whitespace-nowrap text-sm tabular-nums text-muted">{format(before)} <span aria-label="เป็น">→</span> {format(after)}</p>
                {(change.winStreak ?? 0) >= 2 && <p className="mt-1 text-xs font-semibold text-orange-700">🔥 ชนะ {change.winStreak} เกมติด · ×{change.multiplier}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1.5 text-lg font-semibold tabular-nums ${delta > 0 ? 'bg-accent/10 text-accent' : delta < 0 ? 'bg-red-50 text-red-800' : 'bg-default text-muted'}`}>
                {delta > 0 ? '+' : delta < 0 ? '−' : ''}{format(Math.abs(delta))}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted">ตัวเลขแสดงผลปัดทศนิยม 1 ตำแหน่ง</p>
    </section>
  )
}
