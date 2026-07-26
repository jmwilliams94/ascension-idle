import { readFileSync } from 'node:fs'

function loadEnv(path = '.env') {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return env
}

const env = loadEnv()
const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

// /auth/v1/settings is a public, table-free endpoint on the same project gateway as
// the database REST API, so a 200 here confirms the URL + key pair is valid and the
// project is reachable without needing any tables to exist yet.
const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
  headers: {
    apikey: supabaseAnonKey,
  },
})

if (!response.ok) {
  console.error(`Supabase project returned ${response.status} ${response.statusText}`)
  process.exitCode = 1
} else {
  console.log(`Supabase project reachable at ${supabaseUrl} (status ${response.status})`)
}
