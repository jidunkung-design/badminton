# Badminton Club — Phase 1-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first usable slice — a hosted multi-group badminton club app where an admin can log in, manage members, check people in, and run a session with the court-queue engine, with permissions enforced by the database.

**Architecture:** Next.js 15 App Router on Vercel talking to Supabase Postgres. All authorization lives in Row Level Security policies, never in React. All queue/pairing/rating math lives in a framework-free `src/domain/` layer that is pure, synchronous, and unit-tested — the UI and the database both call into it but neither owns it.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Supabase (Postgres + Auth + RLS), `@supabase/ssr`, Vitest, Supabase CLI for local Postgres and migrations.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-04-badminton-club-design.md`. Where this plan and the spec disagree, the spec wins.
- Visual source of truth for every screen: the published prototype (Artifact `757ad478-3c84-44c6-b6a4-f40ebf1931f5`). UI code in this plan is structural only; styling follows the prototype.
- New code lives in `web/` at the repo root. **Do not modify or delete the existing `index.html`.**
- Branch: `feat/club-platform`. Never commit to `main`.
- All UI copy is Thai. Code identifiers, commit messages, and comments are English.
- Hard system cap: 5 groups, enforced by a database trigger, not by application code.
- No hard deletes of `players` anywhere, ever. Archival only via `players.archived_at`.
- A match recorded in one group must never affect ratings in another group. Every rating query filters by `group_id`.
- Every offline-capable write carries a client-generated `client_id UUID` with a UNIQUE constraint.
- Node 20+. Package manager: `npm`.
- Commit after every task. Conventional Commits (`feat:`, `test:`, `chore:`). No `Co-Authored-By` trailer. No emoji in commit messages.

## File Structure

```
web/
  package.json                      deps + scripts
  tsconfig.json
  next.config.ts
  vitest.config.ts
  .env.local.example                documents required env vars
  supabase/
    config.toml                     local dev config (from CLI init)
    migrations/
      0001_core_schema.sql          tables + constraints + group cap trigger
      0002_rls.sql                  helper functions + RLS policies
    seed.sql                        one group, one owner, sample players
  src/
    domain/                         pure, no imports from next/ or supabase
      tiers.ts                      tier ladder N S P C B
      rating.ts                     ELO + skill-blended rating
      fairness.ts                   who deserves the next slot
      pairing.ts                    how four players split into two teams
      queue.ts                      session reducers (courts + queue)
      types.ts                      shared domain types
    lib/
      supabase/client.ts            browser client
      supabase/server.ts            server client for RSC + route handlers
      db-types.ts                   generated from the database
    app/
      layout.tsx
      login/page.tsx
      page.tsx                      group list
      g/[groupId]/page.tsx          group home
      g/[groupId]/members/page.tsx  member management
      g/[groupId]/play/page.tsx     court mode
      g/[groupId]/play/actions.ts   server actions for session writes
  tests/
    domain/*.test.ts                unit tests, no infrastructure needed
    db/rls.test.ts                  policy tests against local Supabase
```

`src/domain/` is the load-bearing decomposition: it holds every rule that is expensive to get wrong and cheap to test. Tasks 2-6 build it with no database and no React in scope.

---

### Task 1: Scaffold the app on a new branch

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/vitest.config.ts`, `web/.env.local.example`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`
- Create: `web/tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` and `npm run build` both run from `web/`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/anuwatttttt/Documents/Dev/badminton/badminton
git checkout main
git pull
git checkout -b feat/club-platform
```

- [ ] **Step 2: Scaffold Next.js into `web/`**

```bash
npx create-next-app@latest web --typescript --app --eslint --no-tailwind --src-dir --import-alias "@/*" --use-npm
```

If the interactive prompt appears anyway, answer: TypeScript yes, ESLint yes, Tailwind no, `src/` yes, App Router yes, Turbopack yes, import alias `@/*`.

- [ ] **Step 3: Add test tooling**

```bash
cd web
npm install -D vitest @vitejs/plugin-react
```

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

Add to `web/package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the smoke test**

Create `web/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typescript tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run the test**

Run: `cd web && npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Document required env vars**

Create `web/.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Add `web/.env.local` to the repo root `.gitignore` (create the file if absent).

- [ ] **Step 7: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web .gitignore
git commit -m "chore: scaffold next.js app with vitest under web/"
```

---

### Task 2: Tier ladder

**Files:**
- Create: `web/src/domain/tiers.ts`
- Test: `web/tests/domain/tiers.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type TierKey = 'B' | 'C' | 'P' | 'S' | 'N'`
  - `interface Tier { key: TierKey; min: number; label: string }`
  - `const TIERS: readonly Tier[]` ordered high to low
  - `function tierOf(rating: number): Tier`
  - `interface NextTier { key: TierKey; label: string; need: number; pct: number }`
  - `function nextTier(rating: number): NextTier | null`

- [ ] **Step 1: Write the failing test**

Create `web/tests/domain/tiers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TIERS, tierOf, nextTier } from '@/domain/tiers'

describe('tierOf', () => {
  it('maps ratings to the Thai club ladder', () => {
    expect(tierOf(1156).key).toBe('B')
    expect(tierOf(1140).key).toBe('B')
    expect(tierOf(1121).key).toBe('C')
    expect(tierOf(1042).key).toBe('P')
    expect(tierOf(1015).key).toBe('S')
    expect(tierOf(903).key).toBe('N')
  })

  it('is ordered high to low with no gaps', () => {
    expect(TIERS.map(t => t.key)).toEqual(['B', 'C', 'P', 'S', 'N'])
    expect(TIERS[TIERS.length - 1].min).toBe(0)
  })
})

describe('nextTier', () => {
  it('returns null at the top of the ladder', () => {
    expect(nextTier(1200)).toBeNull()
  })

  it('reports how many points remain', () => {
    const up = nextTier(1121)!
    expect(up.key).toBe('B')
    expect(up.need).toBe(19)
  })

  it('measures progress across the last 100 points, not from the tier floor', () => {
    // N has floor 0. Measuring from 0 would put a 903 player at 91 percent,
    // which reads as "about to promote" when they are not.
    expect(Math.round(nextTier(903)!.pct * 100)).toBe(13)
    expect(Math.round(nextTier(988)!.pct * 100)).toBe(98)
  })

  it('clamps progress into 0..1', () => {
    for (const r of [0, 500, 989, 1139, 1141]) {
      const up = nextTier(r)
      if (up) {
        expect(up.pct).toBeGreaterThanOrEqual(0)
        expect(up.pct).toBeLessThanOrEqual(1)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- tests/domain/tiers.test.ts`
Expected: FAIL, cannot resolve `@/domain/tiers`.

- [ ] **Step 3: Write the implementation**

Create `web/src/domain/tiers.ts`:

```ts
export type TierKey = 'B' | 'C' | 'P' | 'S' | 'N'

export interface Tier {
  key: TierKey
  min: number
  label: string
}

/** Thai amateur club ladder. N is the entry level, B is the highest we track. */
export const TIERS: readonly Tier[] = [
  { key: 'B', min: 1140, label: 'มือ B' },
  { key: 'C', min: 1090, label: 'มือ C' },
  { key: 'P', min: 1040, label: 'มือ P' },
  { key: 'S', min: 990, label: 'มือ S' },
  { key: 'N', min: 0, label: 'มือ N' },
]

/** Width of the progress window shown under a player's rating. */
const PROGRESS_WINDOW = 100

export function tierOf(rating: number): Tier {
  return TIERS.find(t => rating >= t.min) ?? TIERS[TIERS.length - 1]
}

export interface NextTier {
  key: TierKey
  label: string
  need: number
  pct: number
}

