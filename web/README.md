This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Cloudflare Workers

Follow [the deployment guide](docs/deployment.md) for Node.js 22+, OpenNext and hosted Supabase. Run `npm run build:cloudflare` to build and `npm run preview:cloudflare` to test the Worker locally. `npm run deploy:cloudflare` checks the production environment before building and publishing.

## Guest rooms

The entry page uses a unique Thai/English nickname and a Supabase anonymous session;
no email or social account is needed. The session identifies the person, not the
nickname. Clearing browser data or changing devices cannot recover that identity.
The creator is the room owner. `/login?join=<room UUID>` submits a request for the room owner to approve.
After migration `0011_room_pin.sql`, creating a room requires a six-digit PIN and
joining requires the current PIN before a request can be submitted. Existing room
owners set their PIN from Members; existing members keep access. PINs are bcrypt
hashed in a private table and never included in invite links. Ten failed guesses
lock new join attempts for 15 minutes across accounts. Changing the PIN invalidates
pending requests, which must be resubmitted with the new PIN before approval.
Each room has separate players and current-season Elo standings; the system has
three room slots in total. Room creation is transactional and retries use the same
room UUID. No additional dependencies are required.

For local development, run `npx supabase start` from `web`, then
`npx supabase migration up --local` for an existing database. Local anonymous auth
is enabled in `supabase/config.toml`. If optional Studio fails its health check,
`npx supabase start -x studio` runs the application services without Studio.
Keep the local project URL and keys in `.env.local` (see `.env.local.example`).
Do not reset an existing database just to apply this migration.

Before hosting, apply migration `0008_guest_rooms.sql` and enable Anonymous
Sign-Ins in Supabase Auth for that environment; the local TOML does not change
hosted Auth settings. Migration0008 refuses to apply if more than three rooms
already exist, without removing any data. Public deployments should configure
Supabase anonymous-signup rate limits/CAPTCHA to control automated signup abuse.

Run `npm test` with local Supabase running for the database and unit checks;
`npm run build` checks the production application. Database tests use disposable
fixtures and clean them up; do not run them against a shared production database.

## Mascots, rewards and streaks

Migration `0012_feminine_cosmetics.sql` adds sport skirts, tennis dresses and bows
to the existing shop and chest pools. All characters may equip them; rarity odds
remain unchanged. The wardrobe's large mascot has optional breathing, blinking
and racket motion with a pause button. Chest opening and reward reveals animate
briefly; system reduced-motion settings disable motion and the opening delay.

## Courts and match time

Migration `0013_court_bookings.sql` adds per-session court booking windows, server
start timers and player duration averages. Existing sessions retain two courts
without a booking restriction until configured. Managers can add courts and set
Bangkok start/end times; an end time at or before the start means the following day.
An active court cannot be rescheduled. Matches may finish after the booking ends,
but no new match can start outside its configured window.

Estimates average the available individual player averages in this room, across
seasons: 12 and 18 minutes predict 15 minutes; one known player at 12 predicts 12;
no measured history falls back to 14. Only matches with a real server start timer
contribute, so old completion timestamps do not become fabricated durations.
Active matches survive refresh and finish retries preserve their original timing
and rewards. Historical rating order continues to use the original event timestamp.

Migrations0009/0010 add owner-only admission and account-wide cosmetic inventory. Apply both after0008. Owners approve pending join requests from the members page; admins cannot add members. `/mascot` contains the wardrobe, inventory and coin shop. Character appearance is shared across rooms, while ranking/streak remains room-and-season specific.

Each completed game grants linked players a chest and10 base coins, with20 bonus coins for their first completed game of the Bangkok day. Consecutive wins2/3/4/5+ multiply positive ranking gains and winner coins by1.1/1.2/1.3/1.5. Losses reset the streak and deduct base Elo only. Unlinked manual players receive no personal items until they join with their own identity; old matches are not back-awarded.

Purchases and chest opening use stable request UUIDs, database wallet locks and stored outcomes. Only server RPCs can write balances, inventory and match completion. Applying0010 intentionally closes direct authenticated match/roster writes. No real-money purchases or cross-device account recovery are implemented.

Win Streak also resets for everyone whenever the whole-day checked-in roster changes.
ABCD→ABCD carries, ABCD→ABCF resets, ABCF→ABCD resets again; a returning lineup does not resurrect an earlier streak. Court/team rotation alone never resets it. Each completed match stores its attendance snapshot, so editing check-in later does not rewrite prior rewards. A first win after reset starts at1 (×1); Elo balances remain accumulated.

## Rotation, draws and court mascots

Migration `0014_rotation_draws.sql` adds a session rule chosen before starting:
`all_out` releases all four players, while `winner_stays` reserves the winning
pair on that court for the next challengers. Managers can release a retained pair.
Active matches snapshot the rule; retries do not rewrite newer court state.

Managers can finish with a draw (`winner_team = 0`, distinct from unfinished NULL),
including a game stopped for time. Draws use the standard Elo result of 0.5 without
streak multipliers, reset all four win streaks, grant participation rewards, and
release both teams. Measured draws count toward duration averages. Exact-pair
head-to-head totals cover the room's completed history across seasons, regardless
of player order or which side the teams occupied.

The live and preview court scenes display equipped mascots with a shuttle rally.
Completed wins choose one of three brief celebrations from the match ID; draws
show applause. The scene includes a motion toggle and honors reduced-motion.

## Preview and action feedback

`/preview` simulates twelve attendees across two simultaneous courts: one all-out, one winner-stays. Each court has independent scoring, settings and mascot results; both share a queue that excludes active players and retained winners. Refresh or reset restores demo data without writing to the database.

HeroUI toasts report settled actions across room entry, members, check-in, court play, cosmetics and invitations. Inline validation, retry controls and detailed match/chest results remain available. Head-to-head summaries use compact named-team columns, and gender controls share custom racket SVG icons with accessible labels.

## Gender-aware pairing

Migration `0015_player_gender.sql` stores an explicitly selected `male`, `female`
or `unspecified` value. Existing profiles and players remain unspecified. Entry
and owner-managed player forms use accessible symbol choices (♂, ♀, ○). Linked
players inherit the account choice; a changed self-selection updates linked
players, while an unchanged retry preserves a room owner's local override.

Pairing adds a small composition preference only when all four values are known:
25 pairing-score points per difference in the teams' male counts. This is a
heuristic for choosing teams, not a change to anyone's Elo or skill. Fairness
locks and retained winning pairs remain intact; a substantial skill gap can
outweigh the preference. Both ordinary pairs and retained-pair challengers use
the shared criterion. The UI explains incomplete data or differing compositions.
Preview uses the same pairing helpers and displays the actual proposed A/B teams
with their average blended pairing ratings before starting.
