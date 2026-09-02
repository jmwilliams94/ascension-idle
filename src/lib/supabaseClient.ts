import { createClient } from '@supabase/supabase-js'
import { createStaleClientAwareFetch } from './staleClientFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your project values.',
  )
}

// Custom fetch (2026-09-02) — lets staleClientFetch.ts inspect every
// PostgREST response for the "this RPC doesn't exist against the current
// schema" error shape (a stale client bundle still calling an old function
// signature after a `drop function` deploy) without touching every one of
// this project's many individual .rpc()/.from() call sites. See
// useStaleClientStore.ts for what happens once one's detected.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createStaleClientAwareFetch(fetch) },
})
