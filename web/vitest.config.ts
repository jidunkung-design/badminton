import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

// Populate process.env from .env.local before tests run. `dotenv/config`
// (used by tests/db/schema.test.ts) only reads `.env` by default, but the
// Supabase local keys live in `.env.local` per the project convention.
loadEnv({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
