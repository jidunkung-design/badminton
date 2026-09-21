# Mascot and participation rewards — proposal

Status: code implemented with account-wide mascot/inventory/currency as the stated default. User confirmed Win Streak multiplies both ranking gains and coins. Room-specific ranking and streak reset on a loss. User restored Docker; migrations0009/0010 applied locally on2026-09-16 without resetting the database. Native invitation sharing is implemented.

## Player experience

1. A new identity gets a mascot with a plain shirt, shorts and shoes. Skin tone and basic hairstyle can be selected freely. One reusable SVG character renderer supplies profile icons, the full wardrobe preview and leaderboard portraits.
2. Wardrobe slots: headwear, shirt/outfit, shoes, racket and background. Only owned cosmetics can be equipped, with one item per slot. Plain defaults remain available without spending.
3. Completing a match shows each player's Elo change plus earned coins and chest. Everyone gets a chest and base coins; winners can receive a personal streak bonus. Cosmetics never modify Elo, skill or pairing.
4. Participation bonus is proposed for the first completed match of a Bangkok calendar day, not repeated check-in toggles. Initial values are listed below; they can be tuned in the catalog/migration.
5. Players open chests in their inventory and buy specific cosmetics or more chests in the shop. Display price, item slot, rarity and chest odds before spending; show balance after purchase. Duplicate cosmetics convert to a stated amount of coins.
6. Room owners see Share invitation and Copy link on the room overview immediately after creation. Native share opens the device share sheet; unsupported devices retain copy/manual link.

## Proposed starting economy

- Each completed match: 10 coins and one chest for each linked participating account. Winner coins and positive Elo gains receive the player’s personal post-win multiplier: streak0/1 = ×1, 2 = ×1.1, 3 = ×1.2, 4 = ×1.3, 5+ = ×1.5. Losing resets streak0, deducts base Elo only and still grants10 coins. Daily bonus is not multiplied.
- First completed match each day: 20 extra coins once per account/day across rooms.
- Match chest tier: Bronze 80%, Silver 18%, Gold 2%.
- Coins are earned in the app; this design has no cash purchases, trading or cash-out.

| Chest | Common | Rare | Epic | Legendary | Shop price |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bronze | 70% | 25% | 5% | 0% | 30 coins |
| Silver | 30% | 50% | 18% | 2% | 100 coins |
| Gold | 0% | 35% | 50% | 15% | 300 coins |

Item rarity is independent of chest tier and equipment slot. Within a selected rarity, eligible catalog items have equal odds. The opening screen displays the eligible pool and odds. Proposed item prices: Common50 / Rare150 / Epic400 / Legendary1000. Duplicate refunds:5 /15 /40 /100 coins respectively. These are initial implementation values; production use requires the pending migration.

## Data and authorization

Reuse Supabase identity and existing room/player links. Use account ID as inventory ownership key. Minimal persistent data: item/chest catalog and drop weights, wallet/appearance, owned items and unopened chests, and an immutable event ledger containing purchase/open/reward outcomes.

Every purchase/open/completion is an authenticated DB transaction. The server reads catalog prices and drop weights, locks balances and owned quantities, verifies ownership and slot compatibility, and writes the resulting ledger event. A request ID must return the original outcome on retry; opening again cannot reroll. Completed-match awards are unique per recipient/match. Daily bonuses use Bangkok date with a uniqueness constraint, not a mutable check-in or session ID.

Harden record_match before rewards: validate exactly four distinct room players, valid current attendance/session/teams and manager authority; reject malformed/null arrays. Route match writes through the guarded completion transaction and close direct authenticated writes to the match log/roster. Freeze player-to-account identity links so a manager cannot redirect someone else's rewards. Room owners still attest the real-world result; the app cannot prove physical play.

Manually added players with no account show the plain mascot; proposed first version grants personal rewards only after they join with their own identity. Never link accounts by matching names. Do not silently back-award old matches.

Expose only equipped appearance to peers in the same room. Wallet and unequipped inventory remain private. Read leaderboard appearances in one batch. Keep per-room Elo replay unchanged.

## Completion checks

- Plain default mascot; wardrobe changes update profile and ranking consistently.
- Cannot equip unowned items or incompatible slots.
- Concurrent purchase cannot overspend; insufficient balance changes nothing.
- Duplicate completion awards once; duplicate opening returns the same reward and consumes one chest.
- Daily bonus cannot be farmed through check-in toggles, multiple sessions or repeated requests.
- Verify chest boundary weights and duplicate conversion; record exact granted result.
- No unauthorized wallet writes or reading another member's private inventory.
- Scope matches selected shared/room-local policy; rating remains isolated.
- Mobile wardrobe/shop remain usable, loading/errors announced, and reduced motion respected.

## Owner-only membership update

Only the exact room owner can add roster members or approve/reject requests. Invitation links create pending requests; they no longer admit immediately. Pending identities see only their own request, not room data. Admins retain play/check-in and existing-player management. Protected identity columns prevent moving/relinking players to bypass this rule.

## Verification snapshot

106 tests across24 files pass, including real local database tests for owner admission, role escalation prevention, wallet/loot concurrency, whole-day roster transitions, rotating court players and unknown legacy snapshots. TypeScript, source ESLint and production build passed before the database run; changed test files pass ESLint. Fixed the security test teardown to remove match/session references before its room, then verified only the original two rooms remain. Browser smoke checks confirm login and preview render. Full browser QA of approval, rewards, wardrobe, shop and portraits remains separate from the database coverage. No remote changes or deploy.

## Confirmed whole-day roster reset rule

The user confirmed ABCD means everyone checked in for the whole playing day, not the four players currently on court. Consecutive roster transitions ABCD→ABCD carry streaks, ABCD→ABCF reset everyone, ABCF→ABCD reset again without reviving old streaks, and the next ABCD→ABCD carries onward. Names/order/teams/court changes do not affect participant identity; compare canonical player ID sets per room/season. Elo balances and past rewards stay recorded.

Each new completed match snapshots the distinct checked-in player IDs across all sessions for that room, season and playing date. Comparison uses immutable consecutive snapshots. A changed roster resets everyone including resting/absent players before that result; a win then starts at1/×1. Unknown legacy snapshots never infer attendance retroactively. Retrying an old result preserves its original snapshot and award. An active day with an empty current roster shows reset streaks; a day with no session preserves the previous record until play resumes. Calendar dates use Asia/Bangkok.

Local queue state now synchronizes updated server attendance/streaks without dropping active matches or retry IDs, and a new session resets local court state. The applied local database migrations and full test suite were verified after the user restored Docker.
