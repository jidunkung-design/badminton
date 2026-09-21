-- Adding people is an exact room-owner permission, separate from managing play.
create function public.is_room_owner(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role = 'owner'
  );
$$;
revoke all on function public.is_room_owner(uuid) from public, anon;
grant execute on function public.is_room_owner(uuid) to authenticated;

create table public.room_join_requests (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  -- Claimed usernames are immutable. This snapshot lets the owner review a
  -- request without opening private profile rows to other users.
  username text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.room_join_requests enable row level security;
revoke all on public.room_join_requests from public, anon, authenticated;
grant select on public.room_join_requests to authenticated;
grant all on public.room_join_requests to service_role;
create policy room_join_requests_read on public.room_join_requests
  for select to authenticated using (user_id = auth.uid() or public.is_room_owner(group_id));

drop policy players_write on public.players;
create policy players_insert on public.players
  for insert to authenticated with check (public.is_room_owner(group_id));
create policy players_update on public.players
  for update to authenticated using (public.can_manage_group(group_id))
  with check (public.can_manage_group(group_id));
-- An UPDATE must not turn an existing row into a newly added/linked member.
revoke update on public.players from authenticated;
grant update (name, skill, last_seen_on, archived_at) on public.players to authenticated;

drop policy members_write on public.group_members;
create policy members_insert on public.group_members
  for insert to authenticated with check (public.is_room_owner(group_id));
create policy members_update on public.group_members
  for update to authenticated using (public.is_room_owner(group_id))
  with check (public.is_room_owner(group_id));
create policy members_delete on public.group_members
  for delete to authenticated using (public.is_room_owner(group_id));
revoke update on public.group_members from authenticated;
grant update (role) on public.group_members to authenticated;

create or replace function public.join_room(p_group_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nickname text;
begin
  if uid is null then raise exception 'auth_required'; end if;
  select username into nickname from public.profiles where id = uid;
  if nickname is null then raise exception 'username_required'; end if;
  perform 1 from public.groups where id = p_group_id for key share;
  if not found then raise exception 'room_not_found'; end if;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = uid) then
    return p_group_id;
  end if;
  insert into public.room_join_requests (group_id, user_id, username)
    values (p_group_id, uid, nickname) on conflict (group_id, user_id) do nothing;
  return p_group_id;
end $$;

create function public.approve_room_member(p_group_id uuid, p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  nickname text;
  has_request boolean;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not public.is_room_owner(p_group_id) then raise exception 'owner_required'; end if;
  perform 1 from public.room_join_requests
    where group_id = p_group_id and user_id = p_user_id for update;
  has_request := found;
  -- Recheck after locking: concurrent approval may have consumed the request.
  -- Existing members (including owners/admins) retain their role and player.
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id) then
    delete from public.room_join_requests where group_id = p_group_id and user_id = p_user_id;
    return p_group_id;
  end if;
  if not has_request then raise exception 'join_request_required'; end if;
  select username into nickname from public.profiles where id = p_user_id;
  if nickname is null then raise exception 'username_required'; end if;
  insert into public.group_members (group_id, user_id, role) values (p_group_id, p_user_id, 'member');
  insert into public.players (group_id, user_id, name) values (p_group_id, p_user_id, nickname)
    on conflict (group_id, user_id) where user_id is not null do nothing;
  delete from public.room_join_requests where group_id = p_group_id and user_id = p_user_id;
  return p_group_id;
end $$;

create function public.reject_room_member(p_group_id uuid, p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not public.is_room_owner(p_group_id) then raise exception 'owner_required'; end if;
  delete from public.room_join_requests where group_id = p_group_id and user_id = p_user_id;
  return p_group_id;
end $$;

revoke all on function public.approve_room_member(uuid, uuid) from public, anon;
revoke all on function public.reject_room_member(uuid, uuid) from public, anon;
grant execute on function public.approve_room_member(uuid, uuid) to authenticated;
grant execute on function public.reject_room_member(uuid, uuid) to authenticated;
