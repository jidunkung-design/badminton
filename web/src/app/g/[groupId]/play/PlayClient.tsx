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

  return (
    <div>
      {error && <p role="alert">{error}</p>}

      <section>
        <h2>สนาม</h2>
        {state.courts.map((court, i) => (
          <div key={court.no}>
            <h3>สนาม {court.no}</h3>
            {court.match ? (
              <>
                <p>{court.match.teamA.map(name).join(' กับ ')} พบ {court.match.teamB.map(name).join(' กับ ')}</p>
                <button onClick={() => finish(i, 'A')}>ซ้ายชนะ</button>
                <button onClick={() => finish(i, 'B')}>ขวาชนะ</button>
              </>
            ) : (
              <p>ว่าง กดยืนยันจากคิวเพื่อส่งลงสนามนี้</p>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2>คิวถัดไป {state.queue.length} แมตช์</h2>
        {state.queue.map((entry, i) => (
          <div key={entry.id}>
            <p>{entry.teamA.map(name).join(' กับ ')} พบ {entry.teamB.map(name).join(' กับ ')} · ห่าง {entry.gap}</p>
            {i === 0 && state.courts.some(c => !c.match) && (
              <button onClick={() => setState(s => sendToCourt(s, 0, nextId))}>ยืนยันส่งลงสนาม</button>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2>คนว่าง {freePlayers(state).length} คน</h2>
        <ol>
          {freePlayers(state).map(p => (
            <li key={p.id}>{name(p.id)} · เล่นไป {p.gamesToday} เกม</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
