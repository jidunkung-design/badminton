import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

// Populate process.env from .env.local before tests run. `dotenv/config`
// (used by tests/db/schema.test.ts) only reads `.env` by default, but the
// Supabase local keys live in `.env.local` per the project convention.
loadEnv({ path: path.resolve(__dirname, '.env.local') })

// A final-whole-branch-review finding removed the DbCapLastSequencer that
// used to live here. It existed only to work around tests/db/schema.test.ts
// permanently filling the system-wide 5-group cap and never releasing it;
// every tests/db/*.test.ts file now creates and tears down its own group(s),
// so no file execution order is required for the shared 5-group budget
// anymore. Do not reintroduce order-dependent global state as a fix for a
// new test in this directory -- give the new file its own teardown instead.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // tests/db/*.test.ts share one local Postgres instance and mutate global
    // state (group_members rows, the 5-group cap). Running test files in
    // parallel workers races them against each other -- pre-existing and
    // unrelated to any single file's assertions, reproduced by running the
    // suite against an unmodified commit. Serialize file execution so the
    // db-backed suite is deterministic.
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
