-- PIN hashes and room-wide attempt counters are accessible only inside RPCs.
create table public.room_entry_pins (
  group_id uuid primary key references public.groups on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 10),
  failure_window_at timestamptz,
  locked_until timestamptz
);
alter table public.room_entry_pins enable row level security;
revoke all on public.room_entry_pins from public,anon,authenticated;
grant all on public.room_entry_pins to service_role;

-- Preserve old requests without allowing approval before the current PIN was
-- verified. PIN rotation invalidates pending requests instead of deleting them.
alter table public.room_join_requests add column pin_verified boolean not null default false;

-- Remove the signatures that allowed entry without a PIN.
drop function public.create_room(text,uuid);
drop function public.join_room(uuid);

create function public.create_room(p_name text,p_room_id uuid,p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
 uid uuid:=auth.uid(); nickname text; room_name text:=btrim(p_name); existing_owner uuid;
begin
 if uid is null then raise exception 'auth_required'; end if;
 select username into nickname from public.profiles where id=uid;
 if nickname is null then raise exception 'username_required'; end if;
 if p_pin is null or char_length(p_pin)<>6 or p_pin !~ '^[0-9]{6}$' then raise exception 'pin_invalid'; end if;
 if p_room_id is null or room_name is null or char_length(room_name) not between 1 and 80
   or room_name ~ '[[:cntrl:]]' then raise exception 'room_name_invalid'; end if;
 perform pg_advisory_xact_lock(20260916,3);
 select created_by into existing_owner from public.groups where id=p_room_id;
 if found then
   -- Retrying creation never rotates an existing room's PIN.
   if existing_owner=uid then return p_room_id; end if;
   raise exception 'room_id_unavailable';
 end if;
 insert into public.groups(id,name,created_by) values(p_room_id,room_name,uid);
 insert into public.room_entry_pins(group_id,pin_hash) values(p_room_id,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
 insert into public.group_members(group_id,user_id,role) values(p_room_id,uid,'owner');
 insert into public.players(group_id,user_id,name) values(p_room_id,uid,nickname);
 insert into public.seasons(group_id,name) values(p_room_id,'ซีซั่นแรก');
 return p_room_id;
end $$;

create function public.set_room_pin(p_group_id uuid,p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 if not public.is_room_owner(p_group_id) then raise exception 'owner_required'; end if;
 if p_pin is null or char_length(p_pin)<>6 or p_pin !~ '^[0-9]{6}$' then raise exception 'pin_invalid'; end if;
 -- The upsert takes the same row lock as join/approval. A request verified
 -- before this rotation becomes stale; one verified afterwards uses the new PIN.
 insert into public.room_entry_pins(group_id,pin_hash)
 values(p_group_id,extensions.crypt(p_pin,extensions.gen_salt('bf',10)))
 on conflict(group_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,failure_window_at=null,locked_until=null;
 update public.room_join_requests set pin_verified=false where group_id=p_group_id;
 return p_group_id;
end $$;

create function public.room_pin_configured(p_group_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 if not public.is_room_owner(p_group_id) then raise exception 'owner_required'; end if;
 return exists(select 1 from public.room_entry_pins where group_id=p_group_id);
end $$;

create function public.join_room(p_group_id uuid,p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 uid uuid:=auth.uid(); nickname text; entry public.room_entry_pins%rowtype;
 checked_at timestamptz; valid_pin boolean:=false;
begin
 if uid is null then raise exception 'auth_required'; end if;
 perform 1 from public.groups where id=p_group_id for key share;
 if not found then raise exception 'room_not_found'; end if;
 if exists(select 1 from public.group_members where group_id=p_group_id and user_id=uid) then
   return jsonb_build_object('room_id',p_group_id);
 end if;
 select username into nickname from public.profiles where id=uid;
 if nickname is null then raise exception 'username_required'; end if;
 select * into entry from public.room_entry_pins where group_id=p_group_id for update;
 if not found then return jsonb_build_object('error','pin_not_configured'); end if;
 -- Room-wide throttling survives anonymous-account rotation. Read the clock
 -- after waiting for the lock so parallel attempts cannot reuse stale windows.
 checked_at:=clock_timestamp();
 if entry.locked_until>checked_at then return jsonb_build_object('error','pin_locked'); end if;
 if entry.locked_until is not null or entry.failure_window_at is null
   or entry.failure_window_at<=checked_at-interval '15 minutes' then
   entry.failed_attempts:=0;
   entry.failure_window_at:=checked_at;
   update public.room_entry_pins set failed_attempts=0,failure_window_at=checked_at,locked_until=null where group_id=p_group_id;
 end if;
 if p_pin is not null and char_length(p_pin)=6 and p_pin ~ '^[0-9]{6}$' then
   valid_pin:=extensions.crypt(p_pin,entry.pin_hash)=entry.pin_hash;
 end if;
 if not valid_pin then
   entry.failed_attempts:=entry.failed_attempts+1;
   update public.room_entry_pins set failed_attempts=entry.failed_attempts,
     locked_until=case when entry.failed_attempts>=10 then checked_at+interval '15 minutes' else null end
     where group_id=p_group_id;
   -- Return rather than raise: failed-attempt writes must commit.
   return jsonb_build_object('error',case when entry.failed_attempts>=10 then 'pin_locked' else 'pin_invalid' end);
 end if;
 insert into public.room_join_requests(group_id,user_id,username,pin_verified)
 values(p_group_id,uid,nickname,true)
 on conflict(group_id,user_id) do update set pin_verified=true,username=excluded.username,created_at=clock_timestamp();
 return jsonb_build_object('room_id',p_group_id);
end $$;

create or replace function public.approve_room_member(p_group_id uuid,p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nickname text; verified boolean;
begin
 if auth.uid() is null then raise exception 'auth_required'; end if;
 if not public.is_room_owner(p_group_id) then raise exception 'owner_required'; end if;
 -- Always lock PIN before request, matching join and rotation ordering.
 perform 1 from public.room_entry_pins where group_id=p_group_id for update;
 if exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_user_id) then
   delete from public.room_join_requests where group_id=p_group_id and user_id=p_user_id;
   return p_group_id;
 end if;
 select pin_verified into verified from public.room_join_requests where group_id=p_group_id and user_id=p_user_id for update;
 if not found then raise exception 'join_request_required'; end if;
 if not verified or not exists(select 1 from public.room_entry_pins where group_id=p_group_id) then raise exception 'join_request_expired'; end if;
 select username into nickname from public.profiles where id=p_user_id;
 if nickname is null then raise exception 'username_required'; end if;
 insert into public.group_members(group_id,user_id,role) values(p_group_id,p_user_id,'member');
 insert into public.players(group_id,user_id,name) values(p_group_id,p_user_id,nickname)
 on conflict(group_id,user_id) where user_id is not null do nothing;
 delete from public.room_join_requests where group_id=p_group_id and user_id=p_user_id;
 return p_group_id;
end $$;

revoke all on function public.create_room(text,uuid,text),public.join_room(uuid,text),public.set_room_pin(uuid,text),public.room_pin_configured(uuid) from public,anon;
grant execute on function public.create_room(text,uuid,text),public.join_room(uuid,text),public.set_room_pin(uuid,text),public.room_pin_configured(uuid) to authenticated;
