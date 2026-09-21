import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { GenderIcon, GenderSelector } from '@/components/gender-selector'

it('offers three labeled native radio choices without assuming gender', () => {
  const html = renderToStaticMarkup(createElement(GenderSelector))
  expect(html.match(/type="radio"/g)).toHaveLength(3)
  expect(html.match(/checked=""/g)).toHaveLength(1)
  expect(html).toMatch(/checked=""[^>]*value="unspecified"|value="unspecified"[^>]*checked=""/)
  for (const label of ['ชาย', 'หญิง', 'ไม่ระบุ']) expect(html).toContain(`aria-label="${label}"`)
  expect(html.match(/<svg /g)).toHaveLength(3)
  expect(html.match(/aria-hidden="true"/g)).toHaveLength(3)
  for (const oldIcon of ['♂', '♀', '○']) expect(html).not.toContain(oldIcon)
})

it('preserves explicit values and gives read-only icons accessible names', () => {
  const html = renderToStaticMarkup(createElement(GenderSelector, { value: 'female', onChange: () => {} }))
  expect(html).toMatch(/checked=""[^>]*value="female"|value="female"[^>]*checked=""/)
  expect(renderToStaticMarkup(createElement(GenderIcon, { gender: 'female' }))).toContain('aria-label="เพศ: หญิง"')
})

it('uses three distinct racket symbols and keeps decorative string detail out of the accessible name', () => {
  const shapes = (['male', 'female', 'unspecified'] as const).map(gender => {
    const html = renderToStaticMarkup(createElement(GenderIcon, { gender }))
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('<ellipse')
    expect(html).toContain('focusable="false"')
    return [...html.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]).join('|')
  })
  expect(new Set(shapes).size).toBe(3)
})
