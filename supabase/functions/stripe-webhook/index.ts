// Stripe webhook handler -- verifies the request actually came from Stripe
// (Stripe-Signature header, STRIPE_WEBHOOK_SECRET), then on a completed
// Checkout Session calls credit_stripe_purchase (migration
// 20261213000000_stripe_vip_token_purchase.sql), which atomically claims the
// matching stripe_purchases row and mails the VIP Token -- idempotent by
// design, since Stripe delivers webhooks at-least-once and can retry/duplicate.
//
// Deployed with --no-verify-jwt (same reason as send-push's privileged path):
// Stripe's POST carries no Supabase-issued JWT, only its own signature
// header -- the platform gateway's JWT check would reject every real
// delivery before this code ever ran. Signature verification below is the
// actual authentication for this endpoint.
//
// No supabase/functions/_shared/ folder exists in this project -- every Edge
// Function is fully self-contained, same convention every other function
// here documents.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@18'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function handleWebhook(req: Request): Promise<Response> {
  const signature = req.headers.get('Stripe-Signature')
  if (!signature) {
    return json({ ok: false, error: 'missing_signature' }, 400)
  }

  // Must read the raw body -- constructEventAsync verifies the signature
  // against these exact bytes, so JSON.parse-then-restringify would break it.
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('stripe-webhook signature verification failed', err)
    return json({ ok: false, error: 'invalid_signature' }, 400)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data, error } = await db.rpc('credit_stripe_purchase', {
      p_stripe_session_id: session.id,
      p_stripe_payment_intent_id: paymentIntentId,
    })

    if (error) {
      console.error('credit_stripe_purchase failed', error)
      // Non-2xx -- Stripe will retry, which is safe (credit_stripe_purchase
      // is idempotent).
      return json({ ok: false, error: 'credit_failed' }, 500)
    }

    console.log('credit_stripe_purchase result', data)
  }

  // 2xx for any recognized-or-ignored event type -- a non-2xx tells Stripe
  // to keep retrying, which we only want for genuine failures above.
  return json({ ok: true })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    return await handleWebhook(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('stripe-webhook unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})