export function nextTier(rating: number): NextTier | null {
  const i = TIERS.findIndex(t => rating >= t.min)
  if (i <= 0) return null
  const up = TIERS[i - 1]
  // Measure inside the last PROGRESS_WINDOW points before promotion.
  // Measuring from the tier floor breaks for N, whose floor is 0.
  const floor = Math.max(TIERS[i].min, up.min - PROGRESS_WINDOW)
  const pct = (rating - floor) / (up.min - floor)
  return {
    key: up.key,
    label: up.label,
    need: Math.ceil(up.min - rating),
    pct: Math.max(0, Math.min(1, pct)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- tests/domain/tiers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/domain/tiers.ts web/tests/domain/tiers.test.ts
git commit -m "feat: add tier ladder with promotion progress"
```

---

### Task 3: Rating math

**Files:**
- Create: `web/src/domain/rating.ts`
- Test: `web/tests/domain/rating.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `const ELO_BASE = 1000`, `const ELO_K = 32`
  - `function skillPrior(skill: number): number`
  - `function blendedRating(elo: number, seasonGames: number, skill: number): number`
  - `function eloDelta(winnerAvg: number, loserAvg: number): number`

- [ ] **Step 1: Write the failing test**

Create `web/tests/domain/rating.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ELO_BASE, ELO_K, skillPrior, blendedRating, eloDelta } from '@/domain/rating'

describe('skillPrior', () => {
  it('centres a mid skill on the base rating', () => {
    expect(skillPrior(3)).toBe(ELO_BASE)
    expect(skillPrior(6)).toBe(1300)
    expect(skillPrior(1)).toBe(800)
  })
})

describe('blendedRating', () => {
  it('trusts the entered skill when the player has no games', () => {
    expect(blendedRating(1200, 0, 3)).toBe(1000)
  })

  it('converges on measured elo as games accumulate', () => {
    const few = blendedRating(1200, 4, 3)
    const many = blendedRating(1200, 40, 3)
    expect(few).toBeGreaterThan(1000)
    expect(few).toBeLessThan(many)
    expect(many).toBeGreaterThan(1150)
  })
})

describe('eloDelta', () => {
  it('moves 16 points when both sides are equal', () => {
    expect(Math.round(eloDelta(1000, 1000))).toBe(ELO_K / 2)
  })

  it('rewards an upset more than an expected win', () => {
    const upset = eloDelta(900, 1200)
    const expected = eloDelta(1200, 900)
    expect(upset).toBeGreaterThan(expected)
    expect(upset).toBeLessThanOrEqual(ELO_K)
    expect(expected).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- tests/domain/rating.test.ts`
Expected: FAIL, cannot resolve `@/domain/rating`.

- [ ] **Step 3: Write the implementation**

Create `web/src/domain/rating.ts`:

```ts
export const ELO_BASE = 1000
export const ELO_K = 32

/** How many games before measured results outweigh the entered skill. */
const PRIOR_WEIGHT = 8

/** Skill 1..7 mapped onto the elo scale, with skill 3 sitting at the base. */
export function skillPrior(skill: number): number {
  return 700 + skill * 100
}

/**
 * Rating used for pairing. A new player is trusted at their entered skill;
 * after roughly 20 games their measured elo dominates.
 */
export function blendedRating(elo: number, seasonGames: number, skill: number): number {
  const n = Math.max(0, seasonGames)
  return (n / (n + PRIOR_WEIGHT)) * elo + (PRIOR_WEIGHT / (n + PRIOR_WEIGHT)) * skillPrior(skill)
}

/** Points the winning side gains and the losing side loses. */
export function eloDelta(winnerAvg: number, loserAvg: number): number {
  const expected = 1 / (1 + Math.pow(10, (loserAvg - winnerAvg) / 400))
  return ELO_K * (1 - expected)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- tests/domain/rating.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/domain/rating.ts web/tests/domain/rating.test.ts
git commit -m "feat: add elo and skill-blended rating"
```

---

### Task 4: Fairness ordering

**Files:**
- Create: `web/src/domain/types.ts`, `web/src/domain/fairness.ts`
- Test: `web/tests/domain/fairness.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface SessionPlayer { id: string; skill: number; elo: number; seasonGames: number; gamesToday: number; freeAtMin: number }`
  - `function maxGamesToday(players: SessionPlayer[]): number`
  - `function priority(p: SessionPlayer, maxToday: number, clockMin: number): number`
  - `function orderByPriority(players: SessionPlayer[], clockMin: number): SessionPlayer[]`

- [ ] **Step 1: Write the failing test**

Create `web/tests/domain/fairness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SessionPlayer } from '@/domain/types'
import { maxGamesToday, priority, orderByPriority } from '@/domain/fairness'

function p(id: string, gamesToday: number, freeAtMin: number): SessionPlayer {
  return { id, skill: 3, elo: 1000, seasonGames: 0, gamesToday, freeAtMin }
}

describe('priority', () => {
  it('ranks the player who is furthest behind first', () => {
    const pool = [p('a', 3, 40), p('b', 1, 40)]
    expect(priority(pool[1], 3, 40)).toBeGreaterThan(priority(pool[0], 3, 40))
  })

  it('breaks ties by how long someone has waited', () => {
    const waited = p('slow', 2, 0)
    const fresh = p('fast', 2, 40)
    expect(priority(waited, 2, 40)).toBeGreaterThan(priority(fresh, 2, 40))
  })

  it('counts one game behind as worth about twelve minutes of waiting', () => {
    const behind = p('behind', 1, 40)
    const waiting = p('waiting', 2, 27.5)
    expect(priority(behind, 2, 40)).toBeCloseTo(priority(waiting, 2, 40), 1)
  })
})

describe('orderByPriority', () => {
  it('puts the most deserving player first', () => {
    const order = orderByPriority([p('a', 3, 40), p('b', 0, 0), p('c', 2, 10)], 40)
    expect(order[0].id).toBe('b')
  })

  it('ignores season history and looks only at today', () => {
    const regular = { ...p('regular', 0, 0), seasonGames: 200 }
    const newbie = { ...p('newbie', 2, 40), seasonGames: 0 }
    expect(orderByPriority([newbie, regular], 40)[0].id).toBe('regular')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- tests/domain/fairness.test.ts`
Expected: FAIL, cannot resolve `@/domain/types`.

- [ ] **Step 3: Write the implementation**

Create `web/src/domain/types.ts`:

```ts
export interface SessionPlayer {
  id: string
  skill: number
  /** Season elo as computed from the match log. */
  elo: number
  /** Games played this season, used to weight the skill prior. */
  seasonGames: number
  /** Games played today, used for fairness. */
  gamesToday: number
  /** Session clock minute at which this player last became free. */
  freeAtMin: number
}

export type QueueMode = 'manual' | 'fair' | 'mix' | 'balance'

export interface QueueEntry {
  id: string
  teamA: [string, string]
  teamB: [string, string]
  /** Absolute rating difference between the two sides. */
  gap: number
  /** Locked entries survive recomputation. */
  locked: boolean
}

export interface Court {
  no: number
  match: QueueEntry | null
  startedAtMin: number | null
}
```

Create `web/src/domain/fairness.ts`:

```ts
import type { SessionPlayer } from './types'

/** One game behind is worth this many minutes of waiting. */
const MINUTE_WEIGHT = 0.08

export function maxGamesToday(players: SessionPlayer[]): number {
  return players.reduce((max, p) => Math.max(max, p.gamesToday), 0)
}

/**
 * Higher means more deserving of the next slot.
 * Counts games played TODAY only. Counting season totals would punish
 * the people who turn up every week by giving them fewer turns forever.
 */
export function priority(p: SessionPlayer, maxToday: number, clockMin: number): number {
  const behind = maxToday - p.gamesToday
  const waited = Math.max(0, clockMin - p.freeAtMin)
  return behind + waited * MINUTE_WEIGHT
}

export function orderByPriority(players: SessionPlayer[], clockMin: number): SessionPlayer[] {
  const maxToday = maxGamesToday(players)
  return [...players].sort(
    (a, b) => priority(b, maxToday, clockMin) - priority(a, maxToday, clockMin),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- tests/domain/fairness.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/domain/types.ts web/src/domain/fairness.ts web/tests/domain/fairness.test.ts
git commit -m "feat: add fairness ordering for the court queue"
```

---

### Task 5: Team splitting and candidate selection

**Files:**
- Create: `web/src/domain/pairing.ts`
- Test: `web/tests/domain/pairing.test.ts`

**Interfaces:**
- Consumes: `SessionPlayer`, `QueueMode` from `@/domain/types`; `blendedRating` from `@/domain/rating`
- Produces:
  - `const QUEUE_PLAN: Record<'fair' | 'mix' | 'balance', { pool: number; lock: number }>`
  - `function combinations<T>(items: T[], k: number): T[][]`
  - `function signature(teamA: readonly string[], teamB: readonly string[]): string`
  - `interface SplitResult { teamA: [string, string]; teamB: [string, string]; gap: number; score: number }`
  - `interface PairingOptions { balanceWeight: number; recentPartnerPenalty: (a: string, b: string) => number; rejected?: ReadonlySet<string> }`
  - `function bestSplit(four: SessionPlayer[], opts: PairingOptions): SplitResult | null`
  - `function buildEntry(orderedPool: SessionPlayer[], mode: Exclude<QueueMode, 'manual'>, opts: PairingOptions): SplitResult | null`

- [ ] **Step 1: Write the failing test**

Create `web/tests/domain/pairing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SessionPlayer } from '@/domain/types'
import { QUEUE_PLAN, combinations, signature, bestSplit, buildEntry } from '@/domain/pairing'

const noPenalty = () => 0
const balanced = { balanceWeight: 1, recentPartnerPenalty: noPenalty }

function player(id: string, elo: number): SessionPlayer {
  return { id, skill: 3, elo, seasonGames: 50, gamesToday: 0, freeAtMin: 0 }
}

describe('combinations', () => {
  it('produces every unordered subset of size k', () => {
    expect(combinations([1, 2, 3, 4], 2)).toHaveLength(6)
    expect(combinations([1, 2, 3], 3)).toEqual([[1, 2, 3]])
    expect(combinations([1, 2], 3)).toEqual([])
    expect(combinations([1, 2], 0)).toEqual([[]])
  })
})

describe('signature', () => {
  it('is stable no matter which side or order the names arrive in', () => {
    expect(signature(['a', 'b'], ['c', 'd'])).toBe(signature(['d', 'c'], ['b', 'a']))
  })
})

describe('bestSplit', () => {
  it('pairs strongest with weakest to level the two sides', () => {
    const four = [player('s1', 1200), player('s2', 1100), player('s3', 1000), player('s4', 900)]
    const split = bestSplit(four, balanced)!
    expect(split.gap).toBe(0)
    expect(new Set([...split.teamA])).toEqual(new Set(['s1', 's4']))
  })

  it('prefers a new partnership when balance is switched off', () => {
    const four = [player('a', 1000), player('b', 1000), player('c', 1000), player('d', 1000)]
    const split = bestSplit(four, {
      balanceWeight: 0,
      recentPartnerPenalty: (x, y) => ([x, y].sort().join('|') === 'a|b' ? 100 : 0),
    })!
    const together = new Set([...split.teamA]).has('a') && new Set([...split.teamA]).has('b')
    expect(together).toBe(false)
  })

  it('returns null when every arrangement has been rejected', () => {
    const four = [player('a', 1000), player('b', 1000), player('c', 1000), player('d', 1000)]
    const all = new Set([
      signature(['a', 'b'], ['c', 'd']),
      signature(['a', 'c'], ['b', 'd']),
      signature(['a', 'd'], ['b', 'c']),
    ])
    expect(bestSplit(four, { ...balanced, rejected: all })).toBeNull()
  })
})

describe('buildEntry', () => {
  it('never drops the players at the front of the queue', () => {
    // Ordered pool: index 0 is the most deserving.
    const pool = [
      player('waited-longest', 700),
      player('waited-second', 1400),
      player('c', 1000),
      player('d', 1000),
      player('e', 1000),
      player('f', 1000),
    ]
    const entry = buildEntry(pool, 'mix', balanced)!
    const picked = new Set([...entry.teamA, ...entry.teamB])
    // mix locks the first 2 even though dropping them would balance better
    expect(picked.has('waited-longest')).toBe(true)
    expect(picked.has('waited-second')).toBe(true)
  })

  it('takes exactly the first four in fair mode', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, 1000 + i * 40))
    const entry = buildEntry(pool, 'fair', balanced)!
    expect(new Set([...entry.teamA, ...entry.teamB])).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('returns null when fewer than four are free', () => {
    expect(buildEntry([player('a', 1000)], 'mix', balanced)).toBeNull()
  })

  it('uses the documented pool and lock sizes', () => {
    expect(QUEUE_PLAN.fair).toEqual({ pool: 4, lock: 4 })
    expect(QUEUE_PLAN.mix).toEqual({ pool: 6, lock: 2 })
    expect(QUEUE_PLAN.balance).toEqual({ pool: 8, lock: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- tests/domain/pairing.test.ts`
Expected: FAIL, cannot resolve `@/domain/pairing`.

- [ ] **Step 3: Write the implementation**

Create `web/src/domain/pairing.ts`:

```ts
import type { QueueMode, SessionPlayer } from './types'
import { blendedRating } from './rating'

/**
 * pool = how many waiting players the selector may look at
 * lock = how many of the most deserving are guaranteed a slot
 *
 * lock is never 0. Using fairness only to shortlist and then choosing purely
 * on balance lets the people at the back of the shortlist be skipped over and
 * over, which is exactly the complaint that makes people stop turning up.
 */
export const QUEUE_PLAN: Record<Exclude<QueueMode, 'manual'>, { pool: number; lock: number }> = {
  fair: { pool: 4, lock: 4 },
  mix: { pool: 6, lock: 2 },
  balance: { pool: 8, lock: 1 },
}

/** The three ways four players can split into two pairs. */
const SPLITS: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

export function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (items.length < k) return []
  const out: T[][] = []
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) {
      out.push([items[i], ...rest])
    }
  }
  return out
}

export function signature(teamA: readonly string[], teamB: readonly string[]): string {
  return [[...teamA].sort().join('-'), [...teamB].sort().join('-')].sort().join('/')
}

export interface SplitResult {
  teamA: [string, string]
  teamB: [string, string]
  gap: number
  score: number
}

export interface PairingOptions {
  /** 1 means care only about an even match, 0 means care only about fresh partners. */
  balanceWeight: number
  recentPartnerPenalty: (a: string, b: string) => number
  rejected?: ReadonlySet<string>
}

function rate(p: SessionPlayer): number {
  return blendedRating(p.elo, p.seasonGames, p.skill)
}

export function bestSplit(four: SessionPlayer[], opts: PairingOptions): SplitResult | null {
  if (four.length !== 4) return null
  let best: SplitResult | null = null
  for (const [ia, ib] of SPLITS) {
    const teamA: [string, string] = [four[ia[0]].id, four[ia[1]].id]
    const teamB: [string, string] = [four[ib[0]].id, four[ib[1]].id]
    if (opts.rejected?.has(signature(teamA, teamB))) continue
    const gap = Math.abs(
      rate(four[ia[0]]) + rate(four[ia[1]]) - rate(four[ib[0]]) - rate(four[ib[1]]),
    )
    const repeat =
      opts.recentPartnerPenalty(teamA[0], teamA[1]) + opts.recentPartnerPenalty(teamB[0], teamB[1])
    const score = opts.balanceWeight * (gap / 4) + (1 - opts.balanceWeight) * repeat
    if (!best || score < best.score) best = { teamA, teamB, gap, score }
  }
  return best
}

/**
 * @param orderedPool free players, most deserving first (see orderByPriority)
 */
export function buildEntry(
  orderedPool: SessionPlayer[],
  mode: Exclude<QueueMode, 'manual'>,
  opts: PairingOptions,
): SplitResult | null {
  if (orderedPool.length < 4) return null
  const plan = QUEUE_PLAN[mode]
  const shortlist = orderedPool.slice(0, plan.pool)
  const lock = Math.min(plan.lock, 4, shortlist.length)
  const forced = shortlist.slice(0, lock)
  const rest = shortlist.slice(lock)
  let best: SplitResult | null = null
  for (const extra of combinations(rest, 4 - lock)) {
    const candidate = bestSplit([...forced, ...extra], opts)
    if (candidate && (!best || candidate.score < best.score)) best = candidate
  }
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- tests/domain/pairing.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/domain/pairing.ts web/tests/domain/pairing.test.ts
git commit -m "feat: add team splitting with guaranteed slots for waiting players"
```

---

### Task 6: Session reducers

**Files:**
- Create: `web/src/domain/queue.ts`
- Test: `web/tests/domain/queue.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4 and 5
- Produces:
  - `interface SessionState { clockMin: number; courts: Court[]; queue: QueueEntry[]; players: SessionPlayer[]; mode: QueueMode; balanceWeight: number; rejected: Set<string>; lastTeamedAt: Record<string, number>; playedCount: number }`
  - `const MATCH_MINUTES = 14`
  - `function freePlayers(state: SessionState): SessionPlayer[]`
  - `function refillQueue(state: SessionState, nextId: () => string): SessionState`
  - `function sendToCourt(state: SessionState, entryIndex: number, nextId: () => string): SessionState`
  - `function finishMatch(state: SessionState, courtIndex: number, winner: 'A' | 'B', nextId: () => string): SessionState`

- [ ] **Step 1: Write the failing test**

Create `web/tests/domain/queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SessionPlayer, SessionState } from '@/domain/queue'
import { MATCH_MINUTES, freePlayers, refillQueue, sendToCourt, finishMatch } from '@/domain/queue'

let counter = 0
const nextId = () => `e${++counter}`

function makeState(n: number, courts: number): SessionState {
  const players: SessionPlayer[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    skill: 3,
    elo: 950 + i * 20,
    seasonGames: 30,
    gamesToday: 0,
    freeAtMin: 0,
  }))
  return {
    clockMin: 0,
    courts: Array.from({ length: courts }, (_, i) => ({ no: i + 1, match: null, startedAtMin: null })),
    queue: [],
    players,
    mode: 'mix',
    balanceWeight: 0.5,
    rejected: new Set(),
    lastTeamedAt: {},
    playedCount: 0,
  }
}

