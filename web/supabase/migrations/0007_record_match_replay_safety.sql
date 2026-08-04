-- Final whole-branch re-review, Medium finding in 0006_record_match_rpc.sql's
-- replay path.
--
-- The original record_match looked an existing match up by client_id alone
-- on conflict, then inserted the roster with `on conflict (match_id,
-- player_id) do nothing` without ever checking that the existing row's
-- identity, or its existing roster, actually matched the arguments of the
-- replayed call. A call that reused an existing client_id with a DIFFERENT
-- set of players would silently append up to four extra match_players rows
-- onto an already-recorded match and return success -- and per
-- 0005_lock_append_only_deletes.sql that match is now undeletable, so the
-- corruption would be permanent. Not reachable through today's UI (each
-- queue entry mints its own id -- see PlayClient.tsx), but /rpc/record_match
-- is callable directly by any authenticated manager, and phase 4's offline
-- outbox is being built directly on top of this replay contract, so it has
-- to be correct now.
--
-- Fixed by making the whole function trust nothing about "this must be a
-- genuine replay" -- it verifies instead:
--
-- 1. `insert ... on conflict (client_id) do update set client_id =
--    excluded.client_id returning ...` instead of `do nothing` + a
--    follow-up `select`. This always returns exactly one row, whether this
--    call inserted it or a prior call already did, and -- critically for
--    the Low concurrency finding below -- `do update` takes the row lock
--    and blocks until any concurrently-committing insert of the same
--    client_id finishes, so a genuine concurrent replay always sees the
--    committed row instead of racing a plain `select` against an
--    in-flight, not-yet-committed insert (which is what could previously
--    leave v_match_id null and die on a match_players not-null violation).
--
-- 2. After the upsert, the returned row's session_id/group_id/court_no/
--    winner_team are compared against this call's arguments. For a fresh
--    insert these are trivially equal (they are what this call just wrote),
--    so the check costs nothing on the common path. For a real replay with
--    mismatched arguments, it raises immediately -- before touching
--    match_players at all -- rather than silently reconciling anything. A
--    replay that disagrees with what was already recorded is a bug in the
--    caller (client_id reused for a different match), not a state for this
--    function to guess its way through.
--
-- 3. The existing match_players roster for that match id (if any) is read
--    and compared, team by team, against the four incoming players. No
--    existing rows -> proceed to insert (fresh match, or a same-identity
--    replay that somehow raced ahead of its own roster insert -- see
--    below). Existing rows equal to the incoming roster -> genuine replay,
--    no-op, return the match id. Existing rows different -> raise, without
--    writing anything. This is what makes the "same client_id, different
--    players" case fail loudly instead of appending 1-4 extra rows.
--
-- Because the matches upsert now blocks concurrent callers on the same
-- client_id until the first one's whole transaction (matches insert AND
-- match_players insert) has committed, by the time a genuine concurrent
-- replay reaches step 3 the roster comparison in point 3 above sees the
-- fully-written roster from the winner and takes the no-op path, rather
-- than racing to insert into an empty roster and hitting the primary key
-- twice under `do nothing` before either has been observed by the other.

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
  v_existing_session_id uuid;
  v_existing_group_id uuid;
  v_existing_court_no smallint;
  v_existing_winner_team smallint;
  v_expected_team1 uuid[];
  v_expected_team2 uuid[];
  v_existing_team1 uuid[];
  v_existing_team2 uuid[];
begin
  if array_length(p_team_a, 1) <> 2 or array_length(p_team_b, 1) <> 2 then
    raise exception 'record_match: each team must have exactly 2 players';
  end if;

  -- `do update` (rather than `do nothing`) forces this to always return a
  -- row, and takes the row lock so a concurrent replay of the same
  -- client_id blocks here until this transaction commits, instead of
  -- racing a separate `select` against an uncommitted insert.
  insert into matches (client_id, session_id, group_id, court_no, mode, balance_weight, winner_team, ended_at)
  values (p_client_id, p_session_id, p_group_id, p_court_no, p_mode, p_balance_weight, p_winner_team, now())
  on conflict (client_id) do update set client_id = excluded.client_id
  returning id, session_id, group_id, court_no, winner_team
    into v_match_id, v_existing_session_id, v_existing_group_id, v_existing_court_no, v_existing_winner_team;

  if v_existing_session_id <> p_session_id
     or v_existing_group_id <> p_group_id
     or v_existing_court_no <> p_court_no
     or v_existing_winner_team <> p_winner_team then
    raise exception 'record_match: client_id % already recorded a different match', p_client_id;
  end if;

  v_expected_team1 := array(select unnest(p_team_a) order by 1);
  v_expected_team2 := array(select unnest(p_team_b) order by 1);

  select array_agg(player_id order by player_id) into v_existing_team1
    from match_players where match_id = v_match_id and team = 1;
  select array_agg(player_id order by player_id) into v_existing_team2
    from match_players where match_id = v_match_id and team = 2;

  if v_existing_team1 is null and v_existing_team2 is null then
    -- Fresh match (or a same-identity replay whose original roster insert
    -- has not landed for some other reason): write the roster now.
    insert into match_players (match_id, player_id, team)
    values
      (v_match_id, p_team_a[1], 1),
      (v_match_id, p_team_a[2], 1),
      (v_match_id, p_team_b[1], 2),
      (v_match_id, p_team_b[2], 2)
    on conflict (match_id, player_id) do nothing;
  elsif v_existing_team1 = v_expected_team1 and v_existing_team2 = v_expected_team2 then
    -- Genuine replay of an already-fully-recorded match: no-op.
    null;
  else
    raise exception 'record_match: client_id % already recorded a different roster', p_client_id;
  end if;

  return v_match_id;
end;
$$;
