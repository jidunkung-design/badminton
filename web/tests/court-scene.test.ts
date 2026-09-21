import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CourtScene, type CourtScenePlayer } from '@/components/court-scene'

const teamA: CourtScenePlayer[] = [{ id: 'a', name: 'ต้น', appearance: { skin: 'deep', hair: 'bob', equipment: { outfit: { id: 'outfit-dress-rare', color: '#a12345', rarity: 'rare' } } } }, { id: 'b', name: 'ฝน' }]
const teamB: CourtScenePlayer[] = [{ id: 'c', name: 'เจ' }, { id: 'd', name: 'มิน' }]

it('shows both actual teams, equipped cosmetics, the rally and a motion control', () => {
  const html = renderToStaticMarkup(createElement(CourtScene, { teamA, teamB }))
  for (const player of [...teamA, ...teamB]) expect(html).toContain(`มาสคอตของ ${player.name}`)
  expect(html).toContain('#a12345')
  expect(html).toContain('court-scene__shuttle')
  expect(html).toContain('aria-label="หยุดภาพเคลื่อนไหวในสนาม"')
})

it('celebrates only winners, chooses a stable match variant and stops the rally after the result', () => {
  const render = (resultId: string) => renderToStaticMarkup(createElement(CourtScene, { teamA, teamB, phase: 'result', winner: 'A', resultId }))
  const html = render('match-1')
  expect(html).toBe(render('match-1'))
  expect(html.match(/court-scene__player--(?:jump|racket|dance)/g)).toHaveLength(2)
  expect(html.match(/court-scene__player--ready/g)).toHaveLength(2)
  expect(html).not.toContain('court-scene__shuttle')
  const variations = ['match-1', 'match-2', 'match-3'].map(id => render(id).match(/court-scene__player--(jump|racket|dance)/)?.[1])
  expect(new Set(variations).size).toBe(3)
})

it('draws all four players clapping for a draw without declaring a winner', () => {
  const html = renderToStaticMarkup(createElement(CourtScene, { teamA, teamB, phase: 'result', winner: 'draw', resultId: 'draw-1' }))
  expect(html.match(/court-scene__player--clap/g)).toHaveLength(4)
  expect(html.match(/court-mascot__clap-left/g)).toHaveLength(4)
  expect(html).toContain('เสมอ · ปรบมือให้ทั้งสองทีม')
  expect(html).not.toContain('court-scene__shuttle')
})
