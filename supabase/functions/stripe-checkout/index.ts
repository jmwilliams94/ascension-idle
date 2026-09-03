// Creates a Stripe Checkout Session for a $1.99 AUD VIP Token purchase.
// Self-service, JWT-authenticated (same shape as send-push's self-service
// path) -- caller must own the character_id they're buying for. The token
// itself is never credited here: this only creates a 'pending' stripe_purchases
// row (idempotency anchor for the webhook, see stripe-webhook/index.ts and
// migration 20261213000000_stripe_vip_token_purchase.sql) and hands back a
// hosted Checkout URL for the client to redirect to.
//
// No supabase/functions/_shared/ folder exists in this project -- every Edge
// Function is fully self-contained, same convention send-push/index.ts and
// resolve-mining/index.ts document.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@18'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!

// Deno needs an explicit fetch-based HTTP client -- Stripe's Node SDK
// defaults to a Node-only client that isn't available in the Edge runtime.
const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })

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

interface CheckoutBody {
  character_id?: string
  success_url?: string
  cancel_url?: string
}

const VIP_TOKEN_PRICE_AUD_CENTS = 199

async function handleCheckout(req: Request): Promise<Response> {
  let payload: CheckoutBody
  try {
    payload = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (!payload.character_id || !payload.success_url || !payload.cancel_url) {
    return json({ ok: false, error: 'missing_fields' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
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

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: character, error: characterError } = await db
    .from('characters')
    .select('id, account_id')
    .eq('id', payload.character_id)
    .maybeSingle()

  if (characterError) {
    console.error('character lookup failed', characterError)
    return json({ ok: false, error: 'lookup_failed' }, 500)
  }
  if (!character || character.account_id !== user.id) {
    return json({ ok: false, error: 'not_owner' }, 403)
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'aud',
          unit_amount: VIP_TOKEN_PRICE_AUD_CENTS,
          product_data: { name: 'VIP Token' },
        },
        quantity: 1,
      },
    ],
    metadata: { character_id: payload.character_id, account_id: user.id },
    success_url: `${payload.success_url}${payload.success_url.includes('?') ? '&' : '?'}stripe=success`,
    cancel_url: `${payload.cancel_url}${payload.cancel_url.includes('?') ? '&' : '?'}stripe=cancelled`,
  })

  const { error: insertError } = await db.from('stripe_purchases').insert({
    account_id: user.id,
    character_id: payload.character_id,
    stripe_session_id: session.id,
    amount_cents: VIP_TOKEN_PRICE_AUD_CENTS,
    currency: 'aud',
    product: 'vip_token',
    status: 'pending',
  })

  if (insertError) {
    console.error('stripe_purchases insert failed', insertError)
    return json({ ok: false, error: 'purchase_record_failed' }, 500)
  }

  return json({ ok: true, url: session.url })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    return await handleCheckout(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('stripe-checkout unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})
