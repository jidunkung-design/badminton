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
  // queued entry, just reused here instead of duplicated per caller. `size`
  // is purely presentational: it scales the avatar/name up for the one live
  // match that matters and keeps the queue's rosters small and quiet.
  const team = (ids: readonly [string, string], size: 'lg' | 'sm' = 'sm') => (
    <div className={`sd${size === 'lg' ? ' sd-lg' : ''}`}>
      {ids.map(id => (
        <div key={id} className="r" style={{ gap: size === 'lg' ? 10 : 8 }}>
          <div
            className="av"
            style={{
              width: size === 'lg' ? 40 : 26,
              height: size === 'lg' ? 40 : 26,
              fontSize: size === 'lg' ? 'var(--t3)' : 'var(--t1)',
            }}
          >
            {name(id).charAt(0)}
          </div>
          <div className="gr">
            <div className="nm" style={{ fontSize: size === 'lg' ? 'var(--t4)' : 'var(--t2)' }}>{name(id)}</div>
          </div>
        </div>
      ))}
    </div>
  )

  // A faint, real badminton court -- boundary, net, and the two short
  // service lines -- drawn behind the live match only. Purely decorative
  // (aria-hidden) and stroked with the existing --court token so it tracks
  // the theme automatically; see the .m.live / .court-lines comment in
  // globals.css for why it can sit behind the score without a z-index fight.
  const courtLines = (
    <svg className="court-lines" viewBox="0 0 240 110" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="228" height="98" fill="none" stroke="var(--court)" strokeWidth="1.5" />
      <line x1="120" y1="6" x2="120" y2="104" stroke="var(--court)" strokeWidth="2.5" />
      <line x1="45" y1="6" x2="45" y2="104" stroke="var(--court)" strokeWidth="1" />
      <line x1="195" y1="6" x2="195" y2="104" stroke="var(--court)" strokeWidth="1" />
      <line x1="6" y1="55" x2="234" y2="55" stroke="var(--court)" strokeWidth="1" />
    </svg>
  )

  const freeCourt = state.courts.some(c => !c.match)

  return (
    <div className="screen">
      {error && <div className="note err" role="alert">{error}</div>}

      <section className="screen">
        <h2 className="ch" style={{ marginBottom: 0 }}>สนาม</h2>
        {state.courts.map((court, i) => (
          court.match ? (
            <div key={court.no} className="m live">
              {courtLines}
              <div className="r">
                <span className="tg court">สนาม {court.no}</span>
                <span className="gr" />
                <span className={`tg ${court.match.gap <= 60 ? 'good' : ''}`}>ห่างกัน {court.match.gap} แต้มเรต</span>
              </div>
              <div className="vs">
                {team(court.match.teamA, 'lg')}
                <div className="vsx">VS</div>
                {team(court.match.teamB, 'lg')}
              </div>
              <div className="b2">
                <button className="b b-win" onClick={() => finish(i, 'A')}>ซ้ายชนะ</button>
                <button className="b b-win" onClick={() => finish(i, 'B')}>ขวาชนะ</button>
              </div>
            </div>
          ) : (
            <div key={court.no} className="court-idle">
              <div className="r">
                <span className="tg">สนาม {court.no}</span>
                <span className="gr" />
                <span className="tg">ว่าง</span>
              </div>
              <div className="mt">กดยืนยันจากคิวด้านล่างเพื่อส่งลงสนามนี้</div>
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
          <div key={entry.id} className={`q${i === 0 ? ' q-next' : ''}`}>
            <div className="r">
              <span className={`tg ${i === 0 ? 'court' : ''}`}>{i === 0 ? 'คิวแรก' : `คิวที่ ${i + 1}`}</span>
              <span className="gr" />
              <span className={`tg ${entry.gap <= 60 ? 'good' : ''}`}>ห่าง {entry.gap}</span>
            </div>
            <div className="vs tight">
              {team(entry.teamA)}
              <div className="vsx">VS</div>
              {team(entry.teamB)}
            </div>
            {i === 0 && freeCourt && (
              <button className="b b-confirm" onClick={() => setState(s => sendToCourt(s, 0, nextId))}>ยืนยันส่งลงสนาม</button>
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
