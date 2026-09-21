-- Existing people remain unspecified; names, avatars and clothing imply nothing.
alter table public.profiles add column gender text not null default 'unspecified'
 check(gender in ('male','female','unspecified'));
alter table public.players add column gender text not null default 'unspecified'
 check(gender in ('male','female','unspecified'));

-- Profile/players UPDATE grants already list editable columns explicitly.
-- Gender changes go through the self/owner RPCs below, never the admin role's
-- existing skill/name editing permission.
create function public.inherit_player_gender() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.user_id is not null then
   -- Serialize with self updates so a concurrently approved/created room
   -- player cannot inherit an old value after propagation has completed.
   select gender into new.gender from public.profiles where id=new.user_id for share;
   if not found then raise exception 'profile_missing'; end if;
 end if;
 return new;
end $$;
revoke all on function public.inherit_player_gender() from public,anon,authenticated;
create trigger players_inherit_gender before insert on public.players
 for each row execute function public.inherit_player_gender();

create function public.set_profile_gender(p_gender text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); previous_gender text;
begin
 if uid is null then raise exception 'auth_required'; end if;
 if p_gender is null or p_gender not in ('male','female','unspecified') then raise exception 'gender_invalid'; end if;
 select gender into previous_gender from public.profiles where id=uid for update;
 if not found then raise exception 'profile_missing'; end if;
 -- A retry or unchanged login selection must preserve room-owner overrides.
 if previous_gender=p_gender then return p_gender; end if;
 update public.profiles set gender=p_gender where id=uid;
 update public.players set gender=p_gender where user_id=uid;
 return p_gender;
end $$;

create function public.set_player_gender(p_group_id uuid,p_player_id uuid,p_gender text) returns text
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 if not public.is_room_owner(p_group_id) then raise exception 'owner_required'; end if;
 if p_gender is null or p_gender not in ('male','female','unspecified') then raise exception 'gender_invalid'; end if;
 update public.players set gender=p_gender where id=p_player_id and group_id=p_group_id;
 if not found then raise exception 'player_not_found'; end if;
 return p_gender;
end $$;

revoke all on function public.set_profile_gender(text),public.set_player_gender(uuid,uuid,text) from public,anon;
grant execute on function public.set_profile_gender(text),public.set_player_gender(uuid,uuid,text) to authenticated;
