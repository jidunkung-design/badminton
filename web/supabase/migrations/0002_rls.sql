-- is_super_admin takes no argument and reads auth.uid() internally rather than an
-- arbitrary uid. The earlier uid-argument form was a public oracle: security
-- definer bypasses RLS on profiles, and PostgREST exposes every function with
-- EXECUTE granted to a role as an /rpc/<name> endpoint, so an argument-taking
-- version let any caller probe any other user's admin status. Dropping the
-- argument removes the oracle by construction (a caller can only ever ask about
-- themselves) and every existing call site already passed auth.uid(), so no
-- caller loses functionality.
create or replace function is_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

create or replace function is_group_member(gid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid())
      or is_super_admin();
$$;

-- owner or admin
create or replace function can_manage_group(gid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role in ('owner', 'admin')
  ) or is_super_admin();
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

create policy profiles_self_read on profiles for select using (id = auth.uid() or is_super_admin());
create policy profiles_self_write on profiles for update using (id = auth.uid());

-- Row-level USING lets a user update their own profile row, but it says nothing
-- about which columns. Without a column-level grant, that update could set
-- is_super_admin = true on their own row and instantly pass is_super_admin()
-- everywhere -- full tenant compromise. Column privileges are checked before
-- RLS, so restricting the grant to display_name closes this at the privilege
-- layer. The trigger below is defense in depth in case some future migration
-- widens the grant again without re-deriving this reasoning.
revoke update on profiles from authenticated;
grant update (display_name) on profiles to authenticated;

create or replace function prevent_super_admin_self_grant() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'is_super_admin cannot be changed through this path';
  end if;
  return new;
end;
$$;

create trigger profiles_block_super_admin_change
  before update on profiles
  for each row execute function prevent_super_admin_self_grant();

create policy groups_read on groups for select using (is_group_member(id));
create policy groups_insert on groups for insert with check (is_super_admin());
create policy groups_update on groups for update using (
  is_super_admin()
  or exists (select 1 from group_members m where m.group_id = groups.id and m.user_id = auth.uid() and m.role = 'owner')
);

create policy members_read on group_members for select using (is_group_member(group_id));
create policy members_write on group_members for all using (
  is_super_admin()
  or exists (select 1 from group_members m where m.group_id = group_members.group_id and m.user_id = auth.uid() and m.role = 'owner')
);

create policy players_read on players for select using (is_group_member(group_id));
create policy players_write on players for all using (can_manage_group(group_id)) with check (can_manage_group(group_id));

create policy seasons_read on seasons for select using (is_group_member(group_id));
create policy seasons_write on seasons for all using (can_manage_group(group_id)) with check (can_manage_group(group_id));

create policy sessions_read on sessions for select using (is_group_member(group_id));
-- with check also confirms season_id actually belongs to this session's group_id.
-- Foreign keys only guarantee the season row exists somewhere, not that it
-- belongs to the same tenant, so without this a manager of group X could point
-- a session at group Y's season.
create policy sessions_write on sessions for all using (can_manage_group(group_id)) with check (
  can_manage_group(group_id)
  and exists (select 1 from seasons se where se.id = sessions.season_id and se.group_id = sessions.group_id)
);

create policy attendance_read on attendance for select using (
  exists (select 1 from sessions s where s.id = attendance.session_id and is_group_member(s.group_id))
);
-- with check also confirms the player belongs to the same group as the session,
-- so a manager of group X cannot pair a group-Y player_id with a group-X
-- session_id.
create policy attendance_write on attendance for all using (
  exists (select 1 from sessions s where s.id = attendance.session_id and can_manage_group(s.group_id))
) with check (
  exists (select 1 from sessions s where s.id = attendance.session_id and can_manage_group(s.group_id))
  and exists (
    select 1 from players p
    join sessions s2 on s2.id = attendance.session_id
    where p.id = attendance.player_id and p.group_id = s2.group_id
  )
);

create policy matches_read on matches for select using (is_group_member(group_id));
-- with check also confirms session_id belongs to the same group_id as the match
-- row being written, closing the same cross-tenant hole as sessions_write above.
create policy matches_write on matches for all using (can_manage_group(group_id)) with check (
  can_manage_group(group_id)
  and exists (select 1 from sessions s where s.id = matches.session_id and s.group_id = matches.group_id)
);

create policy match_players_read on match_players for select using (
  exists (select 1 from matches m where m.id = match_players.match_id and is_group_member(m.group_id))
);
-- with check also confirms the player belongs to the same group as the match,
-- so a manager of group X cannot roster a group-Y player_id into a group-X match.
create policy match_players_write on match_players for all using (
  exists (select 1 from matches m where m.id = match_players.match_id and can_manage_group(m.group_id))
) with check (
  exists (select 1 from matches m where m.id = match_players.match_id and can_manage_group(m.group_id))
  and exists (
    select 1 from players p
    join matches m2 on m2.id = match_players.match_id
    where p.id = match_players.player_id and p.group_id = m2.group_id
  )
);

-- Task 7 granted table privileges to service_role only. RLS policies are enforced
-- on top of standard Postgres privileges, not instead of them: a signed-in user
-- (role `authenticated`) still needs table-level grants to reach these policies
-- at all, otherwise every request fails with "permission denied" before RLS is
-- even evaluated. Grants below are scoped to what the policies above actually
-- allow: `authenticated` gets select everywhere it can read, and write access
-- only on tables whose policies permit writes by non-service-role users.
-- `anon` gets nothing here — anonymous read of the public settlement page is a
-- later phase with its own explicit policy. The revokes below are explicit
-- rather than relied-upon-by-omission: stock Supabase default privileges grant
-- ALL on tables created by the migration role to PUBLIC/anon in some setups, so
-- safety must come from this migration, not from environment defaults.
revoke all on all tables in schema public from anon;
revoke usage on schema public from anon;

grant usage on schema public to authenticated;

grant select on
  profiles, groups, group_members, players, seasons, sessions, attendance, matches, match_players
to authenticated;

grant insert on groups to authenticated;
grant update on groups to authenticated;
grant insert, update, delete on group_members to authenticated;
grant insert, update, delete on players to authenticated;
grant insert, update, delete on seasons to authenticated;
grant insert, update, delete on sessions to authenticated;
grant insert, update, delete on attendance to authenticated;
-- matches is append-only per 0001_core_schema.sql's own comment ("Append only.
-- Never deleted, never capped."). Granting delete here would let an
-- authenticated manager violate an invariant the schema itself declares, so
-- update is granted (for ended_at/winner_team) but delete is not.
grant insert, update on matches to authenticated;
grant insert, update, delete on match_players to authenticated;

-- is_super_admin() is security definer and bypasses RLS on profiles by design,
-- but Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- PostgREST exposes any function reachable by a role as /rpc/<name>. Left at
-- the default, `anon` could call it directly. Explicitly restrict execution to
-- authenticated only.
revoke execute on function is_super_admin() from public;
grant execute on function is_super_admin() to authenticated;
