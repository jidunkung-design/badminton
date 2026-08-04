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
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'owner@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated', '', '', '', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'member@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated', '', '', '', '', now(), now());

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
  ('22222222-2222-2222-2222-222222222222', 'สมาชิกทั่วไป', false)
on conflict (id) do update set
  display_name = excluded.display_name,
  is_super_admin = excluded.is_super_admin;
commit;