describe('refillQueue', () => {
  it('fills to court count plus one', () => {
    const s = refillQueue(makeState(12, 2), nextId)
    expect(s.queue).toHaveLength(3)
  })

  it('never puts the same player in two queued entries', () => {
    const s = refillQueue(makeState(12, 2), nextId)
    const ids = s.queue.flatMap(e => [...e.teamA, ...e.teamB])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps locked entries and rebuilds the rest', () => {
    const s = refillQueue(makeState(12, 2), nextId)
    const locked = { ...s.queue[0], locked: true }
    const after = refillQueue({ ...s, queue: [locked] }, nextId)
    expect(after.queue[0].id).toBe(locked.id)
  })

  it('does nothing in manual mode', () => {
    const s = refillQueue({ ...makeState(12, 2), mode: 'manual' }, nextId)
    expect(s.queue).toHaveLength(0)
  })
})

describe('sendToCourt', () => {
  it('moves the entry onto the first free court', () => {
    const s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    expect(s.courts[0].match).not.toBeNull()
    expect(s.courts[0].startedAtMin).toBe(0)
  })

  it('refuses when every court is busy', () => {
    let s = refillQueue(makeState(12, 1), nextId)
    s = sendToCourt(s, 0, nextId)
    const before = s.queue.length
    s = sendToCourt(s, 0, nextId)
    expect(s.queue).toHaveLength(before)
  })
})

