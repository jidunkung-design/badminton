-- Snapshot the whole checked-in day roster, not only the four match players.
-- Legacy rows remain unknown; never reconstruct history from mutable attendance.
alter table public.matches add column streak_roster uuid[];

-- Virtual cosmetics only: account-wide inventory; ratings and win streaks remain room/season scoped.
create table public.cosmetic_catalog (
  id text primary key,
  name text not null,
  category text not null check (category in ('head','outfit','shoes','racket','background')),
  rarity text not null check (rarity in ('common','rare','epic','legendary')),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  price integer not null check (price > 0)
);
insert into public.cosmetic_catalog
select c.category || '-' || r.rarity, c.name || ' ' || r.name, c.category, r.rarity, r.color, r.price
from (values ('head','หมวก'),('outfit','ชุดกีฬา'),('shoes','รองเท้า'),('racket','ไม้แบด'),('background','พื้นหลัง')) c(category,name)
cross join (values ('common','คลาสสิก','#557A68',50),('rare','สกาย','#4D81BA',150),('epic','ออร์คิด','#9564AA',400),('legendary','แชมเปียน','#C3973B',1000)) r(rarity,name,color,price);

create table public.chest_catalog (
  id text primary key check (id in ('bronze','silver','gold')),
  name text not null,
  price integer not null check (price > 0),
  odds jsonb not null
);
insert into public.chest_catalog values
 ('bronze','Bronze',30,'{"common":70,"rare":25,"epic":5,"legendary":0}'),
 ('silver','Silver',100,'{"common":30,"rare":50,"epic":18,"legendary":2}'),
 ('gold','Gold',300,'{"common":0,"rare":35,"epic":50,"legendary":15}');

create table public.cosmetic_wallets (
  user_id uuid primary key references public.profiles on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  skin text not null default 'warm' check (skin in ('warm','light','deep')),
  hair text not null default 'short' check (hair in ('short','bob','spiky')),
  equipped jsonb not null default '{}',
  owned text[] not null default '{}',
  boxes jsonb not null default '{"bronze":0,"silver":0,"gold":0}'
);
create table public.cosmetic_operations (
  user_id uuid not null references public.profiles on delete cascade,
  request_id uuid not null,
  kind text not null,
  target text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id,request_id)
);
create table public.match_rewards (
  match_id uuid not null references public.matches on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  player_id uuid not null references public.players,
  coins integer not null,
  chest_tier text not null references public.chest_catalog,
  bonus integer not null,
  win_streak integer not null,
  multiplier numeric not null,
  primary key (match_id,user_id)
);
create table public.daily_participation (
  user_id uuid not null references public.profiles on delete cascade,
  rewarded_on date not null,
  primary key(user_id,rewarded_on)
);

alter table public.cosmetic_catalog enable row level security;
alter table public.chest_catalog enable row level security;
alter table public.cosmetic_wallets enable row level security;
alter table public.cosmetic_operations enable row level security;
alter table public.match_rewards enable row level security;
alter table public.daily_participation enable row level security;
revoke all on public.cosmetic_catalog,public.chest_catalog,public.cosmetic_wallets,public.cosmetic_operations,public.match_rewards,public.daily_participation from public,anon,authenticated;

create function public.get_my_locker() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'auth_required'; end if;
  insert into public.cosmetic_wallets(user_id) values(uid) on conflict do nothing;
  select jsonb_build_object('coins',w.coins,'skin',w.skin,'hair',w.hair,'equipped',w.equipped,'owned',w.owned,'boxes',w.boxes,
    'catalog',(select jsonb_agg(to_jsonb(c) order by c.category,c.price) from public.cosmetic_catalog c),
    'chestCatalog',(select jsonb_agg(to_jsonb(c) order by c.price) from public.chest_catalog c))
  into result from public.cosmetic_wallets w where user_id=uid;
  return result;
end $$;

