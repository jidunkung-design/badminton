# Cloudflare Workers + Supabase

Use Node.js 22 or newer and run project commands from `web/`. The Next.js application runs on Cloudflare
Workers through OpenNext; Supabase hosts authentication and PostgreSQL. The
current deployment uses dynamic routes and does not require an R2 cache bucket.

## 1. Choose the production data

For a fresh production project, apply the schema migrations without importing
local data. The first room creator becomes its owner; there are three room slots
for the entire application.

If local rooms, matches or cosmetics must be retained, agree on an identity and
ownership migration first. Local anonymous sessions cannot simply sign in to a
different Supabase project. Copying public tables alone does not preserve access
for their owners. Back up the source before a separately reviewed transfer.

**Do not load `supabase/seed.sql` into production.** It contains known-password
test accounts, including a super-admin, plus two example rooms. Do not run a
database reset or the database test suite against production.

## 2. Prepare hosted Supabase

1. Create or select the intended hosted project and verify its identity before
   applying anything. Use migrations `0001` through `0015` in order; include all
   migrations, not only the most recent file. For an existing project, inspect
   its migration history and backup first.
2. Verify that `pgcrypto` is installed in schema `extensions`. Room PIN functions
   call `extensions.crypt` and `extensions.gen_salt`; these migrations assume the
   extension already exists. This read-only query checks its location:

   ```sql
   select e.extname, n.nspname
   from pg_extension e
   join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';
   ```

   If absent, enable it in `extensions` before using the app. If installed in a
   different schema, resolve that mismatch before proceeding.
3. Enable **Anonymous Sign-Ins** in hosted Auth settings. The local
   `supabase/config.toml` does not apply those settings to the hosted project.
   Set Auth's Site URL to the production HTTPS origin, updating it if the final
   domain changes. Email, social login and SMTP are not needed for nickname entry.
4. Configure anonymous signup rate limits for the intended audience. The current
   login flow does not send a CAPTCHA token: enabling required CAPTCHA also
   requires implementing that token flow before entry will work.

Room PINs and owner approval protect admission. Anonymous accounts still depend
on the original browser session; nickname knowledge does not recover an account.

## 3. Configure and build the Worker

Install dependencies with `npm ci`. Configure the intended Cloudflare account
and review `wrangler.jsonc`. If changing the Worker name, also update its
`WORKER_SELF_REFERENCE` service to that name. Supply these values for both the
production build and the Worker runtime:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Hosted project's HTTPS API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Matching hosted project's public anon key |

Use a clean build directory without local development/test environment files.
OpenNext embeds environment files for all modes in its Worker artifact, including
variables the app never references. `deploy:cloudflare` runs a preflight check
that rejects private variables and local Supabase configuration before building.
Keep the original development environment untouched; do not remove its keys to
make deployment pass.

For a local production build in that clean directory, put the hosted values in the ignored
`.env.production.local`. Set the same values as Worker runtime variables in the
Cloudflare dashboard. `deploy:cloudflare` uses `--keep-vars` to preserve those
dashboard variables. Do not commit the environment file.

Do not reuse the local loopback URL. Public Next.js variables are embedded during
build, so changing only Worker runtime configuration is insufficient: rebuild
after changing projects. Keep the two environments consistent.

The application does not use `SUPABASE_SERVICE_ROLE_KEY`; do not deploy it.
It is needed by local database tests only. Keep authentication tokens and database
credentials out of source control, logs and this document.

```sh
npm run build:cloudflare
npm run preview:cloudflare
```

Both `preview:cloudflare` and `deploy:cloudflare` rebuild before their next step.
Any readiness build made with local Supabase values must not be published.

Preview runs the production Worker artifact. `/preview` is a development-only
demo and deliberately unavailable in production. For a smoke test, use a separate
staging Supabase project or an explicitly approved production room: login, room
creation and matches write persistent data.

## 4. Deploy and verify

After selecting the intended target and completing the checks above:

```sh
npm run deploy:cloudflare
```

Confirm the returned HTTPS URL and Auth Site URL match the intended deployment.
Check nickname entry, owner PIN and invite approval, booking/start/finish, and
refresh persistence using the agreed test data. Verify that a completed-match
retry does not issue duplicate rewards. Never use production credentials to run
`npm test`, which includes database fixtures.

Keep the previous Worker deployment available for application rollback. Database
changes require a separate reviewed migration or restore plan; do not reset the
database to roll back the frontend.
