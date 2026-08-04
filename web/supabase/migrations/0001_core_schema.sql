create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Hard system cap. Application code must never be the only thing enforcing this.
create or replace function enforce_group_cap() returns trigger language plpgsql as $$
begin
  if (select count(*) from groups) >= 5 then
    raise exception 'group_cap: the system is limited to 5 groups';
  end if;
  return new;
end $$;

create trigger group_cap before insert on groups
  for each row execute function enforce_group_cap();

create type member_role as enum ('owner', 'admin', 'member');

create table group_members (
  group_id uuid not null references groups on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- One owner per group, and one owned group per person.
create unique index one_owner_per_group on group_members (group_id) where role = 'owner';
create unique index one_group_per_owner on group_members (user_id) where role = 'owner';

create table players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  name text not null,
  skill smallint not null default 3 check (skill between 1 and 7),
  user_id uuid references profiles(id),
  last_seen_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index players_by_group on players (group_id) where archived_at is null;
-- One account maps to at most one player row inside a group.
create unique index one_player_per_account_per_group
  on players (group_id, user_id) where user_id is not null;

create table seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  name text not null,
  started_at date not null default current_date,
  ended_at date
);

create unique index one_open_season_per_group on seasons (group_id) where ended_at is null;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  season_id uuid not null references seasons on delete restrict,
  played_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table attendance (
  session_id uuid not null references sessions on delete cascade,
  player_id uuid not null references players on delete restrict,
  primary key (session_id, player_id)
);

create type queue_mode as enum ('manual', 'fair', 'mix', 'balance');

-- Append only. Never deleted, never capped. Ratings are computed from this table.
create table matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  group_id uuid not null references groups on delete cascade,
  court_no smallint not null,
  mode queue_mode not null,
  balance_weight real not null default 0.5,
  winner_team smallint check (winner_team in (1, 2)),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  client_id uuid not null unique
);

create index matches_by_group_time on matches (group_id, started_at, id);

create table match_players (
  match_id uuid not null references matches on delete cascade,
  player_id uuid not null references players on delete restrict,
  team smallint not null check (team in (1, 2)),
  primary key (match_id, player_id)
);

-- Server-side access only for now: no RLS policies exist yet, so anon/authenticated
-- stay locked out. service_role (used by trusted server code, and by these tests)
-- needs explicit grants because Postgres privileges are independent of RLS, and the
-- default privileges for tables created by the migration role do not include them.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
