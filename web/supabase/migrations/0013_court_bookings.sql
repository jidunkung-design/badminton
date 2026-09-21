-- Booking windows belong to a playing session. NULL preserves existing courts
-- until the organiser sets a window; new configured windows are always bounded.
create table public.session_courts (
 session_id uuid not null references public.sessions on delete cascade,
 court_no smallint not null check(court_no>0),
 starts_at timestamptz,
 ends_at timestamptz,
 primary key(session_id,court_no),
 check ((starts_at is null and ends_at is null) or
   (starts_at is not null and ends_at is not null and ends_at>starts_at and ends_at<=starts_at+interval '24 hours'))
);
insert into public.session_courts(session_id,court_no)
 select s.id,n::smallint from public.sessions s cross join generate_series(1,2) n
 union select m.session_id,m.court_no from public.matches m where m.court_no>0;

create function public.initialize_session_courts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.session_courts(session_id,court_no) values(new.id,1),(new.id,2);
 return new;
end $$;
revoke all on function public.initialize_session_courts() from public,anon,authenticated;
create trigger sessions_initialize_courts after insert on public.sessions
 for each row execute function public.initialize_session_courts();

create table public.active_court_matches (
 session_id uuid not null,
 court_no smallint not null,
 client_id uuid not null unique,
 group_id uuid not null references public.groups on delete cascade,
 team_a uuid[] not null check(cardinality(team_a)=2),
 team_b uuid[] not null check(cardinality(team_b)=2),
 mode public.queue_mode not null,
 balance_weight real not null check(balance_weight between 0 and 1),
 started_at timestamptz not null default clock_timestamp(),
 primary key(session_id,court_no),
 foreign key(session_id,court_no) references public.session_courts(session_id,court_no) on delete cascade
);
alter table public.session_courts enable row level security;
alter table public.active_court_matches enable row level security;
revoke all on public.session_courts,public.active_court_matches from public,anon,authenticated;
grant all on public.session_courts,public.active_court_matches to service_role;
grant select on public.session_courts,public.active_court_matches to authenticated;
create policy session_courts_read on public.session_courts for select to authenticated using(
 exists(select 1 from public.sessions s where s.id=session_id and public.is_group_member(s.group_id))
);
create policy active_court_matches_read on public.active_court_matches for select to authenticated using(public.is_group_member(group_id));

-- Keep started_at as the immutable completion-order key used by Elo/streaks.
-- Old games have no trustworthy play clock and remain NULL, excluded from averages.
alter table public.matches add column play_started_at timestamptz,add column play_ended_at timestamptz;
alter table public.matches add constraint matches_play_clock check(
 (play_started_at is null and play_ended_at is null) or
 (play_started_at is not null and play_ended_at is not null and play_ended_at>=play_started_at)
);

