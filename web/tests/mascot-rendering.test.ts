import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Mascot } from '@/components/mascot'
import type { MascotAppearance } from '@/lib/cosmetics'

it('keeps profile portraits still and allows motion only when requested', () => {
  const portrait = renderToStaticMarkup(createElement(Mascot, { portrait: true, label: 'มาสคอตของ au' }))
  expect(portrait).toContain('aria-label="มาสคอตของ au"')
  expect(portrait).toContain('viewBox="19 6 162 162"')
  expect(portrait).not.toContain('court-mascot--animated')
  expect(renderToStaticMarkup(createElement(Mascot, { animate: true }))).toContain('court-mascot--animated')
})

it('renders skirts, dresses and bows with distinct shapes even with identical colors', () => {
  const shape = (equipment: MascotAppearance['equipment']) => {
    const svg = renderToStaticMarkup(createElement(Mascot, { appearance: { skin: 'warm', hair: 'bob', equipment } }))
    return [...svg.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]).join('|')
  }
  const item = (id: string) => ({ id, color: '#557A68', rarity: 'common' as const })
  const outfits = ['outfit-common', 'outfit-skirt-common', 'outfit-dress-rare']
    .map(id => shape({ outfit: item(id) }))
  expect(new Set(outfits).size).toBe(3)
  expect(shape({ head: item('head-bow-common') })).not.toBe(shape({ head: item('head-common') }))
})
