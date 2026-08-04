-- Final whole-branch review, finding 3 (High).
--
-- play/actions.ts's recordMatch did two separate PostgREST calls: insert into
-- `matches`, then insert into `match_players`. If the second call failed
-- (dropped connection, an RLS surprise, anything), the first insert had
-- already committed on its own -- PostgREST does not open a transaction that
-- spans two separate HTTP requests. That leaves an append-only match row
-- with no roster and, per finding 1 above, no delete path to ever remove it.
-- Phase 4's offline outbox will replay recordMatch on retry, and phase 5's
-- season_standings will read every row in `matches` and assume
-- match_players is always populated, so this had to be fixed now rather than
-- deferred.
--
-- Fixed by moving both inserts into one Postgres function, invoked once via
-- supabase.rpc(). A single function call runs inside one transaction: if any
-- statement inside raises, Postgres rolls the whole call back, so it is not
-- possible to observe a matches row with a missing or partial roster.
--
-- `security invoker` (Postgres's default, stated explicitly here so it can
-- never be silently changed by a future edit) is required, not
-- `security definer`. This branch's whole authorization model is "RLS is
-- the only gate, the UI never decides access" (spec section 5). A definer
-- function runs with the function owner's privileges and bypasses RLS
-- entirely, which would let ANY authenticated caller record a match against
-- ANY group through this one function, regardless of group_members --
-- exactly the kind of hole this branch exists to close. Invoker keeps the
-- caller's own role and auth.uid() in effect for every statement inside the
-- function, so matches_write and match_players_write's can_manage_group()
-- checks apply exactly as they do for a direct insert from a signed-in
-- manager, and both `with check` clauses' cross-tenant checks still run.
--
-- Idempotency: matches.client_id is unique (0001_core_schema.sql). On a
-- replayed call with the same client_id, `on conflict (client_id) do
-- nothing` makes the matches insert a no-op, and the function looks up the
-- existing row's id instead. The match_players insert then also no-ops via
-- its own primary key (match_id, player_id), so a retried call succeeds
-- without ever creating a duplicate match or a duplicate roster row -- this
-- is the exact contract phase 4's offline outbox will stand on.

create or replace function record_match(
  p_client_id uuid,
  p_session_id uuid,
  p_group_id uuid,
  p_court_no smallint,
  p_mode queue_mode,
  p_balance_weight real,
  p_winner_team smallint,
  p_team_a uuid[],
  p_team_b uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if array_length(p_team_a, 1) <> 2 or array_length(p_team_b, 1) <> 2 then
    raise exception 'record_match: each team must have exactly 2 players';
  end if;

  insert into matches (client_id, session_id, group_id, court_no, mode, balance_weight, winner_team, ended_at)
  values (p_client_id, p_session_id, p_group_id, p_court_no, p_mode, p_balance_weight, p_winner_team, now())
  on conflict (client_id) do nothing
  returning id into v_match_id;

  -- Replay: the insert above no-opped on the unique client_id, so the row
  -- (and its id) already exists from the original call.
  if v_match_id is null then
    select id into v_match_id from matches where client_id = p_client_id;
  end if;

  insert into match_players (match_id, player_id, team)
  values
    (v_match_id, p_team_a[1], 1),
    (v_match_id, p_team_a[2], 1),
    (v_match_id, p_team_b[1], 2),
    (v_match_id, p_team_b[2], 2)
  on conflict (match_id, player_id) do nothing;

  return v_match_id;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- PostgREST exposes any function reachable by a role as /rpc/<name>. Match
-- the same explicit revoke/grant pattern 0002_rls.sql used for
-- is_super_admin(): lock this down to authenticated only.
revoke execute on function record_match(uuid, uuid, uuid, smallint, queue_mode, real, smallint, uuid[], uuid[]) from public;
grant execute on function record_match(uuid, uuid, uuid, smallint, queue_mode, real, smallint, uuid[], uuid[]) to authenticated;
