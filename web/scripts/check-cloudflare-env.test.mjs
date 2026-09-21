import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCloudflareEnv } from './check-cloudflare-env.mjs'

const url = 'https://example-project.supabase.co'
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
const environment = { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') }

test('accepts clean shell credentials and ignores examples the adapter never loads', () => {
  assert.deepEqual(validateCloudflareEnv({ '.env.local.example': 'SUPABASE_SERVICE_ROLE_KEY=example' }, environment), [])
  assert.deepEqual(validateCloudflareEnv({}, { ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_public-key' }), [])
})

test('uses production file precedence, with shell values taking priority', () => {
  const files = {
    '.env': `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${jwt('anon')}`,
    '.env.production': 'NEXT_PUBLIC_SUPABASE_URL=https://production.supabase.co',
    '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
    '.env.production.local': `NEXT_PUBLIC_SUPABASE_URL=${url}`,
  }
  assert.deepEqual(validateCloudflareEnv(files), [])
  delete files['.env.production.local']
  assert.ok(validateCloudflareEnv(files).length)
  assert.deepEqual(validateCloudflareEnv(files, environment), [])
})

test('rejects private variables in every env mode even when the shell overrides them', () => {
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local']) {
    const result = validateCloudflareEnv({ [name]: 'SUPABASE_SERVICE_ROLE_KEY=do-not-print-this' }, environment)
    assert.ok(result.length, name)
    assert.ok(result.join(' ').includes(name))
    assert.ok(!result.join(' ').includes('do-not-print-this'))
  }
  assert.ok(validateCloudflareEnv({ '.env': 'CLOUDFLARE_API_TOKEN=private' }, environment).length)
})

test('rejects secret keys disguised as public keys, including unused env modes', () => {
  for (const key of ['sb_secret_private-value', jwt('service_role')]) {
    const result = validateCloudflareEnv({}, { ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: key })
    assert.ok(result.length)
    assert.ok(!result.join(' ').includes(key))
    assert.ok(validateCloudflareEnv({ '.env.test': `NEXT_PUBLIC_SUPABASE_ANON_KEY=${key}` }, environment).length)
  }
})

test('rejects missing, malformed, non-HTTPS and local production configuration', () => {
  assert.ok(validateCloudflareEnv({}).length)
  assert.ok(validateCloudflareEnv({}, { ...environment, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }).length)
  for (const value of ['not-a-url', 'http://example-project.supabase.co', 'https://localhost', 'https://app.localhost', 'https://127.0.0.1', 'https://127.1', 'https://0.0.0.0', 'https://[::1]', 'https://192.168.1.2', 'https://10.0.0.1', 'https://user:private@example-project.supabase.co']) {
    const result = validateCloudflareEnv({}, { ...environment, NEXT_PUBLIC_SUPABASE_URL: value })
    assert.ok(result.length, value)
    assert.ok(!result.join(' ').includes(value))
  }
})
