-- Two auth users so ownership tests have somebody to fight over.
-- instance_id must be the default single-tenant instance or GoTrue's admin API
-- (auth.admin.listUsers, used by tests/db/schema.test.ts) will not see these rows.
-- The token columns must be '' rather than NULL: GoTrue's admin list-users query
-- scans them as non-nullable strings and returns a 500 if any is NULL.
insert into auth.users (
  instance_id, id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, aud, role,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at
)
-- realowner@example.com is deliberately NOT a super admin: Task 8's RLS
-- tests all signed in as owner@example.com (is_super_admin = true), so a
-- real, non-super group owner/admin was never actually exercised by any
-- test. This account owns its own group below and is used to prove the
-- non-super owner/admin/member paths work.
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'owner@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'member@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'realowner@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated', '', '', '', '', now(), now());

-- The handle_new_user trigger already inserted a default profiles row for
-- each auth user above. Upsert here to set the real seed display names and
-- the owner's is_super_admin flag; session_replication_role is set to
-- replica inside an explicit transaction so the profiles_block_super_admin_change
-- trigger (which rejects is_super_admin changes from normal callers) does
-- not fire during seeding.
begin;
set local session_replication_role = replica;
insert into profiles (id, display_name, is_super_admin) values
  ('11111111-1111-1111-1111-111111111111', 'เจ้าของระบบ', true),
  ('22222222-2222-2222-2222-222222222222', 'สมาชิกทั่วไป', false),
  ('55555555-5555-5555-5555-555555555555', 'เจ้าของก๊วนจริง', false)
on conflict (id) do update set
  display_name = excluded.display_name,
  is_super_admin = excluded.is_super_admin;
commit;

insert into groups (id, name, created_by) values
  ('33333333-3333-3333-3333-333333333333', 'ก๊วนบางแสน จันทร์และพฤหัส', '11111111-1111-1111-1111-111111111111');

insert into group_members (group_id, user_id, role) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'owner');

-- A second, small group owned by a genuine non-super account, so RLS tests
-- can exercise the owner/admin/member paths without ever touching
-- is_super_admin's short-circuit.
insert into groups (id, name, created_by) values
  ('66666666-6666-6666-6666-666666666666', 'ก๊วนเจ้าของจริง', '55555555-5555-5555-5555-555555555555');

insert into group_members (group_id, user_id, role) values
  ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', 'owner');

insert into players (group_id, name, skill) values
  ('66666666-6666-6666-6666-666666666666', 'ตัวอย่าง', 3);

insert into seasons (id, group_id, name) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'ซีซั่น 2569 ครึ่งปีแรก');

insert into players (group_id, name, skill) values
  ('33333333-3333-3333-3333-333333333333', 'บอส', 6),
  ('33333333-3333-3333-3333-333333333333', 'เอิร์ธ', 5),
  ('33333333-3333-3333-3333-333333333333', 'แนน', 5),
  ('33333333-3333-3333-3333-333333333333', 'ต้น', 4),
  ('33333333-3333-3333-3333-333333333333', 'มิ้นท์', 4),
  ('33333333-3333-3333-3333-333333333333', 'เจ', 4),
  ('33333333-3333-3333-3333-333333333333', 'ปอนด์', 3),
  ('33333333-3333-3333-3333-333333333333', 'ฟิล์ม', 3),
  ('33333333-3333-3333-3333-333333333333', 'กิ๊ก', 3),
  ('33333333-3333-3333-3333-333333333333', 'อาร์ม', 2);