describe('finishMatch', () => {
  it('advances the clock and credits the players', () => {
    let s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    const playing = [...s.courts[0].match!.teamA, ...s.courts[0].match!.teamB]
    s = finishMatch(s, 0, 'A', nextId)
    expect(s.clockMin).toBe(MATCH_MINUTES)
    expect(s.courts[0].match).toBeNull()
    for (const id of playing) {
      const p = s.players.find(x => x.id === id)!
      expect(p.gamesToday).toBe(1)
      expect(p.freeAtMin).toBe(MATCH_MINUTES)
    }
  })

  it('moves the winners up and the losers down', () => {
    let s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    const { teamA, teamB } = s.courts[0].match!
    const before = Object.fromEntries(s.players.map(p => [p.id, p.elo]))
    s = finishMatch(s, 0, 'A', nextId)
    const after = Object.fromEntries(s.players.map(p => [p.id, p.elo]))
    for (const id of teamA) expect(after[id]).toBeGreaterThan(before[id])
    for (const id of teamB) expect(after[id]).toBeLessThan(before[id])
  })

  it('keeps everyone within two games of each other over a long session', () => {
    let s = refillQueue({ ...makeState(12, 2), mode: 'fair' }, nextId)
    for (let step = 0; step < 400 && s.playedCount < 30; step++) {
      const free = s.courts.findIndex(c => !c.match)
      if (free >= 0 && s.queue.length > 0) {
        s = sendToCourt(s, 0, nextId)
        continue
      }
      const busy = s.courts.map((c, i) => (c.match ? i : -1)).filter(i => i >= 0)
      if (busy.length === 0) break
      // Alternate which court finishes so the simulation is not degenerate.
      s = finishMatch(s, busy[step % busy.length], step % 2 ? 'A' : 'B', nextId)
    }
    const games = s.players.map(p => p.gamesToday)
    expect(s.playedCount).toBeGreaterThanOrEqual(25)
    expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(2)
  })

  it('leaves nobody on zero games', () => {
    let s = refillQueue({ ...makeState(10, 2), mode: 'balance' }, nextId)
    for (let step = 0; step < 400 && s.playedCount < 30; step++) {
      const free = s.courts.findIndex(c => !c.match)
      if (free >= 0 && s.queue.length > 0) {
        s = sendToCourt(s, 0, nextId)
        continue
      }
      const busy = s.courts.map((c, i) => (c.match ? i : -1)).filter(i => i >= 0)
      if (busy.length === 0) break
      s = finishMatch(s, busy[step % busy.length], 'A', nextId)
    }
    expect(Math.min(...s.players.map(p => p.gamesToday))).toBeGreaterThan(0)
  })
})

