export function ClubMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M11 21 5 7l5-2 6 1 6-1 5 2-6 14H11Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10 5 3 16M16 6v15m6-16-3 16M9 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 23h10v1a5 5 0 0 1-10 0v-1Z" fill="currentColor" />
    </svg>
  )
}
