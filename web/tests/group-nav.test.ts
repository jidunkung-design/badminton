import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { GroupNav } from '@/components/group-nav'

it('links managers to all four room tabs and marks only the current page', () => {
  const html = renderToStaticMarkup(createElement(GroupNav, { groupId: 'room-1', active: 'rankings', manage: true }))
  for (const path of ['', '/members', '/play', '/rankings']) expect(html).toContain(`href="/g/room-1${path}"`)
  expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  const rankingsLink = html.match(/<a\b[^>]*>/g)?.find(link => link.includes('href="/g/room-1/rankings"'))
  expect(rankingsLink).toContain('aria-current="page"')
  expect(html.match(/aria-hidden="true"/g)).toHaveLength(4)
})

it('keeps rankings visible to members without exposing the manager-only play link', () => {
  const html = renderToStaticMarkup(createElement(GroupNav, { groupId: 'room-2', active: 'members' }))
  expect(html).not.toContain('href="/g/room-2/play"')
  expect(html).toContain('href="/g/room-2/rankings"')
  expect(html.match(/<a /g)).toHaveLength(3)
  expect(html).toContain('aria-label="เมนูก๊วน"')
})
