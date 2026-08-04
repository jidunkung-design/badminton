import { defineConfig } from 'vitest/config'
import { BaseSequencer } from 'vitest/node'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

// Populate process.env from .env.local before tests run. `dotenv/config`
// (used by tests/db/schema.test.ts) only reads `.env` by default, but the
// Supabase local keys live in `.env.local` per the project convention.
loadEnv({ path: path.resolve(__dirname, '.env.local') })

// tests/db/schema.test.ts's "group cap" test intentionally fills the
// system-wide 5-group cap to prove the cap is enforced, then leaves the
// database at that cap. Every other tests/db/*.test.ts file also needs to
// insert its own group(s) in beforeAll. If schema.test.ts happens to run
// first, later files get blocked by the very cap schema.test.ts just proved
// works, and their setup fails with an unrelated null-data error. This is a
// pre-existing race (reproduced against an unmodified commit, independent of
// any single file's assertions) that fileParallelism alone does not fix,
// because file execution order is not otherwise guaranteed. Force
// schema.test.ts to sort last so every other db test file gets first pick of
// the shared 5-group budget.
class DbCapLastSequencer extends BaseSequencer {
  async sort(files: Parameters<BaseSequencer['sort']>[0]) {
    const sorted = await super.sort(files)
    const isSchemaTest = (f: (typeof sorted)[number]) => /tests[\\/]db[\\/]schema\.test\.ts$/.test(f.moduleId)
    return [...sorted].sort((a, b) => Number(isSchemaTest(a)) - Number(isSchemaTest(b)))
  }
}

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
    sequence: { sequencer: DbCapLastSequencer },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
