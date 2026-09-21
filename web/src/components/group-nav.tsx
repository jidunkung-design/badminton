import Link from 'next/link'
import './group-nav.css'

type GroupTab = 'overview' | 'members' | 'play' | 'rankings'

function NavIcon({ tab }: { tab: GroupTab }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {tab === 'overview' && <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h5v-6h4v6h5V9" /></>}
    {tab === 'members' && <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v2" /></>}
    {tab === 'play' && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18M12 4v16M3 8h18M3 16h18" /></>}
    {tab === 'rankings' && <><path d="M3 20V11h6v9M9 20V5h6v15M15 20v-7h6v7M2 20h20" /><path d="M11 8h1v3" /></>}
  </svg>
}

export function GroupNav({ groupId, active, manage = false }: {
  groupId: string
  active: GroupTab
  manage?: boolean
}) {
  const links: { key: GroupTab; href: string; label: string }[] = [
    { key: 'overview', href: `/g/${groupId}`, label: 'ภาพรวม' },
    { key: 'members', href: `/g/${groupId}/members`, label: 'สมาชิก' },
    ...(manage ? [{ key: 'play' as const, href: `/g/${groupId}/play`, label: 'สนาม' }] : []),
    { key: 'rankings', href: `/g/${groupId}/rankings`, label: 'อันดับ' },
  ]

  return (
    <nav aria-label="เมนูก๊วน" className="group-nav">
      {links.map(link => (
        <Link key={link.key} href={link.href} aria-current={active === link.key ? 'page' : undefined} className="group-nav__link">
          <span className="group-nav__icon"><NavIcon tab={link.key} /></span>
          <span>{link.label}</span>
        </Link>
      ))}
    </nav>
  )
}
