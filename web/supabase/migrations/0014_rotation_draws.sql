-- NULL winner still means unfinished; zero is a completed draw.
alter table public.matches drop constraint matches_winner_team_check;
alter table public.matches add constraint matches_winner_team_check check(winner_team in (0,1,2));
alter table public.sessions add column rotation_mode text not null default 'all_out' check(rotation_mode in ('all_out','winner_stays'));
alter table public.active_court_matches add column rotation_mode text not null default 'all_out' check(rotation_mode in ('all_out','winner_stays'));
alter table public.matches add column rotation_mode text not null default 'all_out' check(rotation_mode in ('all_out','winner_stays'));
alter table public.session_courts
 add column retained_pair uuid[] check(retained_pair is null or cardinality(retained_pair)=2),
 add column retained_match_id uuid references public.matches on delete set null;

create function public.set_session_rotation(p_group_id uuid,p_session_id uuid,p_rotation_mode text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare previous_mode text;
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 if p_rotation_mode is null or p_rotation_mode not in ('all_out','winner_stays') then raise exception 'rotation_invalid'; end if;
 perform 1 from public.groups where id=p_group_id for update;
 select s.rotation_mode into previous_mode from public.sessions s join public.seasons se on se.id=s.season_id
 where s.id=p_session_id and s.group_id=p_group_id and se.group_id=p_group_id and se.ended_at is null;
 if not found then raise exception 'session_invalid'; end if;
 if previous_mode=p_rotation_mode then return p_session_id; end if;
 if exists(select 1 from public.active_court_matches where session_id=p_session_id) then raise exception 'session_busy'; end if;
 if previous_mode<>p_rotation_mode then
   update public.sessions set rotation_mode=p_rotation_mode where id=p_session_id;
   update public.session_courts set retained_pair=null,retained_match_id=null where session_id=p_session_id;
 end if;
 return p_session_id;
end $$;

create function public.release_retained_pair(p_group_id uuid,p_session_id uuid,p_court_no smallint,p_retained_match_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare held public.session_courts%rowtype;
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 perform 1 from public.groups where id=p_group_id for update;
 if not exists(select 1 from public.sessions where id=p_session_id and group_id=p_group_id) then raise exception 'session_invalid'; end if;
 select * into held from public.session_courts where session_id=p_session_id and court_no=p_court_no;
 if not found then raise exception 'court_invalid'; end if;
 if exists(select 1 from public.active_court_matches where session_id=p_session_id and court_no=p_court_no) then raise exception 'court_busy'; end if;
 if held.retained_pair is null then return p_session_id; end if;
 if p_retained_match_id is null or held.retained_match_id is distinct from p_retained_match_id then raise exception 'retained_pair_changed'; end if;
 update public.session_courts set retained_pair=null,retained_match_id=null where session_id=p_session_id and court_no=p_court_no;
 return p_session_id;
end $$;

create or replace function public.record_match_core(
 p_client_id uuid,p_session_id uuid,p_group_id uuid,p_court_no smallint,p_mode public.queue_mode,
 p_balance_weight real,p_winner_team smallint,p_team_a uuid[],p_team_b uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
 game public.matches%rowtype; season uuid; session_day date; roster uuid[]; roster_count integer; participant record; history record; streak integer;
 multiplier numeric; earned integer; bonus integer; chest text; roll numeric;
 existing_a uuid[]; existing_b uuid[]; expected_a uuid[]; expected_b uuid[];
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 if p_client_id is null or p_session_id is null or p_group_id is null or p_court_no is null or p_court_no<1
   or p_mode is null or p_balance_weight is null or not(p_balance_weight between 0 and 1)
   or p_winner_team is null or p_winner_team not in (0,1,2)
   or coalesce(cardinality(p_team_a),0)<>2 or coalesce(cardinality(p_team_b),0)<>2
   or (select count(distinct id) from unnest(p_team_a||p_team_b) id)<>4 then raise exception 'match_invalid'; end if;
 -- Serialize games in a room so streak awards and historical rating replay agree.
 perform 1 from public.groups where id=p_group_id for update;
 select array_agg(id order by id) into expected_a from unnest(p_team_a) id;
 select array_agg(id order by id) into expected_b from unnest(p_team_b) id;
 select * into game from public.matches where client_id=p_client_id;
 if found then
   select array_agg(player_id order by player_id) into existing_a from public.match_players where match_id=game.id and team=1;
   select array_agg(player_id order by player_id) into existing_b from public.match_players where match_id=game.id and team=2;
   if game.session_id is distinct from p_session_id or game.group_id is distinct from p_group_id
     or game.court_no is distinct from p_court_no or game.mode is distinct from p_mode
     or game.balance_weight is distinct from p_balance_weight or game.winner_team is distinct from p_winner_team
     or existing_a is distinct from expected_a or existing_b is distinct from expected_b then raise exception 'match_replay_conflict'; end if;
   return game.id;
 end if;
 select s.season_id,s.played_on into season,session_day from public.sessions s join public.seasons se on se.id=s.season_id
   where s.id=p_session_id and s.group_id=p_group_id and se.group_id=p_group_id and se.ended_at is null;
 if not found then raise exception 'session_invalid'; end if;
 -- Validate the four players and capture the full day roster in ONE MVCC
 -- snapshot, so a concurrent checkout cannot remove them between these reads.
 select
   (select count(*) from public.players p join public.attendance a on a.player_id=p.id and a.session_id=p_session_id
     where p.id=any(p_team_a||p_team_b) and p.group_id=p_group_id and p.archived_at is null),
   (select array_agg(distinct a.player_id order by a.player_id)
     from public.attendance a join public.sessions s on s.id=a.session_id
     where s.group_id=p_group_id and s.season_id=season and s.played_on=session_day)
 into roster_count,roster;
 if roster_count<>4 or roster is null or not ((p_team_a||p_team_b)<@roster) then raise exception 'roster_invalid'; end if;
 insert into public.matches(client_id,session_id,group_id,court_no,mode,balance_weight,winner_team,started_at,ended_at,streak_roster)
 values(p_client_id,p_session_id,p_group_id,p_court_no,p_mode,p_balance_weight,p_winner_team,clock_timestamp(),clock_timestamp(),roster) returning * into game;
 insert into public.match_players(match_id,player_id,team)
 select game.id,id,1 from unnest(p_team_a) id union all select game.id,id,2 from unnest(p_team_b) id;
 -- Account order avoids cross-room deadlocks for shared wallets.
 for participant in select p.id,p.user_id,mp.team from public.match_players mp join public.players p on p.id=mp.player_id
   where mp.match_id=game.id and p.user_id is not null order by p.user_id loop
   streak:=0;
   if participant.team=p_winner_team then
     for history in select m.winner_team,mp.team,m.streak_roster from public.matches m join public.sessions s on s.id=m.session_id
       left join public.match_players mp on mp.match_id=m.id and mp.player_id=participant.id
       where m.group_id=p_group_id and s.season_id=season and m.ended_at is not null and m.winner_team is not null
       order by m.started_at desc,m.id desc loop
       -- A roster change resets everybody, including someone resting in that match.
       exit when history.streak_roster is distinct from roster;
       continue when history.team is null;
       exit when history.winner_team<>history.team;
       streak:=streak+1;
     end loop;
   end if;
   multiplier:=case when streak>=5 then 1.5 when streak=4 then 1.3 when streak=3 then 1.2 when streak=2 then 1.1 else 1 end;
   insert into public.cosmetic_wallets(user_id) values(participant.user_id) on conflict do nothing;
   perform 1 from public.cosmetic_wallets where user_id=participant.user_id for update;
   insert into public.daily_participation(user_id,rewarded_on) values(participant.user_id,(game.ended_at at time zone 'Asia/Bangkok')::date) on conflict do nothing;
   bonus:=case when found then 20 else 0 end;
   earned:=round(10*multiplier)::integer+bonus;
   roll:=random(); chest:=case when roll<0.80 then 'bronze' when roll<0.98 then 'silver' else 'gold' end;
   update public.cosmetic_wallets set coins=coins+earned,boxes=jsonb_set(boxes,array[chest],to_jsonb((boxes->>chest)::integer+1)) where user_id=participant.user_id;
   insert into public.match_rewards(match_id,user_id,player_id,coins,chest_tier,bonus,win_streak,multiplier)
     values(game.id,participant.user_id,participant.id,earned,chest,bonus,streak,multiplier);
 end loop;
 return game.id;
end $$;

create or replace function public.begin_match(
 p_client_id uuid,p_session_id uuid,p_group_id uuid,p_court_no smallint,p_mode public.queue_mode,
 p_balance_weight real,p_team_a uuid[],p_team_b uuid[]
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
 active public.active_court_matches%rowtype; booking public.session_courts%rowtype;
 expected_a uuid[]; expected_b uuid[]; began_at timestamptz; rotation text;
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
 if booking.retained_pair is not null and booking.retained_pair is distinct from expected_a and booking.retained_pair is distinct from expected_b then raise exception 'retained_pair_required'; end if;
 if exists(select 1 from public.session_courts c join public.sessions s on s.id=c.session_id
   where s.group_id=p_group_id and (c.session_id<>p_session_id or c.court_no<>p_court_no)
     and s.season_id=(select season_id from public.sessions where id=p_session_id)
     and (c.ends_at>clock_timestamp() or (c.ends_at is null and s.played_on=(select played_on from public.sessions where id=p_session_id)))
     and c.retained_pair&&(p_team_a||p_team_b)) then raise exception 'players_reserved'; end if;
 if (select count(*) from public.players p join public.attendance a on a.player_id=p.id and a.session_id=p_session_id
   where p.id=any(p_team_a||p_team_b) and p.group_id=p_group_id and p.archived_at is null)<>4 then raise exception 'roster_invalid'; end if;
 select rotation_mode into rotation from public.sessions where id=p_session_id;
 insert into public.active_court_matches(session_id,court_no,client_id,group_id,team_a,team_b,mode,balance_weight,started_at,rotation_mode)
 values(p_session_id,p_court_no,p_client_id,p_group_id,expected_a,expected_b,p_mode,p_balance_weight,began_at,rotation);
 update public.session_courts set retained_pair=null,retained_match_id=null where session_id=p_session_id and court_no=p_court_no;
 return began_at;
end $$;

create or replace function public.record_match(
 p_client_id uuid,p_session_id uuid,p_group_id uuid,p_court_no smallint,p_mode public.queue_mode,
 p_balance_weight real,p_winner_team smallint,p_team_a uuid[],p_team_b uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare active public.active_court_matches%rowtype; booking public.session_courts%rowtype; has_timer boolean; expected_a uuid[]; expected_b uuid[]; recorded uuid;
begin
 if auth.uid() is null or not public.can_manage_group(p_group_id) then raise exception 'room_forbidden'; end if;
 perform 1 from public.groups where id=p_group_id for update;
 -- A retry validates the original payload through the core, then returns
 -- without touching a newer retained pair or active match on this court.
 if exists(select 1 from public.matches where client_id=p_client_id) then
   return public.record_match_core(p_client_id,p_session_id,p_group_id,p_court_no,p_mode,p_balance_weight,p_winner_team,p_team_a,p_team_b);
 end if;
 select * into active from public.active_court_matches where client_id=p_client_id;
 has_timer:=found;
 if has_timer then
   select array_agg(id order by id) into expected_a from unnest(p_team_a) id;
   select array_agg(id order by id) into expected_b from unnest(p_team_b) id;
   if active.session_id is distinct from p_session_id or active.group_id is distinct from p_group_id
     or active.court_no is distinct from p_court_no or active.mode is distinct from p_mode
     or active.balance_weight is distinct from p_balance_weight
     or active.team_a is distinct from expected_a or active.team_b is distinct from expected_b then raise exception 'match_replay_conflict'; end if;
 else
   -- Old clients may only finish an existing, unconfigured legacy court.
   -- Configured bookings require a server-observed start; completed retries
   -- remain valid even if the court's booking changed afterwards.
   select * into booking from public.session_courts where session_id=p_session_id and court_no=p_court_no;
   if not found then raise exception 'court_invalid'; end if;
   if booking.starts_at is not null or booking.ends_at is not null or booking.retained_pair is not null
     or exists(select 1 from public.sessions where id=p_session_id and rotation_mode='winner_stays') then raise exception 'match_start_required'; end if;
   if exists(select 1 from public.active_court_matches where session_id=p_session_id and court_no=p_court_no) then raise exception 'court_busy'; end if;
   if exists(select 1 from public.active_court_matches a where a.group_id=p_group_id and (a.team_a||a.team_b)&&(p_team_a||p_team_b)) then raise exception 'players_busy'; end if;
   if exists(select 1 from public.session_courts c join public.sessions s on s.id=c.session_id
     where s.group_id=p_group_id
       and s.season_id=(select season_id from public.sessions where id=p_session_id)
       and (c.ends_at>clock_timestamp() or (c.ends_at is null and s.played_on=(select played_on from public.sessions where id=p_session_id)))
       and c.retained_pair&&(p_team_a||p_team_b)) then raise exception 'players_reserved'; end if;
 end if;
 recorded:=public.record_match_core(p_client_id,p_session_id,p_group_id,p_court_no,p_mode,p_balance_weight,p_winner_team,p_team_a,p_team_b);
 if has_timer then
   update public.matches set play_started_at=active.started_at,play_ended_at=ended_at,rotation_mode=active.rotation_mode where id=recorded and play_started_at is null;
   update public.session_courts set
     retained_pair=case when active.rotation_mode='winner_stays' and p_winner_team=1 then active.team_a
       when active.rotation_mode='winner_stays' and p_winner_team=2 then active.team_b else null end,
     retained_match_id=case when active.rotation_mode='winner_stays' and p_winner_team in (1,2) then recorded else null end
   where session_id=p_session_id and court_no=p_court_no;
   delete from public.active_court_matches where client_id=p_client_id;
 end if;
 return recorded;
end $$;

create or replace function public.get_player_durations(p_group_id uuid)
returns table(player_id uuid,average_minutes double precision,timed_games bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'room_forbidden'; end if;
 return query select mp.player_id,avg(extract(epoch from (m.play_ended_at-m.play_started_at))/60)::double precision,count(*)
 from public.matches m join public.match_players mp on mp.match_id=m.id
 where m.group_id=p_group_id and m.play_started_at is not null and m.play_ended_at>m.play_started_at
   and m.ended_at is not null and m.winner_team in (0,1,2)
 group by mp.player_id;
end $$;

create function public.get_pair_head_to_head(p_group_id uuid,p_team_a uuid[],p_team_b uuid[])
returns table(played bigint,team_a_wins bigint,team_b_wins bigint,draws bigint)
language plpgsql stable security definer set search_path = '' as $$
declare expected_a uuid[]; expected_b uuid[];
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'room_forbidden'; end if;
 if coalesce(cardinality(p_team_a),0)<>2 or coalesce(cardinality(p_team_b),0)<>2
   or (select count(distinct id) from unnest(p_team_a||p_team_b) id)<>4
   or (select count(*) from public.players where group_id=p_group_id and id=any(p_team_a||p_team_b))<>4 then raise exception 'pair_invalid'; end if;
 select array_agg(id order by id) into expected_a from unnest(p_team_a) id;
 select array_agg(id order by id) into expected_b from unnest(p_team_b) id;
 return query
 with pairs as (
   select m.id,m.winner_team,
     array_agg(mp.player_id order by mp.player_id) filter(where mp.team=1) as a,
     array_agg(mp.player_id order by mp.player_id) filter(where mp.team=2) as b
   from public.matches m join public.match_players mp on mp.match_id=m.id
   where m.group_id=p_group_id and m.ended_at is not null and m.winner_team in (0,1,2)
   group by m.id,m.winner_team having count(*)=4
 ), meetings as (
   select p.winner_team,(p.a=expected_a) as same_side from pairs p
   where (p.a=expected_a and p.b=expected_b) or (p.a=expected_b and p.b=expected_a)
 )
 select count(*),
   count(*) filter(where (same_side and winner_team=1) or (not same_side and winner_team=2)),
   count(*) filter(where (same_side and winner_team=2) or (not same_side and winner_team=1)),
   count(*) filter(where winner_team=0)
 from meetings;
end $$;

revoke all on function public.set_session_rotation(uuid,uuid,text),public.release_retained_pair(uuid,uuid,smallint,uuid),public.get_pair_head_to_head(uuid,uuid[],uuid[]) from public,anon;
grant execute on function public.set_session_rotation(uuid,uuid,text),public.release_retained_pair(uuid,uuid,smallint,uuid),public.get_pair_head_to_head(uuid,uuid[],uuid[]) to authenticated;
