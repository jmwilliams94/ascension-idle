// Push notification groundwork (2026-08-28) — see CLAUDE.pwa-and-mobile.md's
// Push Notifications section. Sends a Web Push message to every subscription
// on file for one or more accounts. Two callers:
// - Settings > Notifications' "Send test notification" button: self-service,
//   a real logged-in player's own session JWT, may only target their own
//   account_id (validated below).
// - notify_lucky_ticket_ready() (supabase/migrations, the first real
//   server-triggered event): privileged, identified by the X-Cron-Secret
//   header matching CRON_PUSH_SECRET (stored in Supabase Vault, read by that
//   Postgres function via pg_net — see that migration's own comments for why
//   the secret itself is never committed to a migration file), may target a
//   batch of account_ids with no per-caller ownership check since the caller
//   already decided who's eligible.
// Deployed with --no-verify-jwt so the privileged path's X-Cron-Secret-only
// request (no real Supabase-signed JWT) reaches this code at all; the
// self-service path's actual enforcement was always this function's own
// getUser()+ownership check below, not the platform gateway.
//
// No supabase/functions/_shared/ folder exists in this project — every Edge
// Function is fully self-contained, same convention world-boss-attack/
// index.ts documents.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Same reasoning as resolve-combat/index.ts — explicitly set via
// `supabase secrets set SERVICE_ROLE_KEY=...` rather than relying on the
// auto-injected SUPABASE_SERVICE_ROLE_KEY, which may not be the currently-
// active key on this project's newer publishable/secret API key system.
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!
const CRON_PUSH_SECRET = Deno.env.get('CRON_PUSH_SECRET')

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

interface SendPushBody {
  account_id?: string
  account_ids?: string[]
  title?: string
  body?: string
  url?: string
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh_key: string
  auth_key: string
}

async function handleSendPush(req: Request): Promise<Response> {
  let payload: SendPushBody
  try {
    payload = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const cronSecretHeader = req.headers.get('X-Cron-Secret')
  const isPrivileged = CRON_PUSH_SECRET !== undefined && cronSecretHeader === CRON_PUSH_SECRET

  let accountIds: string[]

  if (isPrivileged) {
    if (!payload.account_ids || payload.account_ids.length === 0) {
      return json({ ok: false, error: 'missing_account_ids' }, 400)
    }
    accountIds = payload.account_ids
  } else {
    // Self-service path -- a caller may only send to their own account.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ ok: false, error: 'not_authenticated' }, 401)
    }
    if (!payload.account_id) {
      return json({ ok: false, error: 'missing_account_id' }, 400)
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: authError,
    } = await callerClient.auth.getUser()

    if (authError || !user) {
      return json({ ok: false, error: 'not_authenticated' }, 401)
    }
    if (user.id !== payload.account_id) {
      return json({ ok: false, error: 'not_owner' }, 403)
    }
    accountIds = [payload.account_id]
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: subscriptions, error: fetchError } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .in('account_id', accountIds)

  if (fetchError) {
    console.error('push_subscriptions fetch failed', fetchError)
    return json({ ok: false, error: 'fetch_failed' }, 500)
  }
  if (!subscriptions || subscriptions.length === 0) {
    return json({ ok: false, error: 'no_subscriptions' }, 404)
  }

  // Not 'Ascension Idle' -- see src/sw.ts's own fallback for why.
  const notificationPayload = JSON.stringify({
    title: payload.title ?? 'Notification',
    body: payload.body ?? '',
    url: payload.url ?? '/',
  })

  const staleIds: string[] = []
  const failures: { statusCode?: number; message: string }[] = []
  let sent = 0

  await Promise.all(
    (subscriptions as SubscriptionRow[]).map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh_key, auth: row.auth_key } },
          notificationPayload,
        )
        sent += 1
      } catch (err) {
        // 404/410 = the push service says this subscription is gone for
        // good (browser uninstalled, permission revoked, etc.) — anything
        // else (network blip, 429 rate limit) is left alone to retry on the
        // next send rather than deleted on a transient failure.
        const statusCode = (err as { statusCode?: number }).statusCode
        const message = err instanceof Error ? err.message : String(err)
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(row.id)
        } else {
          console.error('sendNotification failed', row.id, statusCode, message)
        }
        // Surfaced in the response (not just console.error) since this
        // project has no way to tail Edge Function logs from the CLI used
        // to deploy it -- the caller needs to be able to see why without
        // dashboard access.
        failures.push({ statusCode, message })
      }
    }),
  )

  if (staleIds.length > 0) {
    await db.from('push_subscriptions').delete().in('id', staleIds)
  }

  // ok reflects whether anything actually sent, not just "the function ran
  // without throwing" — a caller with only dead/erroring subscriptions
  // should see a failure, not a false "Sent!".
  return json({ ok: sent > 0, sent, pruned: staleIds.length, failures })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    return await handleSendPush(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('send-push unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})
