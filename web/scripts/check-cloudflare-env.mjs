import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

// OpenNext 1.20.6 embeds all three modes, not just the production values.
const envFiles = ['.env', '.env.local', ...['production', 'development', 'test'].flatMap(mode => [`.env.${mode}`, `.env.${mode}.local`])]
const publicNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']

function isPublicKey(value) {
  if (typeof value !== 'string' || !value) return false
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true
  try {
    const parts = value.split('.')
    return parts.length === 3 && parts.every(Boolean)
      && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'anon'
  } catch { return false }
}

function isLocalHost(host) {
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host === 'localhost.localdomain' || host === '::' || host === '::1'
    || /^f[cd][\da-f]*:|^fe[89ab][\da-f]*:/.test(host)) return true
  const mapped = host.match(/^::ffff:([\da-f]+):([\da-f]+)$/)
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16)
    return isLocalHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  const [a, b] = host.split('.').map(Number)
  return a === 0 || a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** Pure validation; errors contain variable/file names, never their values. */
export function validateCloudflareEnv(files = {}, environment = {}) {
  const errors = []
  const parsed = {}
  for (const name of envFiles) {
    if (files[name] === undefined) continue
    try { parsed[name] = parseEnv(files[name]) }
    catch { errors.push(`${name}: cannot parse environment file safely.`); continue }
    for (const key of Object.keys(parsed[name])) {
      if (!publicNames.includes(key)) errors.push(`${name}: ${key} must not be embedded in the Worker.`)
    }
    const key = parsed[name].NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (key && !isPublicKey(key)) errors.push(`${name}: NEXT_PUBLIC_SUPABASE_ANON_KEY must be a public anon/publishable key.`)
  }
  // Next production precedence: shell > production.local > local > production > base.
  const effective = Object.assign({}, parsed['.env'], parsed['.env.production'], parsed['.env.local'], parsed['.env.production.local'])
  for (const name of publicNames) if (environment[name] !== undefined) effective[name] = environment[name]
  try {
    const url = new URL(effective.NEXT_PUBLIC_SUPABASE_URL)
    if (url.protocol !== 'https:' || !url.hostname || isLocalHost(url.hostname) || url.username || url.password) throw new Error()
  } catch { errors.push('NEXT_PUBLIC_SUPABASE_URL must be a public HTTPS URL, not a local address or credential-bearing URL.') }
  if (!isPublicKey(effective.NEXT_PUBLIC_SUPABASE_ANON_KEY)) errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY must be a public anon/publishable key; secret/service-role keys are forbidden.')
  return errors
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appPath = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = {}
  try {
    for (const name of envFiles) {
      try { files[name] = readFileSync(join(appPath, name), 'utf8') }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot safely read the build environment files.') }
    }
    const errors = validateCloudflareEnv(files, process.env)
    if (errors.length) {
      for (const error of errors) console.error(error)
      console.error('Use a clean build directory with only the two public Supabase variables. Keep the original local development .env files unchanged; OpenNext embeds their values even when shell variables override them.')
      process.exitCode = 1
    } else console.log('Cloudflare environment preflight passed.')
  } catch {
    console.error('Cannot safely read the build environment. Use a clean build directory; keep local development files unchanged.')
    process.exitCode = 1
  }
}
