'use client'

import { useState } from 'react'
import type { SessionPlayer } from '@/domain/types'
import {
  refillQueue,
  sendToCourt,
  finishMatch,
  freePlayers,
  type SessionState,
} from '@/domain/queue'
import { recordMatch } from './actions'

const nextId = () => crypto.randomUUID()

export default function PlayClient({
  groupId,
  sessionId,
  players,
  names,
  courtCount,
}: {
  groupId: string
  sessionId: string
  players: SessionPlayer[]
  /** player id -> display name. Kept out of SessionPlayer so the domain layer stays about numbers. */
  names: Record<string, string>
  courtCount: number
}) {
  const [state, setState] = useState<SessionState>(() =>
    refillQueue(
      {
        clockMin: 0,
        courts: Array.from({ length: courtCount }, (_, i) => ({ no: i + 1, match: null, startedAtMin: null })),
        queue: [],
        players,
        mode: 'mix',
        balanceWeight: 0.5,
        rejected: new Set(),
        lastTeamedAt: {},
        playedCount: 0,
      },
      nextId,
    ),
  )
  const [error, setError] = useState<string | null>(null)

  async function finish(courtIndex: number, winner: 'A' | 'B') {
    const court = state.courts[courtIndex]
    if (!court.match) return
    const { teamA, teamB } = court.match
    // The queue entry's own id is stable for this match's whole lifetime
    // (assigned once in refillQueue, unchanged by sendToCourt/finishMatch),
    // unlike a fresh nextId() call here which would mint a new value on
    // every invocation -- including retries -- and defeat the
    // matches.client_id unique constraint this call relies on for
    // idempotency. This is the exact key phase 4's offline outbox will
    // replay against, so it has to be stable now.
    const clientId = court.match.id
    setState(s => finishMatch(s, courtIndex, winner, nextId))
    const result = await recordMatch({
      clientId,
      sessionId,
      groupId,
      courtNo: court.no,
      mode: state.mode,
      balanceWeight: state.balanceWeight,
      teamA,
      teamB,
      winnerTeam: winner === 'A' ? 1 : 2,
    })
    setError(result.error)
  }

  const name = (id: string) => names[id] ?? id

  // Two players rendered as a stacked mini-roster inside one half of the
  // VS split -- same shape the prototype uses for both a live court and a
  // queued entry, just reused here instead of duplicated per caller.
  const team = (ids: readonly [string, string]) => (
    <div className="sd">
      {ids.map(id => (
        <div key={id} className="r" style={{ gap: 8 }}>
          <div className="av" style={{ width: 26, height: 26, fontSize: 'var(--t1)' }}>{name(id).charAt(0)}</div>
          <div className="gr">
            <div className="nm" style={{ fontSize: 'var(--t2)' }}>{name(id)}</div>
          </div>
        </div>
      ))}
    </div>
  )

  const freeCourt = state.courts.some(c => !c.match)

  return (
    <div className="screen">
      {error && <div className="note err" role="alert"><em>ผิดพลาด</em>{error}</div>}

      <section className="screen">
        <h2 className="ch" style={{ marginBottom: 0 }}>สนาม</h2>
        {state.courts.map((court, i) => (
          court.match ? (
            <div key={court.no} className="m">
              <div className="r">
                <span className="tg court">สนาม {court.no}</span>
                <span className="gr" />
                <span className={`tg ${court.match.gap <= 60 ? 'good' : ''}`}>ห่างกัน {court.match.gap} แต้มเรต</span>
              </div>
              <div className="vs">
                {team(court.match.teamA)}
                <div className="vsx">VS</div>
                {team(court.match.teamB)}
              </div>
              <div className="b2">
                <button className="b" onClick={() => finish(i, 'A')}>ซ้ายชนะ</button>
                <button className="b" onClick={() => finish(i, 'B')}>ขวาชนะ</button>
              </div>
            </div>
          ) : (
            <div key={court.no} className="m" style={{ borderLeftColor: 'var(--line)' }}>
              <div className="r">
                <span className="tg">สนาม {court.no}</span>
                <span className="gr" />
                <span className="tg">ว่าง</span>
              </div>
              <div className="mt" style={{ marginTop: 8 }}>กดยืนยันจากคิวด้านล่างเพื่อส่งลงสนามนี้</div>
            </div>
          )
        ))}
      </section>

      <section className="screen">
        <h2 className="ch" style={{ marginBottom: 0 }}>คิวถัดไป {state.queue.length} แมตช์</h2>
        {state.queue.length === 0 && (
          <div className="c"><div className="mt">ยังไม่มีคิว ต้องมีคนว่างอย่างน้อย 4 คน</div></div>
        )}
        {state.queue.map((entry, i) => (
          <div key={entry.id} className="m">
            <div className="r">
              <span className={`tg ${i === 0 ? 'court' : ''}`}>{i === 0 ? 'คิวแรก' : `คิวที่ ${i + 1}`}</span>
              <span className="gr" />
              <span className={`tg ${entry.gap <= 60 ? 'good' : ''}`}>ห่าง {entry.gap}</span>
            </div>
            <div className="vs">
              {team(entry.teamA)}
              <div className="vsx">VS</div>
              {team(entry.teamB)}
            </div>
            {i === 0 && freeCourt && (
              <button className="b" onClick={() => setState(s => sendToCourt(s, 0, nextId))}>ยืนยันส่งลงสนาม</button>
            )}
          </div>
        ))}
      </section>

      <section className="c">
        <h2 className="ch">คนว่าง {freePlayers(state).length} คน</h2>
        <ol>
          {freePlayers(state).map(p => (
            <li key={p.id} className="r">
              <div className="av">{name(p.id).charAt(0)}</div>
              <div className="gr">
                <div className="nm">{name(p.id)}</div>
                <div className="mt">เล่นไป {p.gamesToday} เกม</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