-- One locked wallet serializes spend/open/save and makes retries return their original outcome.
create function public.cosmetic_operation(p_kind text,p_target text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 uid uuid := auth.uid(); wallet public.cosmetic_wallets%rowtype; previous public.cosmetic_operations%rowtype;
 item public.cosmetic_catalog%rowtype; chest public.chest_catalog%rowtype; result jsonb;
 roll numeric; v_rarity text; refund integer := 0; duplicate boolean := false;
begin
 if uid is null then raise exception 'auth_required'; end if;
 if p_request_id is null or p_target is null or p_kind is null or p_kind not in ('buy_item','buy_chest','open_chest') then raise exception 'operation_invalid'; end if;
 insert into public.cosmetic_wallets(user_id) values(uid) on conflict do nothing;
 select * into wallet from public.cosmetic_wallets where user_id=uid for update;
 select * into previous from public.cosmetic_operations where user_id=uid and request_id=p_request_id;
 if found then
   if previous.kind<>p_kind or previous.target<>p_target then raise exception 'request_conflict'; end if;
   return previous.result;
 end if;
 if p_kind='buy_item' then
   select * into item from public.cosmetic_catalog where id=p_target;
   if not found then raise exception 'item_invalid'; end if;
   if item.id=any(wallet.owned) then raise exception 'item_owned'; end if;
   if wallet.coins<item.price then raise exception 'insufficient_coins'; end if;
   update public.cosmetic_wallets set coins=coins-item.price,owned=array_append(owned,item.id) where user_id=uid;
   result:=jsonb_build_object('item',to_jsonb(item));
 else
   select * into chest from public.chest_catalog where id=p_target;
   if not found then raise exception 'chest_invalid'; end if;
   if p_kind='buy_chest' then
     if wallet.coins<chest.price then raise exception 'insufficient_coins'; end if;
     update public.cosmetic_wallets set coins=coins-chest.price,
       boxes=jsonb_set(boxes,array[p_target],to_jsonb((boxes->>p_target)::integer+1)) where user_id=uid;
     result:=jsonb_build_object('tier',p_target);
   else
     if (wallet.boxes->>p_target)::integer<1 then raise exception 'chest_empty'; end if;
     roll:=random()*100;
     v_rarity:=case when roll<(chest.odds->>'common')::integer then 'common'
       when roll<(chest.odds->>'common')::integer+(chest.odds->>'rare')::integer then 'rare'
       when roll<100-(chest.odds->>'legendary')::integer then 'epic' else 'legendary' end;
     select * into item from public.cosmetic_catalog c where c.rarity=v_rarity order by random() limit 1;
     duplicate:=item.id=any(wallet.owned);
     if duplicate then refund:=case item.rarity when 'common' then 5 when 'rare' then 15 when 'epic' then 40 else 100 end; end if;
     update public.cosmetic_wallets set coins=coins+refund,
       owned=case when duplicate then owned else array_append(owned,item.id) end,
       boxes=jsonb_set(boxes,array[p_target],to_jsonb((boxes->>p_target)::integer-1)) where user_id=uid;
     result:=jsonb_build_object('item',to_jsonb(item),'duplicate',duplicate,'refund',refund);
   end if;
 end if;
 insert into public.cosmetic_operations(user_id,request_id,kind,target,result) values(uid,p_request_id,p_kind,p_target,result);
 return result;
end $$;
-- Internal helper is not a public RPC; wrappers expose only supported operations.
revoke all on function public.cosmetic_operation(text,text,uuid) from public,anon,authenticated;
create function public.buy_cosmetic(p_item_id text,p_request_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select public.cosmetic_operation('buy_item',p_item_id,p_request_id) $$;
create function public.buy_chest(p_tier text,p_request_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select public.cosmetic_operation('buy_chest',p_tier,p_request_id) $$;
create function public.open_chest(p_tier text,p_request_id uuid) returns jsonb
language sql security definer set search_path = '' as $$ select public.cosmetic_operation('open_chest',p_tier,p_request_id) $$;

create function public.save_mascot(p_skin text,p_hair text,p_equipped jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); wallet public.cosmetic_wallets%rowtype;
begin
 if uid is null then raise exception 'auth_required'; end if;
 if p_skin is null or p_skin not in ('warm','light','deep') or p_hair is null or p_hair not in ('short','bob','spiky')
   or p_equipped is null or jsonb_typeof(p_equipped)<>'object' then raise exception 'mascot_invalid'; end if;
 insert into public.cosmetic_wallets(user_id) values(uid) on conflict do nothing;
 select * into wallet from public.cosmetic_wallets where user_id=uid for update;
 if exists(select 1 from jsonb_each_text(p_equipped) e where not exists(
   select 1 from public.cosmetic_catalog c where c.id=e.value and c.category=e.key and c.id=any(wallet.owned))) then
   raise exception 'equipment_not_owned';
 end if;
 update public.cosmetic_wallets set skin=p_skin,hair=p_hair,equipped=p_equipped where user_id=uid;
end $$;

create function public.group_mascots(p_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'room_forbidden'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('player_id',p.id,'skin',coalesce(w.skin,'warm'),'hair',coalesce(w.hair,'short'),
   'equipment',coalesce((select jsonb_object_agg(c.category,jsonb_build_object('id',c.id,'color',c.color,'rarity',c.rarity))
     from public.cosmetic_catalog c where w.equipped->>c.category=c.id),'{}'::jsonb)))
   from public.players p left join public.cosmetic_wallets w on w.user_id=p.user_id where p.group_id=p_group_id),'[]'::jsonb);
end $$;

create function public.get_match_rewards(p_match_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.matches m where m.id=p_match_id and public.is_group_member(m.group_id)) then
   raise exception 'room_forbidden';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('player_id',r.player_id,'coins',r.coins,'chest_tier',r.chest_tier,
   'bonus',r.bonus,'win_streak',r.win_streak,'multiplier',r.multiplier)) from public.match_rewards r where r.match_id=p_match_id),'[]'::jsonb);
end $$;

create or replace function public.record_match(
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
   or p_winner_team is null or p_winner_team not in (1,2)
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

-- Every completed match must pass the same validation and award transaction.
revoke insert,update,delete on public.matches,public.match_players from authenticated;
-- Moving a recorded session between seasons would rewrite streak history.
revoke update on public.sessions from authenticated;
revoke all on function public.record_match(uuid,uuid,uuid,smallint,public.queue_mode,real,smallint,uuid[],uuid[]) from public,anon;
grant execute on function public.record_match(uuid,uuid,uuid,smallint,public.queue_mode,real,smallint,uuid[],uuid[]) to authenticated;
revoke all on function public.get_my_locker(),public.buy_cosmetic(text,uuid),public.buy_chest(text,uuid),public.open_chest(text,uuid),public.save_mascot(text,text,jsonb),public.group_mascots(uuid),public.get_match_rewards(uuid) from public,anon;
grant execute on function public.get_my_locker(),public.buy_cosmetic(text,uuid),public.buy_chest(text,uuid),public.open_chest(text,uuid),public.save_mascot(text,text,jsonb),public.group_mascots(uuid),public.get_match_rewards(uuid) to authenticated;
