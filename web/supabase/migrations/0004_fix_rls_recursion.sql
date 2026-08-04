-- Root cause, in two parts (both fixed below): is_group_member(gid) is
-- SECURITY DEFINER, but it queries group_members -- the very table the
-- members_read policy (which calls is_group_member) protects. SECURITY
-- DEFINER changes the role used for
-- privilege checks, but it does NOT by itself stop row-level security from
-- being applied inside the function body: the row_security session setting
-- stays 'on' unless a function explicitly turns it off. So evaluating
-- is_group_member's internal "select ... from group_members" re-triggers
-- members_read's USING clause (is_group_member again) for every candidate
-- row, which queries group_members again, forever -- Postgres detects this
-- and raises "infinite recursion detected in policy for relation
-- group_members".
--
-- This was invisible in Task 8's tests because every one of them signed in
-- as owner@example.com, whose profile has is_super_admin = true. Postgres
-- evaluates is_group_member's "exists(...) or is_super_admin()" and, for a
-- super admin, short-circuits on is_super_admin() before it ever has to plan
-- the correlated exists() subquery against group_members, so the recursive
-- path was never exercised. Any real, non-super owner or admin hits it on
-- every query, per Postgres's own error, reproduced directly:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"22222222-...","role":"authenticated"}';
--   select count(*) from group_members;
--   ERROR:  infinite recursion detected in policy for relation "group_members"
--
-- Fix: explicitly disable row_security inside these three helper functions.
-- This is the standard, Postgres-documented way to let a SECURITY DEFINER
-- function see rows regardless of the caller's row-level security policies,
-- and is exactly what these helpers are for -- they exist specifically to be
-- called from inside other tables' policies. The function owner (whatever
-- role runs `supabase db reset`/migrations, here `postgres`) already created
-- these functions in 0002_rls.sql, so it already has ALTER/CREATE rights on
-- them; `set row_security = off` on a SECURITY DEFINER function requires
-- nothing beyond that -- confirmed by applying this migration and re-running
-- the reproduction above.
--
-- This does not reopen any isolation gap: row_security = off only affects
-- queries run *inside* these three functions' own bodies, which is exactly
-- the narrow "select 1 from group_members/profiles where ... and user_id =
-- auth.uid()" (or the role/super-admin check) that already existed. The
-- functions still filter by auth.uid() themselves; disabling row_security
-- just stops that internal filter from re-triggering the RLS policy that
-- calls the function. Every other table's policies, and the cross-tenancy
-- WITH CHECK clauses added by the earlier security review, are untouched.

create or replace function is_super_admin() returns boolean
  language sql stable security definer set search_path = public set row_security = off as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

create or replace function is_group_member(gid uuid) returns boolean
  language sql stable security definer set search_path = public set row_security = off as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid())
      or is_super_admin();
$$;

-- owner or admin
create or replace function can_manage_group(gid uuid) returns boolean
  language sql stable security definer set search_path = public set row_security = off as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role in ('owner', 'admin')
  ) or is_super_admin();
$$;

-- groups_update and members_write each had their own inline
-- "exists (select 1 from group_members ...)" subquery instead of going
-- through a helper function. Fixing only is_group_member/can_manage_group
-- above does not touch these: an inline subquery against group_members,
-- written directly in a policy, is just as subject to row_security as the
-- exists() clauses that used to live inside is_group_member -- and
-- members_write's subquery is on group_members from within a policy that
-- itself governs group_members, the same self-reference all over again
-- (confirmed by re-running the reproduction after only adding row_security
-- off to the three functions above: the recursion persisted). Consolidate
-- both into one more row_security=off helper, mirroring the "owner or super
-- admin" check both policies already expressed inline.
create or replace function is_group_owner(gid uuid) returns boolean
  language sql stable security definer set search_path = public set row_security = off as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid() and role = 'owner'
  ) or is_super_admin();
$$;

drop policy groups_update on groups;
create policy groups_update on groups for update using (is_group_owner(id));

drop policy members_write on group_members;
create policy members_write on group_members for all using (is_group_owner(group_id));
