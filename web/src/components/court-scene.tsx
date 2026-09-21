'use client'

import { useState } from 'react'
import { Button } from '@heroui/react'
import { Mascot } from '@/components/mascot'
import type { MascotAppearance } from '@/lib/cosmetics'
import './court-scene.css'

export type CourtScenePlayer = { id: string; name: string; appearance?: MascotAppearance }
type Props = {
  teamA: readonly CourtScenePlayer[]
  teamB: readonly CourtScenePlayer[]
  phase?: 'playing' | 'result'
  winner?: 'A' | 'B' | 'draw'
  resultId?: string
  className?: string
}

export function CourtScene({ teamA, teamB, phase = 'playing', winner, resultId = '', className = '' }: Props) {
  const [motion, setMotion] = useState(true)
  const celebration = ['jump', 'racket', 'dance'][Array.from(resultId).reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 3]
  const result = phase === 'result'
  const status = result ? winner === 'draw' ? 'เสมอ · ปรบมือให้ทั้งสองทีม' : winner ? `ทีม ${winner} ชนะ` : 'จบแมตช์แล้ว' : 'กำลังเล่น · ภาพประกอบการตีโต้'

  return <section className={`court-scene ${motion ? 'court-scene--motion' : ''} court-scene--${phase} ${className}`} aria-label="สนามมาสคอต">
    <div className="court-scene__toolbar"><p role="status">{status}</p><Button size="sm" variant="ghost" aria-pressed={motion} aria-label={motion ? 'หยุดภาพเคลื่อนไหวในสนาม' : 'เปิดภาพเคลื่อนไหวในสนาม'} onPress={() => setMotion(value => !value)}>{motion ? 'หยุดภาพ' : 'เปิดภาพ'}</Button></div>
    <div className="court-scene__stage">
      <div className="court-scene__lines" aria-hidden="true" /><div className="court-scene__net" aria-hidden="true" />
      <span className="court-scene__side court-scene__side--A">ทีม A</span><span className="court-scene__side court-scene__side--B">ทีม B</span>
      {([['A', teamA], ['B', teamB]] as const).flatMap(([team, players]) => players.slice(0, 2).map((player, index) => {
        const reaction = result && winner === 'draw' ? 'clap' : result && winner === team ? celebration : 'ready'
        return <div key={`${phase}-${resultId}-${team}-${player.id}`} className={`court-scene__player court-scene__player--${team} court-scene__player--${index} court-scene__player--${reaction}`}>
          <div className="court-scene__character"><Mascot appearance={player.appearance} pose={reaction === 'clap' ? 'clap' : 'ready'} label={`มาสคอตของ ${player.name}`} /></div>
          <p className="court-scene__name" title={player.name}>{player.name}</p>
        </div>
      }))}
      {!result && <div className="court-scene__rally" aria-hidden="true"><svg className="court-scene__shuttle" viewBox="0 0 30 30"><path d="M12 20L3 5L12 3L16 17L18 2L26 6L20 22Z" fill="#fffdf2" stroke="#293b34" strokeWidth="1.5" /><path d="M12 5L17 20M22 6L19 21" stroke="#b2c3ad" /><path d="M12 20Q10 28 17 28Q24 27 20 22Z" fill="#e8d5a7" stroke="#293b34" strokeWidth="1.5" /></svg></div>}
    </div>
  </section>
}