describe('freePlayers', () => {
  it('excludes anyone on court or already queued', () => {
    const s = sendToCourt(refillQueue(makeState(12, 2), nextId), 0, nextId)
    const busy = new Set([
      ...s.courts.flatMap(c => (c.match ? [...c.match.teamA, ...c.match.teamB] : [])),
      ...s.queue.flatMap(e => [...e.teamA, ...e.teamB]),
    ])
    for (const p of freePlayers(s)) expect(busy.has(p.id)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- tests/domain/queue.test.ts`
Expected: FAIL, cannot resolve `@/domain/queue`.

- [ ] **Step 3: Write the implementation**

Create `web/src/domain/queue.ts`:

```ts
import type { Court, QueueEntry, QueueMode, SessionPlayer } from './types'
import { orderByPriority } from './fairness'
import { buildEntry, signature, type PairingOptions } from './pairing'
import { eloDelta } from './rating'

export type { SessionPlayer, QueueEntry, Court, QueueMode } from './types'

/** Assumed length of one game, used to advance the session clock. */
export const MATCH_MINUTES = 14

/** How many matches back a partnership still counts as recent. */
const PARTNER_MEMORY = 12
const PARTNER_PENALTY = 25

export interface SessionState {
  clockMin: number
  courts: Court[]
  queue: QueueEntry[]
  players: SessionPlayer[]
  mode: QueueMode
  balanceWeight: number
  /** Arrangements the organiser threw away. Never propose them again. */
  rejected: Set<string>
  /** partnership key -> playedCount at the time they last teamed up */
  lastTeamedAt: Record<string, number>
  playedCount: number
}

function partnerKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function onCourtIds(state: SessionState): string[] {
  return state.courts.flatMap(c => (c.match ? [...c.match.teamA, ...c.match.teamB] : []))
}

function queuedIds(state: SessionState): string[] {
  return state.queue.flatMap(e => [...e.teamA, ...e.teamB])
}

export function freePlayers(state: SessionState): SessionPlayer[] {
  const busy = new Set([...onCourtIds(state), ...queuedIds(state)])
  return state.players.filter(p => !busy.has(p.id))
}

function pairingOptions(state: SessionState): PairingOptions {
  return {
    balanceWeight: state.balanceWeight,
    rejected: state.rejected,
    recentPartnerPenalty: (a, b) => {
      const last = state.lastTeamedAt[partnerKey(a, b)]
      if (last === undefined) return 0
      return Math.max(0, PARTNER_MEMORY - (state.playedCount - last)) * PARTNER_PENALTY
    },
  }
}

export function refillQueue(state: SessionState, nextId: () => string): SessionState {
  if (state.mode === 'manual') return state
  // Drop unlocked entries: they were built from older fairness data.
  let next: SessionState = { ...state, queue: state.queue.filter(e => e.locked) }
  const depth = state.courts.length + 1
  for (let guard = 0; next.queue.length < depth && guard < 8; guard++) {
    const pool = orderByPriority(freePlayers(next), next.clockMin)
    const built = buildEntry(pool, next.mode, pairingOptions(next))
    if (!built) break
    next = {
      ...next,
      queue: [
        ...next.queue,
        {
          id: nextId(),
          teamA: built.teamA,
          teamB: built.teamB,
          gap: Math.round(built.gap),
          locked: false,
        },
      ],
    }
  }
  return next
}

export function sendToCourt(
  state: SessionState,
  entryIndex: number,
  nextId: () => string,
): SessionState {
  const courtIndex = state.courts.findIndex(c => !c.match)
  const entry = state.queue[entryIndex]
  if (courtIndex < 0 || !entry) return state
  const courts = state.courts.map((c, i) =>
    i === courtIndex ? { ...c, match: entry, startedAtMin: state.clockMin } : c,
  )
  const queue = state.queue.filter((_, i) => i !== entryIndex)
  return refillQueue({ ...state, courts, queue }, nextId)
}

export function finishMatch(
  state: SessionState,
  courtIndex: number,
  winner: 'A' | 'B',
  nextId: () => string,
): SessionState {
  const court = state.courts[courtIndex]
  if (!court?.match) return state
  const { teamA, teamB } = court.match
  const won = winner === 'A' ? teamA : teamB
  const lost = winner === 'A' ? teamB : teamA

  const eloOf = (id: string) => state.players.find(p => p.id === id)!.elo
  const delta = eloDelta((eloOf(won[0]) + eloOf(won[1])) / 2, (eloOf(lost[0]) + eloOf(lost[1])) / 2)

  const clockMin = state.clockMin + MATCH_MINUTES
  const playing = new Set([...teamA, ...teamB])
  const players = state.players.map(p => {
    if (!playing.has(p.id)) return p
    const sign = won.includes(p.id) ? 1 : -1
    return {
      ...p,
      elo: p.elo + sign * delta,
      seasonGames: p.seasonGames + 1,
      gamesToday: p.gamesToday + 1,
      freeAtMin: clockMin,
    }
  })

  const lastTeamedAt = { ...state.lastTeamedAt }
  for (const team of [teamA, teamB]) lastTeamedAt[partnerKey(team[0], team[1])] = state.playedCount

  const courts = state.courts.map((c, i) =>
    i === courtIndex ? { ...c, match: null, startedAtMin: null } : c,
  )

  return refillQueue(
    { ...state, clockMin, players, courts, lastTeamedAt, playedCount: state.playedCount + 1 },
    nextId,
  )
}

/** Record an arrangement the organiser rejected so it is not proposed again. */
export function rejectEntry(state: SessionState, entryIndex: number, nextId: () => string): SessionState {
  const entry = state.queue[entryIndex]
  if (!entry) return state
  const rejected = new Set(state.rejected)
  rejected.add(signature(entry.teamA, entry.teamB))
  return refillQueue(
    { ...state, rejected, queue: state.queue.filter((_, i) => i !== entryIndex) },
    nextId,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- tests/domain/queue.test.ts`
Expected: PASS, 9 tests. The fairness simulation must report a spread of 2 games or fewer.

- [ ] **Step 5: Run the whole suite**

Run: `cd web && npm test`
Expected: PASS, all domain tests green.

- [ ] **Step 6: Commit**

```bash
git add web/src/domain/queue.ts web/tests/domain/queue.test.ts
git commit -m "feat: add court and queue session reducers"
```

---

### Task 7: Database schema and the group cap

**Files:**
- Create: `web/supabase/migrations/0001_core_schema.sql`, `web/supabase/seed.sql`
- Test: `web/tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: tables `profiles, groups, group_members, players, seasons, sessions, attendance, matches, match_players`

- [ ] **Step 1: Start local Supabase**

```bash
cd web
npx supabase init
npx supabase start
```

Record the local `API URL`, `anon key`, and `service_role key` printed by the CLI into `web/.env.local`.
If Docker is not running, start Docker Desktop first. Local Postgres is required for Tasks 7 and 8.

- [ ] **Step 2: Write the failing test**

Install the client and a test helper:

```bash
cd web && npm install @supabase/supabase-js && npm install -D dotenv
```

Create `web/tests/db/schema.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

let admin: SupabaseClient

beforeAll(() => {
  admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
})

describe('group cap', () => {
  it('refuses to create a sixth group', async () => {
    const { count } = await admin.from('groups').select('*', { count: 'exact', head: true })
    const room = 5 - (count ?? 0)
    for (let i = 0; i < room; i++) {
      const { error } = await admin.from('groups').insert({ name: `filler ${i}` })
      expect(error).toBeNull()
    }
    const { error } = await admin.from('groups').insert({ name: 'one too many' })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('group_cap')
  })
})

describe('ownership rules', () => {
  it('allows only one owner per group', async () => {
    const { data: group } = await admin.from('groups').select('id').limit(1).single()
    const { data: users } = await admin.auth.admin.listUsers()
    const [a, b] = users.users
    await admin.from('group_members').delete().eq('group_id', group!.id)
    const first = await admin
      .from('group_members')
      .insert({ group_id: group!.id, user_id: a.id, role: 'owner' })
    expect(first.error).toBeNull()
    const second = await admin
      .from('group_members')
      .insert({ group_id: group!.id, user_id: b.id, role: 'owner' })
    expect(second.error).not.toBeNull()
  })
})

describe('players', () => {
  it('allows a player row with no linked account', async () => {
    const { data: group } = await admin.from('groups').select('id').limit(1).single()
    const { error } = await admin
      .from('players')
      .insert({ group_id: group!.id, name: 'ยังไม่มีบัญชี', skill: 3 })
    expect(error).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm test -- tests/db/schema.test.ts`
Expected: FAIL, relation "groups" does not exist.

- [ ] **Step 4: Write the migration**

Create `web/supabase/migrations/0001_core_schema.sql`:

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Hard system cap. Application code must never be the only thing enforcing this.
create or replace function enforce_group_cap() returns trigger language plpgsql as $$
begin
  if (select count(*) from groups) >= 5 then
    raise exception 'group_cap: the system is limited to 5 groups';
  end if;
  return new;
end $$;

create trigger group_cap before insert on groups
  for each row execute function enforce_group_cap();

create type member_role as enum ('owner', 'admin', 'member');

create table group_members (
  group_id uuid not null references groups on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- One owner per group, and one owned group per person.
create unique index one_owner_per_group on group_members (group_id) where role = 'owner';
create unique index one_group_per_owner on group_members (user_id) where role = 'owner';

create table players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  name text not null,
  skill smallint not null default 3 check (skill between 1 and 7),
  user_id uuid references profiles(id),
  last_seen_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index players_by_group on players (group_id) where archived_at is null;
-- One account maps to at most one player row inside a group.
create unique index one_player_per_account_per_group
  on players (group_id, user_id) where user_id is not null;

create table seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  name text not null,
  started_at date not null default current_date,
  ended_at date
);

create unique index one_open_season_per_group on seasons (group_id) where ended_at is null;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  season_id uuid not null references seasons on delete restrict,
  played_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table attendance (
  session_id uuid not null references sessions on delete cascade,
  player_id uuid not null references players on delete restrict,
  primary key (session_id, player_id)
);

create type queue_mode as enum ('manual', 'fair', 'mix', 'balance');

-- Append only. Never deleted, never capped. Ratings are computed from this table.
create table matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  group_id uuid not null references groups on delete cascade,
  court_no smallint not null,
  mode queue_mode not null,
  balance_weight real not null default 0.5,
  winner_team smallint check (winner_team in (1, 2)),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  client_id uuid not null unique
);

create index matches_by_group_time on matches (group_id, started_at, id);

create table match_players (
  match_id uuid not null references matches on delete cascade,
  player_id uuid not null references players on delete restrict,
  team smallint not null check (team in (1, 2)),
  primary key (match_id, player_id)
);
```

`players` is referenced by `match_players` with `on delete restrict`, which makes a hard delete impossible at the database level rather than by convention.

- [ ] **Step 5: Write the seed**

Create `web/supabase/seed.sql`:

```sql
-- Two auth users so ownership tests have somebody to fight over.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'member@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated');

insert into profiles (id, display_name, is_super_admin) values
  ('11111111-1111-1111-1111-111111111111', 'เจ้าของระบบ', true),
  ('22222222-2222-2222-2222-222222222222', 'สมาชิกทั่วไป', false);
```

- [ ] **Step 6: Apply and rerun**

```bash
cd web && npx supabase db reset
npm test -- tests/db/schema.test.ts
```

Expected: PASS, 3 tests. `npx supabase db reset` reruns migrations and the seed from scratch; run it before every database test run.

- [ ] **Step 7: Commit**

```bash
git add web/supabase web/tests/db/schema.test.ts web/package.json web/package-lock.json
git commit -m "feat: add core schema with hard group cap and no-delete players"
```

---

### Task 8: Row Level Security

**Files:**
- Create: `web/supabase/migrations/0002_rls.sql`
- Test: `web/tests/db/rls.test.ts`

**Interfaces:**
- Consumes: schema from Task 7
- Produces: SQL functions `is_super_admin(uuid)`, `is_group_member(uuid)`, `can_manage_group(uuid)`

- [ ] **Step 1: Write the failing test**

Create `web/tests/db/rls.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SUPER = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222'

let admin: SupabaseClient
let groupId: string

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw error
  return c
}

beforeAll(async () => {
  admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  const { data } = await admin.from('groups').insert({ name: 'ก๊วนทดสอบ', created_by: SUPER }).select('id').single()
  groupId = data!.id
  await admin.from('group_members').insert({ group_id: groupId, user_id: SUPER, role: 'owner' })
  await admin.from('players').insert({ group_id: groupId, name: 'บอส', skill: 6 })
})

describe('group visibility', () => {
  it('lets a member read their own group', async () => {
    const c = await signIn('owner@example.com')
    const { data } = await c.from('groups').select('id').eq('id', groupId)
    expect(data).toHaveLength(1)
  })

  it('hides a group from someone who is not in it', async () => {
    const c = await signIn('member@example.com')
    const { data } = await c.from('groups').select('id').eq('id', groupId)
    expect(data).toHaveLength(0)
  })

  it('hides that group\'s players too', async () => {
    const c = await signIn('member@example.com')
    const { data } = await c.from('players').select('id').eq('group_id', groupId)
    expect(data).toHaveLength(0)
  })
})

describe('write permission', () => {
  it('lets an owner add a player', async () => {
    const c = await signIn('owner@example.com')
    const { error } = await c.from('players').insert({ group_id: groupId, name: 'แนน', skill: 5 })
    expect(error).toBeNull()
  })

  it('stops an outsider from adding a player', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('players').insert({ group_id: groupId, name: 'แอบใส่', skill: 3 })
    expect(error).not.toBeNull()
  })

  it('stops a plain member from adding a player to their own group', async () => {
    await admin.from('group_members').insert({ group_id: groupId, user_id: OUTSIDER, role: 'member' })
    const c = await signIn('member@example.com')
    const { error } = await c.from('players').insert({ group_id: groupId, name: 'ไม่มีสิทธิ์', skill: 3 })
    expect(error).not.toBeNull()
    await admin.from('group_members').delete().eq('group_id', groupId).eq('user_id', OUTSIDER)
  })
})

describe('group creation', () => {
  it('stops a normal account from creating a group', async () => {
    const c = await signIn('member@example.com')
    const { error } = await c.from('groups').insert({ name: 'ก๊วนแอบสร้าง' })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx supabase db reset && npm test -- tests/db/rls.test.ts
```
Expected: FAIL — with RLS not yet enabled the outsider still sees the group.

- [ ] **Step 3: Write the migration**

Create `web/supabase/migrations/0002_rls.sql`:

```sql
create or replace function is_super_admin(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from profiles where id = uid), false);
$$;

create or replace function is_group_member(gid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid())
      or is_super_admin(auth.uid());
$$;

-- owner or admin
create or replace function can_manage_group(gid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role in ('owner', 'admin')
  ) or is_super_admin(auth.uid());
$$;

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table players enable row level security;
alter table seasons enable row level security;
alter table sessions enable row level security;
alter table attendance enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;

create policy profiles_self_read on profiles for select using (id = auth.uid() or is_super_admin(auth.uid()));
create policy profiles_self_write on profiles for update using (id = auth.uid());

create policy groups_read on groups for select using (is_group_member(id));
create policy groups_insert on groups for insert with check (is_super_admin(auth.uid()));
create policy groups_update on groups for update using (
  is_super_admin(auth.uid())
  or exists (select 1 from group_members m where m.group_id = groups.id and m.user_id = auth.uid() and m.role = 'owner')
);

create policy members_read on group_members for select using (is_group_member(group_id));
create policy members_write on group_members for all using (
  is_super_admin(auth.uid())
  or exists (select 1 from group_members m where m.group_id = group_members.group_id and m.user_id = auth.uid() and m.role = 'owner')
);

create policy players_read on players for select using (is_group_member(group_id));
create policy players_write on players for all using (can_manage_group(group_id)) with check (can_manage_group(group_id));

create policy seasons_read on seasons for select using (is_group_member(group_id));
create policy seasons_write on seasons for all using (can_manage_group(group_id)) with check (can_manage_group(group_id));

create policy sessions_read on sessions for select using (is_group_member(group_id));
create policy sessions_write on sessions for all using (can_manage_group(group_id)) with check (can_manage_group(group_id));

create policy attendance_read on attendance for select using (
  exists (select 1 from sessions s where s.id = attendance.session_id and is_group_member(s.group_id))
);
create policy attendance_write on attendance for all using (
  exists (select 1 from sessions s where s.id = attendance.session_id and can_manage_group(s.group_id))
) with check (
  exists (select 1 from sessions s where s.id = attendance.session_id and can_manage_group(s.group_id))
);

create policy matches_read on matches for select using (is_group_member(group_id));
create policy matches_write on matches for all using (can_manage_group(group_id)) with check (can_manage_group(group_id));

create policy match_players_read on match_players for select using (
  exists (select 1 from matches m where m.id = match_players.match_id and is_group_member(m.group_id))
);
create policy match_players_write on match_players for all using (
  exists (select 1 from matches m where m.id = match_players.match_id and can_manage_group(m.group_id))
) with check (
  exists (select 1 from matches m where m.id = match_players.match_id and can_manage_group(m.group_id))
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx supabase db reset && npm test -- tests/db/rls.test.ts
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add web/supabase/migrations/0002_rls.sql web/tests/db/rls.test.ts
git commit -m "feat: enforce group permissions with row level security"
```

---

### Task 9: Supabase clients and generated types

**Files:**
- Create: `web/src/lib/supabase/client.ts`, `web/src/lib/supabase/server.ts`, `web/src/lib/db-types.ts`
- Modify: `web/package.json` (add `db:types` script)

**Interfaces:**
- Consumes: schema from Tasks 7 and 8
- Produces:
  - `function createBrowserSupabase(): SupabaseClient<Database>`
  - `async function createServerSupabase(): Promise<SupabaseClient<Database>>`
  - `type Database` from `@/lib/db-types`

- [ ] **Step 1: Install the SSR helper**

```bash
cd web && npm install @supabase/ssr
```

- [ ] **Step 2: Generate types**

Add to `web/package.json` scripts:

```json
"db:types": "npx supabase gen types typescript --local > src/lib/db-types.ts"
```

Run: `cd web && npm run db:types`
Expected: `src/lib/db-types.ts` exists and exports `Database`.

- [ ] **Step 3: Write the browser client**

Create `web/src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/db-types'

export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 4: Write the server client**

Create `web/src/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/db-types'

export async function createServerSupabase() {
  const store = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options)
          } catch {
            // Called from a Server Component, where cookies are read only.
            // Session refresh happens in middleware instead.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 5: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib web/package.json web/package-lock.json
git commit -m "feat: add typed supabase clients for browser and server"
```

---

### Task 10: Login and profile bootstrap

**Files:**
- Create: `web/src/app/login/page.tsx`, `web/src/app/auth/callback/route.ts`, `web/src/middleware.ts`
- Create: `web/supabase/migrations/0003_profile_bootstrap.sql`

**Interfaces:**
- Consumes: `createServerSupabase`, `createBrowserSupabase`
- Produces: an authenticated session cookie; every `auth.users` row gets a matching `profiles` row

- [ ] **Step 1: Write the migration**

Create `web/supabase/migrations/0003_profile_bootstrap.sql`:

```sql
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
```

- [ ] **Step 2: Apply it**

```bash
cd web && npx supabase db reset
```
Expected: migrations apply with no error.

- [ ] **Step 3: Write the login page**

Create `web/src/app/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    })
    if (error) setError('ส่งลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง')
    else setSent(true)
  }

  if (sent) {
    return <main><h1>ส่งลิงก์เข้าอีเมลแล้ว</h1><p>เปิดอีเมลแล้วกดลิงก์เพื่อเข้าใช้งาน</p></main>
  }

  return (
    <main>
      <h1>เข้าสู่ระบบ</h1>
      <form onSubmit={send}>
        <label htmlFor="email">อีเมล</label>
        <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <button type="submit">ส่งลิงก์เข้าอีเมล</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
```

- [ ] **Step 4: Write the callback route**

Create `web/src/app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (code) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}/`)
  }
  return NextResponse.redirect(`${origin}/login?error=1`)
}
```

- [ ] **Step 5: Write the middleware**

Create `web/src/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of list) response.cookies.set(name, value, options)
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isPublic = path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/s/')
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
```

- [ ] **Step 6: Verify by hand**

```bash
cd web && npm run dev
```

Open `http://localhost:3000` — expect a redirect to `/login`.
Submit `owner@example.com`, then open `http://127.0.0.1:54324` (the local Inbucket mail catcher) and click the link.
Expect to land back on `/` while signed in.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/login web/src/app/auth web/src/middleware.ts web/supabase/migrations/0003_profile_bootstrap.sql
git commit -m "feat: add magic link login and profile bootstrap"
```

---

### Task 11: Group list gated by role

**Files:**
- Create: `web/src/app/page.tsx` (replace the scaffold placeholder), `web/src/lib/session.ts`
- Test: `web/tests/db/group-list.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase`
- Produces: `async function requireUser(): Promise<{ id: string; isSuperAdmin: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `web/tests/db/group-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function signIn(email: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  await c.auth.signInWithPassword({ email, password: 'password123' })
  return c
}

describe('group list query', () => {
  it('returns every group for a super admin', async () => {
    const c = await signIn('owner@example.com')
    const { data } = await c.from('groups').select('id, name')
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('returns nothing for an account in no group', async () => {
    const c = await signIn('member@example.com')
    const { data } = await c.from('groups').select('id, name')
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx supabase db reset && npm test -- tests/db/group-list.test.ts
```
Expected: FAIL on the first case — the seed creates no group yet.

- [ ] **Step 3: Extend the seed so a group exists**

Append to `web/supabase/seed.sql`:

```sql
insert into groups (id, name, created_by) values
  ('33333333-3333-3333-3333-333333333333', 'ก๊วนบางแสน จันทร์และพฤหัส', '11111111-1111-1111-1111-111111111111');

insert into group_members (group_id, user_id, role) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'owner');

insert into seasons (id, group_id, name) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'ซีซั่น 2569 ครึ่งปีแรก');

insert into players (group_id, name, skill) values
  ('33333333-3333-3333-3333-333333333333', 'บอส', 6),
  ('33333333-3333-3333-3333-333333333333', 'เอิร์ธ', 5),
  ('33333333-3333-3333-3333-333333333333', 'แนน', 5),
  ('33333333-3333-3333-3333-333333333333', 'ต้น', 4),
  ('33333333-3333-3333-3333-333333333333', 'มิ้นท์', 4),
  ('33333333-3333-3333-3333-333333333333', 'เจ', 4),
  ('33333333-3333-3333-3333-333333333333', 'ปอนด์', 3),
  ('33333333-3333-3333-3333-333333333333', 'ฟิล์ม', 3),
  ('33333333-3333-3333-3333-333333333333', 'กิ๊ก', 3),
  ('33333333-3333-3333-3333-333333333333', 'อาร์ม', 2);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx supabase db reset && npm test -- tests/db/group-list.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the session helper**

Create `web/src/lib/session.ts`:

```ts
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'

export async function requireUser() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()
  return { id: user.id, isSuperAdmin: profile?.is_super_admin ?? false }
}
```

- [ ] **Step 6: Write the page**

Replace `web/src/app/page.tsx`:

```tsx
import Link from 'next/link'
import { requireUser } from '@/lib/session'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function GroupListPage() {
  const user = await requireUser()
  const supabase = await createServerSupabase()
  // RLS decides what comes back. Do not filter by membership here.
  const { data: groups } = await supabase.from('groups').select('id, name').order('name')

  return (
    <main>
      <h1>ก๊วนของฉัน</h1>
      {user.isSuperAdmin && (
        <p>เหลือโควตาสร้างก๊วนอีก {Math.max(0, 5 - (groups?.length ?? 0))} จาก 5</p>
      )}
      {(groups ?? []).length === 0 ? (
        <p>ยังไม่ได้อยู่ก๊วนไหน รอหัวก๊วนส่งลิงก์เชิญ</p>
      ) : (
        <ul>
          {groups!.map(g => (
            <li key={g.id}><Link href={`/g/${g.id}`}>{g.name}</Link></li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 7: Verify by hand**

Run `npm run dev`, sign in as `owner@example.com`, confirm the group appears and the quota line reads 4 from 5.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/page.tsx web/src/lib/session.ts web/supabase/seed.sql web/tests/db/group-list.test.ts
git commit -m "feat: add group list page driven by row level security"
```

---

### Task 12: Members page

**Files:**
- Create: `web/src/app/g/[groupId]/members/page.tsx`, `web/src/app/g/[groupId]/members/actions.ts`
- Create: `web/src/lib/roles.ts`

**Interfaces:**
- Consumes: `createServerSupabase`, `requireUser`
- Produces:
  - `type Role = 'owner' | 'admin' | 'member'`
  - `async function roleInGroup(groupId: string): Promise<Role | 'super' | null>`
  - `async function canManage(groupId: string): Promise<boolean>`
  - server actions `addPlayer(formData)`, `archivePlayer(formData)`

- [ ] **Step 1: Write the role helper**

Create `web/src/lib/roles.ts`:

```ts
import { createServerSupabase } from '@/lib/supabase/server'

export type Role = 'owner' | 'admin' | 'member'

export async function roleInGroup(groupId: string): Promise<Role | 'super' | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('is_super_admin').eq('id', user.id).single()
  const { data: membership } = await supabase
    .from('group_members').select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
  if (membership?.role) return membership.role as Role
  return profile?.is_super_admin ? 'super' : null
}

export async function canManage(groupId: string): Promise<boolean> {
  const role = await roleInGroup(groupId)
  return role === 'owner' || role === 'admin' || role === 'super'
}
```

- [ ] **Step 2: Write the server actions**

Create `web/src/app/g/[groupId]/members/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'

export async function addPlayer(formData: FormData) {
  const groupId = String(formData.get('groupId'))
  const name = String(formData.get('name') ?? '').trim()
  const skill = Number(formData.get('skill') ?? 3)
  if (!name) return { error: 'กรุณากรอกชื่อ' }
  const supabase = await createServerSupabase()
  // No client-side permission check: the RLS policy is the gate.
  const { error } = await supabase.from('players').insert({ group_id: groupId, name, skill })
  if (error) return { error: 'เพิ่มไม่สำเร็จ อาจไม่มีสิทธิ์ในก๊วนนี้' }
  revalidatePath(`/g/${groupId}/members`)
  return { error: null }
}

export async function archivePlayer(formData: FormData) {
  const groupId = String(formData.get('groupId'))
  const playerId = String(formData.get('playerId'))
  const supabase = await createServerSupabase()
  // Archive only. There is no delete path anywhere in this app.
  const { error } = await supabase
    .from('players')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', playerId)
  if (error) return { error: 'เก็บเข้ากรุไม่สำเร็จ' }
  revalidatePath(`/g/${groupId}/members`)
  return { error: null }
}
```

- [ ] **Step 3: Write the page**

Create `web/src/app/g/[groupId]/members/page.tsx`:

```tsx
import { createServerSupabase } from '@/lib/supabase/server'
import { canManage } from '@/lib/roles'
import { addPlayer, archivePlayer } from './actions'

export default async function MembersPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createServerSupabase()
  const manage = await canManage(groupId)
  const { data: players } = await supabase
    .from('players')
    .select('id, name, skill, user_id, archived_at')
    .eq('group_id', groupId)
    .order('skill', { ascending: false })

  const active = (players ?? []).filter(p => !p.archived_at)
  const archived = (players ?? []).filter(p => p.archived_at)

  return (
    <main>
      <h1>สมาชิกก๊วน</h1>

      <section>
        <h2>ยังเล่นอยู่ {active.length} คน</h2>
        <ul>
          {active.map(p => (
            <li key={p.id}>
              {p.name} · มือ {p.skill} · {p.user_id ? 'ผูกบัญชีแล้ว' : 'ยังไม่มีบัญชี'}
              {manage && (
                <form action={archivePlayer}>
                  <input type="hidden" name="groupId" value={groupId} />
                  <input type="hidden" name="playerId" value={p.id} />
                  <button type="submit">เก็บเข้ากรุ</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {archived.length > 0 && (
        <section>
          <h2>อยู่ในกรุ {archived.length} คน</h2>
          <p>ไม่ขึ้นหน้าเช็กชื่อและกระดานอันดับ แต่สถิติยังอยู่ครบ</p>
          <ul>{archived.map(p => <li key={p.id}>{p.name}</li>)}</ul>
        </section>
      )}

      {manage ? (
        <form action={addPlayer}>
          <input type="hidden" name="groupId" value={groupId} />
          <label htmlFor="name">ชื่อ</label>
          <input id="name" name="name" required />
          <label htmlFor="skill">มือ</label>
          <input id="skill" name="skill" type="number" min={1} max={7} defaultValue={3} />
          <button type="submit">เพิ่มสมาชิก</button>
        </form>
      ) : (
        <p>สมาชิกทั่วไปดูรายชื่อได้ แต่แก้ไขไม่ได้</p>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Verify by hand**

Run `npm run dev`, sign in as the owner, add a player, confirm it appears and that archiving moves it to the second list. Confirm there is no delete button anywhere on the page.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/g web/src/lib/roles.ts
git commit -m "feat: add member management with archive instead of delete"
```

---

### Task 13: Session, check-in, and the play screen

**Files:**
- Create: `web/src/app/g/[groupId]/play/page.tsx`, `web/src/app/g/[groupId]/play/actions.ts`, `web/src/app/g/[groupId]/play/PlayClient.tsx`

**Interfaces:**
- Consumes: all of `@/domain`, `createServerSupabase`, `canManage`
- Produces:
  - server actions `openSession(groupId)`, `toggleAttendance(sessionId, playerId, present)`, `recordMatch(input)`
  - `interface RecordMatchInput { clientId: string; sessionId: string; groupId: string; courtNo: number; mode: QueueMode; balanceWeight: number; teamA: [string, string]; teamB: [string, string]; winnerTeam: 1 | 2 }`

- [ ] **Step 1: Write the server actions**

Create `web/src/app/g/[groupId]/play/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import type { QueueMode } from '@/domain/types'

export async function openSession(groupId: string) {
  const supabase = await createServerSupabase()
  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await supabase
    .from('sessions').select('id').eq('group_id', groupId).eq('played_on', today).maybeSingle()
  if (existing) return { sessionId: existing.id, error: null }

  const { data: season } = await supabase
    .from('seasons').select('id').eq('group_id', groupId).is('ended_at', null).maybeSingle()
  if (!season) return { sessionId: null, error: 'ก๊วนนี้ยังไม่มีซีซั่นที่เปิดอยู่' }

  const { data, error } = await supabase
    .from('sessions')
    .insert({ group_id: groupId, season_id: season.id, played_on: today })
    .select('id').single()
  if (error) return { sessionId: null, error: 'เปิดวันเล่นไม่สำเร็จ' }
  revalidatePath(`/g/${groupId}/play`)
  return { sessionId: data.id, error: null }
}

export async function toggleAttendance(sessionId: string, playerId: string, present: boolean) {
  const supabase = await createServerSupabase()
  if (present) {
    const today = new Date().toISOString().slice(0, 10)
    await supabase.from('attendance').upsert({ session_id: sessionId, player_id: playerId })
    // last_seen_on drives the 90 day dormancy rule.
    await supabase.from('players').update({ last_seen_on: today, archived_at: null }).eq('id', playerId)
  } else {
    await supabase.from('attendance').delete().eq('session_id', sessionId).eq('player_id', playerId)
  }
  return { error: null }
}

export interface RecordMatchInput {
  clientId: string
  sessionId: string
  groupId: string
  courtNo: number
  mode: QueueMode
  balanceWeight: number
  teamA: [string, string]
  teamB: [string, string]
  winnerTeam: 1 | 2
}

export async function recordMatch(input: RecordMatchInput) {
  const supabase = await createServerSupabase()
  // client_id is unique, so replaying a queued offline write is a no-op.
  const { data, error } = await supabase
    .from('matches')
    .insert({
      client_id: input.clientId,
      session_id: input.sessionId,
      group_id: input.groupId,
      court_no: input.courtNo,
      mode: input.mode,
      balance_weight: input.balanceWeight,
      winner_team: input.winnerTeam,
      ended_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: null } // already recorded
    return { error: 'บันทึกผลไม่สำเร็จ' }
  }

  const rows = [
    ...input.teamA.map(id => ({ match_id: data.id, player_id: id, team: 1 })),
    ...input.teamB.map(id => ({ match_id: data.id, player_id: id, team: 2 })),
  ]
  const { error: linkError } = await supabase.from('match_players').insert(rows)
  if (linkError) return { error: 'บันทึกรายชื่อผู้เล่นไม่สำเร็จ' }
  revalidatePath(`/g/${input.groupId}/play`)
  return { error: null }
}
```

- [ ] **Step 2: Write the client component**

Create `web/src/app/g/[groupId]/play/PlayClient.tsx`:

```tsx
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
    setState(s => finishMatch(s, courtIndex, winner, nextId))
    const result = await recordMatch({
      clientId: nextId(),
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
```

- [ ] **Step 3: Write the page**

Create `web/src/app/g/[groupId]/play/page.tsx`:

```tsx
import { createServerSupabase } from '@/lib/supabase/server'
import { canManage } from '@/lib/roles'
import { openSession } from './actions'
import PlayClient from './PlayClient'
import type { SessionPlayer } from '@/domain/types'
import { ELO_BASE } from '@/domain/rating'

export default async function PlayPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  if (!(await canManage(groupId))) {
    return (
      <main>
        <h1>โหมดสนาม</h1>
        <p>เปิดให้เฉพาะหัวก๊วนกับแอดมิน สมาชิกดูผลได้แต่กดจัดคิวหรือแก้ผลไม่ได้</p>
      </main>
    )
  }

  const { sessionId, error } = await openSession(groupId)
  if (!sessionId) return <main><h1>โหมดสนาม</h1><p role="alert">{error}</p></main>

  const supabase = await createServerSupabase()
  const { data: rows } = await supabase
    .from('attendance')
    .select('player_id, players(id, name, skill)')
    .eq('session_id', sessionId)

  type AttendanceRow = { player_id: string; players: { id: string; name: string; skill: number } | null }
  const attendees = (rows ?? []) as unknown as AttendanceRow[]

  // Phase 3 seeds every attendee at the base rating. Phase 5 replaces this
  // read with season_standings computed from the match log.
  const players: SessionPlayer[] = attendees
    .filter(r => r.players !== null)
    .map(r => ({
      id: r.player_id,
      skill: r.players!.skill,
      elo: ELO_BASE,
      seasonGames: 0,
      gamesToday: 0,
      freeAtMin: 0,
    }))

  // Names live here, not in SessionPlayer: the domain layer is about numbers.
  const names: Record<string, string> = Object.fromEntries(
    attendees.filter(r => r.players !== null).map(r => [r.player_id, r.players!.name]),
  )

  if (players.length < 4) {
    return (
      <main>
        <h1>โหมดสนาม</h1>
        <p>เช็กชื่อแล้ว {players.length} คน ต้องมีอย่างน้อย 4 คนถึงจะจัดคิวได้</p>
      </main>
    )
  }

  return (
    <main>
      <h1>โหมดสนาม</h1>
      <PlayClient
        groupId={groupId}
        sessionId={sessionId}
        players={players}
        names={names}
        courtCount={2}
      />
    </main>
  )
}
```

- [ ] **Step 4: Seed today's attendance so the screen has data**

Append to `web/supabase/seed.sql`:

```sql
-- Everyone in the seeded group is checked in for today, so the play screen
-- has enough people to build a queue on a fresh database.
insert into sessions (id, group_id, season_id, played_on) values
  ('55555555-5555-5555-5555-555555555555',
   '33333333-3333-3333-3333-333333333333',
   '44444444-4444-4444-4444-444444444444',
   current_date);

insert into attendance (session_id, player_id)
  select '55555555-5555-5555-5555-555555555555', id
  from players where group_id = '33333333-3333-3333-3333-333333333333';
```

Run: `cd web && npx supabase db reset`
Expected: reset completes with no error.

- [ ] **Step 5: Verify by hand**

Run `npm run dev`, sign in as `owner@example.com`, open
`/g/33333333-3333-3333-3333-333333333333/play`.

Expect: 3 queued matches showing Thai names (not UUIDs), "ยืนยันส่งลงสนาม" moves one onto a court,
recording a winner frees that court and refills the queue.

- [ ] **Step 6: Confirm the write landed**

Add a temporary check to `web/tests/db/schema.test.ts`, run it, then remove it:

```ts
it('records a match with its players', async () => {
  const { data } = await admin
    .from('matches')
    .select('court_no, winner_team, match_players(player_id, team)')
    .order('started_at', { ascending: false })
    .limit(1)
  expect(data?.[0]?.match_players).toHaveLength(4)
})
```

Run: `cd web && npm test -- tests/db/schema.test.ts`
Expected: PASS. Then delete the temporary test before committing.

- [ ] **Step 7: Run the whole suite**

Run: `cd web && npm test`
Expected: PASS, every domain and database test green.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/g web/supabase/seed.sql
git commit -m "feat: add court mode wired to the queue engine"
```

---

### Task 14: Wire the group home and open a pull request

**Files:**
- Create: `web/src/app/g/[groupId]/page.tsx`
- Modify: `web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `roleInGroup`, `createServerSupabase`
- Produces: navigation between group home, members, and play

- [ ] **Step 1: Write the group home**

Create `web/src/app/g/[groupId]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { roleInGroup } from '@/lib/roles'

const ROLE_LABEL: Record<string, string> = {
  super: 'ซูเปอร์แอดมิน',
  owner: 'หัวก๊วน',
  admin: 'แอดมิน',
  member: 'สมาชิก',
}

export default async function GroupHome({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const supabase = await createServerSupabase()
  const { data: group } = await supabase.from('groups').select('id, name').eq('id', groupId).maybeSingle()
  if (!group) notFound()

  const role = await roleInGroup(groupId)
  const manage = role === 'owner' || role === 'admin' || role === 'super'

  return (
    <main>
      <h1>{group.name}</h1>
      <p>คุณคือ {ROLE_LABEL[role ?? 'member']}</p>
      <ul>
        <li><Link href={`/g/${groupId}/members`}>สมาชิกก๊วน</Link></li>
        {manage && <li><Link href={`/g/${groupId}/play`}>เข้าโหมดสนาม</Link></li>}
      </ul>
      {!manage && <p>โหมดสนามเปิดให้เฉพาะหัวก๊วนกับแอดมิน</p>}
    </main>
  )
}
```

- [ ] **Step 2: Set the document language**

Replace the `<html>` tag in `web/src/app/layout.tsx` with `<html lang="th">` and set the metadata title to `ก๊วนแบด`.

- [ ] **Step 3: Verify the build and the suite**

```bash
cd web && npm run build && npm test
```
Expected: both succeed.

- [ ] **Step 4: Commit and push**

```bash
git add web/src/app
git commit -m "feat: add group home with role aware navigation"
git push -u origin feat/club-platform
```

- [ ] **Step 5: Open the pull request**

```bash
gh pr create --base main --title "feat: club platform phases 1-3" --body "$(cat <<'EOF'
## Summary
- Next.js 15 app under web/, existing index.html untouched
- Supabase schema with a hard 5 group cap, one owner per group, and no delete path for players
- Row Level Security enforces every permission; the UI never decides access
- Pure domain layer for rating, tiers, fairness, pairing, and the court queue, covered by unit tests
- Court mode: check in, queue, confirm onto a court, record a result

## Verification
- `npm test` green: domain unit tests plus RLS policy tests against local Supabase
- Fairness simulation asserts a spread of 2 games or fewer across 30 matches
- Manual pass through login, members, and court mode

Spec: docs/superpowers/specs/2026-08-04-badminton-club-design.md
Plan: docs/superpowers/plans/2026-08-04-badminton-phase-1-3.md
EOF
)"
```

---

## Self-Review

**Spec coverage for phases 1-3**

| Spec section | Task |
|---|---|
| §3 Stack, Vercel plus Supabase | 1, 7, 9 |
| §4.1 four permission layers | 8, 12, 13, 14 |
| §4.2 player without account, claim later | 7 (nullable `user_id`), 12 |
| §4.3 four database rules | 7 (cap, owner indexes), 8 (insert policy) |
| §5 schema and its five permanent rules | 7 |
| §6.1 courts and queue instead of rounds | 6, 13 |
| §6.2 fairness counts today only | 4 |
| §6.3 three splits, exhaustive | 5 |
| §6.4 four modes with guaranteed slots | 5 |
| §6.5 queue depth, lock, reject, confirm before court | 6, 13 |
| §6.6 blended rating | 3 |
| §7.2 tier ladder and progress window | 2 |
| §8 archive only, `last_seen_on` | 7, 12, 13 |
| §11 `client_id` idempotency | 7, 13 |

Deferred to later plans by design: offline outbox and PWA (phase 4), `season_standings` and the four leaderboards (phase 5), settlements and the public share page (phase 6), dormancy sweep UI and the cross-club profile (phase 7). Task 13 seeds every attendee at `ELO_BASE` and says so in a comment; phase 5 replaces that read.

**Placeholder scan:** none. Every code step carries runnable code; every test step carries assertions and an expected result.

**Type consistency:** `SessionPlayer`, `QueueEntry`, `Court`, and `QueueMode` are declared once in `src/domain/types.ts` (Task 4) and re-exported from `src/domain/queue.ts` (Task 6), which is the import path Task 13 uses. `buildEntry` and `bestSplit` share the `PairingOptions` shape across Tasks 5 and 6. `QUEUE_PLAN` keys match the `queue_mode` enum values in migration 0001.
