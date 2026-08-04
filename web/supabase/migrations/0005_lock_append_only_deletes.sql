-- Final whole-branch review, finding 1 (High).
--
-- 0002_rls.sql granted `delete` on players, sessions, and match_players to
-- `authenticated`, and each table's single `for all` policy therefore
-- permitted it too. That violates the two permanent invariants in
-- docs/superpowers/specs/2026-08-04-badminton-club-design.md section 5 and 8:
-- players are archived, never hard-deleted, and `matches` is append-only.
-- Concretely, with the pre-fix grants a signed-in manager could:
--   - `delete from players` and hard-delete a player row outright.
--   - `delete from sessions`, which cascades (`matches ... on delete cascade`)
--     to hard-delete every match played in that session.
--   - `delete from match_players`, silently rewriting a recorded match's
--     roster after the fact.
--
-- Fixed two ways, deliberately redundant:
--   1. Revoke the `delete` privilege from `authenticated` outright. This is
--      the layer that actually stops a request today: Postgres checks table
--      privileges before it ever plans/evaluates RLS, so a delete attempt
--      now fails at the privilege check.
--   2. Add an explicit `as restrictive ... for delete using (false)` policy
--      on each table anyway, so the refusal does not rest on the grant alone
--      being remembered forever. Restrictive policies are AND-ed with every
--      permissive policy that applies to the same command (players_write,
--      sessions_write, and match_players_write are all `for all`, which
--      includes delete) -- so even if some future migration re-grants
--      `delete` to `authenticated`, these three tables still refuse to
--      delete any row, because the restrictive policy alone can veto the
--      command regardless of what the permissive policy says. A plain
--      permissive `for delete using (false)` policy would NOT achieve this:
--      permissive policies are OR-ed together, so the existing `for all`
--      policy would still win and allow the delete.
--
-- Does not touch `group_members`, `seasons`, or `attendance`: the spec has
-- no permanent no-delete invariant for those tables, so their existing
-- grants and policies are left exactly as 0002_rls.sql defined them. Does
-- not touch `matches` either: 0002_rls.sql already withheld the `delete`
-- grant on `matches` from `authenticated` (see its own comment), so that
-- table already fails at the same privilege-check layer today.

revoke delete on players from authenticated;
revoke delete on sessions from authenticated;
revoke delete on match_players from authenticated;

create policy players_no_delete on players
  as restrictive for delete using (false);

create policy sessions_no_delete on sessions
  as restrictive for delete using (false);

create policy match_players_no_delete on match_players
  as restrictive for delete using (false);
