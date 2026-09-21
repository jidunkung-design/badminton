do $$
begin
  if (select count(*) from public.groups) > 3 then
    raise exception 'group_cap_migration: more than 3 existing rooms; no rooms were removed';
  end if;
end $$;

-- A nickname labels an authenticated identity; knowing it never signs someone in.
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_format check (
  username is null or (
    char_length(username) between 2 and 30
    and username = lower(normalize(username, NFC))
    and username ~ '^[A-Za-z0-9ก-๙_-]+$'
  )
);
create unique index profiles_username_unique on public.profiles (username);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end $$;

create function public.claim_username(p_username text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  requested text := lower(normalize(regexp_replace(p_username, '^[[:space:]]+|[[:space:]]+$', '', 'g'), NFC));
  current_name text;
begin
  if uid is null then raise exception 'auth_required'; end if;
  if requested is null or char_length(requested) not between 2 and 30
      or requested !~ '^[A-Za-z0-9ก-๙_-]+$' then
    raise exception 'username_invalid';
  end if;
  select username into current_name from public.profiles where id = uid for update;
  if not found then raise exception 'profile_missing'; end if;
  if current_name = requested then return current_name; end if;
  if current_name is not null then raise exception 'username_locked'; end if;
  update public.profiles set username = requested, display_name = requested where id = uid;
  return requested;
exception when unique_violation then
  raise exception 'username_taken';
end $$;

-- Three unique slots enforce the cap even with concurrent transactions or a
-- repeatable-read snapshot. Existing data is preserved; >3 rooms abort migration.
alter table public.groups add column room_slot smallint;
with slots as (
  select id, row_number() over (order by created_at, id) as slot from public.groups
)
update public.groups g set room_slot = slots.slot from slots where slots.id = g.id;
alter table public.groups alter column room_slot set not null;
alter table public.groups add constraint groups_room_slot_range check (room_slot between 1 and 3);
alter table public.groups add constraint groups_room_slot_unique unique (room_slot);
drop index public.one_group_per_owner;

create or replace function public.enforce_group_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- ponytail: global lock is sufficient for three rooms; revisit if the cap grows.
  perform pg_advisory_xact_lock(20260916, 3);
  select slot into new.room_slot from generate_series(1, 3) slot
  where not exists (select 1 from public.groups g where g.room_slot = slot)
  order by slot limit 1;
  if new.room_slot is null then raise exception 'group_cap: maximum 3 rooms'; end if;
  return new;
end $$;

create function public.create_room(p_name text, p_room_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nickname text;
  room_name text := btrim(p_name);
  existing_owner uuid;
begin
  if uid is null then raise exception 'auth_required'; end if;
  select username into nickname from public.profiles where id = uid;
  if nickname is null then raise exception 'username_required'; end if;
  if p_room_id is null or room_name is null or char_length(room_name) not between 1 and 80
      or room_name ~ '[[:cntrl:]]' then raise exception 'room_name_invalid'; end if;
  perform pg_advisory_xact_lock(20260916, 3);
  select created_by into existing_owner from public.groups where id = p_room_id;
  if found then
    if existing_owner = uid then return p_room_id; end if;
    raise exception 'room_id_unavailable';
  end if;
  insert into public.groups (id, name, created_by) values (p_room_id, room_name, uid);
  insert into public.group_members (group_id, user_id, role) values (p_room_id, uid, 'owner');
  insert into public.players (group_id, user_id, name) values (p_room_id, uid, nickname);
  insert into public.seasons (group_id, name) values (p_room_id, 'ซีซั่นแรก');
  return p_room_id;
end $$;

create function public.join_room(p_group_id uuid) returns uuid
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
  insert into public.group_members (group_id, user_id, role)
    values (p_group_id, uid, 'member') on conflict (group_id, user_id) do nothing;
  insert into public.players (group_id, user_id, name)
    values (p_group_id, uid, nickname)
    on conflict (group_id, user_id) where user_id is not null do nothing;
  return p_group_id;
end $$;

-- New columns do not inherit the existing display_name-only UPDATE grant.
revoke all on function public.claim_username(text) from public, anon;
revoke all on function public.create_room(text, uuid) from public, anon;
revoke all on function public.join_room(uuid) from public, anon;
grant execute on function public.claim_username(text) to authenticated;
grant execute on function public.create_room(text, uuid) to authenticated;
grant execute on function public.join_room(uuid) to authenticated;
