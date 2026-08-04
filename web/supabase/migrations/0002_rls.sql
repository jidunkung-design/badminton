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

-- Task 7 granted table privileges to service_role only. RLS policies are enforced
-- on top of standard Postgres privileges, not instead of them: a signed-in user
-- (role `authenticated`) still needs table-level grants to reach these policies
-- at all, otherwise every request fails with "permission denied" before RLS is
-- even evaluated. Grants below are scoped to what the policies above actually
-- allow: `authenticated` gets select everywhere it can read, and write access
-- only on tables whose policies permit writes by non-service-role users.
-- `anon` gets nothing here — anonymous read of the public settlement page is a
-- later phase with its own explicit policy.
grant usage on schema public to authenticated;

grant select on
  profiles, groups, group_members, players, seasons, sessions, attendance, matches, match_players
to authenticated;

grant update on profiles to authenticated;
grant insert on groups to authenticated;
grant update on groups to authenticated;
grant insert, update, delete on group_members to authenticated;
grant insert, update, delete on players to authenticated;
grant insert, update, delete on seasons to authenticated;
grant insert, update, delete on sessions to authenticated;
grant insert, update, delete on attendance to authenticated;
grant insert, update, delete on matches to authenticated;
grant insert, update, delete on match_players to authenticated;