create function public.save_session_court(p_group_id uuid,p_session_id uuid,p_court_no smallint,p_starts_at timestamptz,p_ends_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare session_day date;
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 perform 1 from public.groups where id=p_group_id for update;
 select s.played_on into session_day from public.sessions s join public.seasons se on se.id=s.season_id
 where s.id=p_session_id and s.group_id=p_group_id and se.group_id=p_group_id and se.ended_at is null;
 if not found then raise exception 'session_invalid'; end if;
 if p_court_no is null or p_court_no<1 or p_starts_at is null or p_ends_at is null
   or not isfinite(p_starts_at) or not isfinite(p_ends_at)
   or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '24 hours'
   or (p_starts_at at time zone 'Asia/Bangkok')::date<>session_day then raise exception 'booking_invalid'; end if;
 if exists(select 1 from public.active_court_matches where session_id=p_session_id and court_no=p_court_no) then raise exception 'court_busy'; end if;
 insert into public.session_courts(session_id,court_no,starts_at,ends_at) values(p_session_id,p_court_no,p_starts_at,p_ends_at)
 on conflict(session_id,court_no) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at;
 return p_session_id;
end $$;

create function public.begin_match(
 p_client_id uuid,p_session_id uuid,p_group_id uuid,p_court_no smallint,p_mode public.queue_mode,
 p_balance_weight real,p_team_a uuid[],p_team_b uuid[]
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
 active public.active_court_matches%rowtype; booking public.session_courts%rowtype;
 expected_a uuid[]; expected_b uuid[]; began_at timestamptz;
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 if p_client_id is null or p_session_id is null or p_group_id is null or p_court_no is null or p_court_no<1
   or p_mode is null or p_balance_weight is null or not(p_balance_weight between 0 and 1)
   or coalesce(cardinality(p_team_a),0)<>2 or coalesce(cardinality(p_team_b),0)<>2
   or (select count(distinct id) from unnest(p_team_a||p_team_b) id)<>4 then raise exception 'match_invalid'; end if;
 -- Save, begin and finish share this lock: a free-court/player check cannot race.
 perform 1 from public.groups where id=p_group_id for update;
 select array_agg(id order by id) into expected_a from unnest(p_team_a) id;
 select array_agg(id order by id) into expected_b from unnest(p_team_b) id;
 select * into active from public.active_court_matches where client_id=p_client_id;
 if found then
   if active.session_id is distinct from p_session_id or active.group_id is distinct from p_group_id
     or active.court_no is distinct from p_court_no or active.mode is distinct from p_mode
     or active.balance_weight is distinct from p_balance_weight
     or active.team_a is distinct from expected_a or active.team_b is distinct from expected_b then raise exception 'match_replay_conflict'; end if;
   return active.started_at;
 end if;
 if exists(select 1 from public.matches where client_id=p_client_id) then raise exception 'match_already_recorded'; end if;
 if not exists(select 1 from public.sessions s join public.seasons se on se.id=s.season_id
   where s.id=p_session_id and s.group_id=p_group_id and se.group_id=p_group_id and se.ended_at is null) then raise exception 'session_invalid'; end if;
 select * into booking from public.session_courts where session_id=p_session_id and court_no=p_court_no;
 if not found then raise exception 'court_not_configured'; end if;
 began_at:=clock_timestamp();
 if booking.starts_at is not null and (began_at<booking.starts_at or began_at>=booking.ends_at) then raise exception 'court_unavailable'; end if;
 if exists(select 1 from public.active_court_matches where session_id=p_session_id and court_no=p_court_no) then raise exception 'court_busy'; end if;
 if exists(select 1 from public.active_court_matches a where a.group_id=p_group_id and (a.team_a||a.team_b)&&(p_team_a||p_team_b)) then raise exception 'players_busy'; end if;
 if (select count(*) from public.players p join public.attendance a on a.player_id=p.id and a.session_id=p_session_id
   where p.id=any(p_team_a||p_team_b) and p.group_id=p_group_id and p.archived_at is null)<>4 then raise exception 'roster_invalid'; end if;
 insert into public.active_court_matches(session_id,court_no,client_id,group_id,team_a,team_b,mode,balance_weight,started_at)
 values(p_session_id,p_court_no,p_client_id,p_group_id,expected_a,expected_b,p_mode,p_balance_weight,began_at);
 return began_at;
end $$;

-- Reuse the reward transaction intact, while restricting callers to the wrapper.
alter function public.record_match(uuid,uuid,uuid,smallint,public.queue_mode,real,smallint,uuid[],uuid[]) rename to record_match_core;
revoke all on function public.record_match_core(uuid,uuid,uuid,smallint,public.queue_mode,real,smallint,uuid[],uuid[]) from public,anon,authenticated;
create function public.record_match(
 p_client_id uuid,p_session_id uuid,p_group_id uuid,p_court_no smallint,p_mode public.queue_mode,
 p_balance_weight real,p_winner_team smallint,p_team_a uuid[],p_team_b uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare active public.active_court_matches%rowtype; booking public.session_courts%rowtype; has_timer boolean; expected_a uuid[]; expected_b uuid[]; recorded uuid;
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 perform 1 from public.groups where id=p_group_id for update;
 select * into active from public.active_court_matches where client_id=p_client_id;
 has_timer:=found;
 if has_timer then
   select array_agg(id order by id) into expected_a from unnest(p_team_a) id;
   select array_agg(id order by id) into expected_b from unnest(p_team_b) id;
   if active.session_id is distinct from p_session_id or active.group_id is distinct from p_group_id
     or active.court_no is distinct from p_court_no or active.mode is distinct from p_mode
     or active.balance_weight is distinct from p_balance_weight
     or active.team_a is distinct from expected_a or active.team_b is distinct from expected_b then raise exception 'match_replay_conflict'; end if;
 elsif not exists(select 1 from public.matches where client_id=p_client_id) then
   -- Old clients may only finish an existing, unconfigured legacy court.
   -- Configured bookings require a server-observed start; completed retries
   -- remain valid even if the court's booking changed afterwards.
   select * into booking from public.session_courts where session_id=p_session_id and court_no=p_court_no;
   if not found then raise exception 'court_invalid'; end if;
   if booking.starts_at is not null or booking.ends_at is not null then raise exception 'match_start_required'; end if;
   if exists(select 1 from public.active_court_matches where session_id=p_session_id and court_no=p_court_no) then raise exception 'court_busy'; end if;
   if exists(select 1 from public.active_court_matches a where a.group_id=p_group_id and (a.team_a||a.team_b)&&(p_team_a||p_team_b)) then raise exception 'players_busy'; end if;
 end if;
 recorded:=public.record_match_core(p_client_id,p_session_id,p_group_id,p_court_no,p_mode,p_balance_weight,p_winner_team,p_team_a,p_team_b);
 if has_timer then
   update public.matches set play_started_at=active.started_at,play_ended_at=ended_at where id=recorded and play_started_at is null;
   delete from public.active_court_matches where client_id=p_client_id;
 end if;
 return recorded;
end $$;

create function public.get_player_durations(p_group_id uuid)
returns table(player_id uuid,average_minutes double precision,timed_games bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'room_forbidden'; end if;
 return query select mp.player_id,avg(extract(epoch from (m.play_ended_at-m.play_started_at))/60)::double precision,count(*)
 from public.matches m join public.match_players mp on mp.match_id=m.id
 where m.group_id=p_group_id and m.play_started_at is not null and m.play_ended_at>m.play_started_at
   and m.ended_at is not null and m.winner_team in (1,2)
 group by mp.player_id;
end $$;

revoke all on function public.save_session_court(uuid,uuid,smallint,timestamptz,timestamptz),public.begin_match(uuid,uuid,uuid,smallint,public.queue_mode,real,uuid[],uuid[]),public.record_match(uuid,uuid,uuid,smallint,public.queue_mode,real,smallint,uuid[],uuid[]),public.get_player_durations(uuid) from public,anon;
grant execute on function public.save_session_court(uuid,uuid,smallint,timestamptz,timestamptz),public.begin_match(uuid,uuid,uuid,smallint,public.queue_mode,real,uuid[],uuid[]),public.record_match(uuid,uuid,uuid,smallint,public.queue_mode,real,smallint,uuid[],uuid[]),public.get_player_durations(uuid) to authenticated;
