-- Stripe VIP Token purchase (real money, $1.99 AUD) -- a second acquisition
-- path for VIP Token alongside the existing Lucky Lad drop (see
-- 20260930120000_vip_token.sql). Delivered via Mail with a thank-you note
-- (requested by the user), not a direct characters.vip_token_count credit --
-- reuses claim_mail's existing 'vip_token' currency_type handling untouched.
--
-- Idempotency: stripe_purchases holds one 'pending' row per Checkout Session
-- (inserted by the stripe-checkout Edge Function before redirecting to
-- Stripe), keyed uniquely by stripe_session_id. Stripe delivers webhooks
-- at-least-once, so credit_stripe_purchase claims that row with a single
-- `update ... where status = 'pending' returning character_id` -- atomic,
-- and a no-op on any retry/duplicate delivery since the row is no longer
-- 'pending' the second time.
--
-- credit_stripe_purchase is deliberately NOT security definer and granted
-- only to service_role -- same "Edge-Function-triggered, service-role-only"
-- shape as resolve_combat_apply_results (see CLAUDE.md's cross-cutting
-- gotchas), since there's no auth.uid() in a Stripe webhook call for an
-- owner-check pattern to key off.
begin;

create table public.stripe_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.players(id),
  character_id uuid not null references public.characters(id),
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,
  product text not null default 'vip_token',
  amount_cents integer not null,
  currency text not null default 'aud',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

grant select, insert, update on public.stripe_purchases to service_role;
grant select on public.stripe_purchases to authenticated;

alter table public.stripe_purchases enable row level security;

create policy "players view their own stripe purchases" on public.stripe_purchases
  for select using (account_id = auth.uid());

-- 'purchase' already exists but is specifically Marketplace player-to-player
-- currency purchases (MarketplacePanel.tsx's own UI branch) -- 'stripe_purchase'
-- is a distinct reason so it doesn't collide with that display treatment.
-- Full current list per 20261113000000_zone_boss_rotation.sql (the latest
-- prior redefinition -- CLAUDE.md's stale-migration-ratios gotcha applies to
-- check constraints too, not just numeric ratios: always grep for the latest
-- drop/add of a constraint rather than trusting the first migration that
-- created it), plus 'stripe_purchase'.
alter table public.mail drop constraint if exists mail_reason_check;
alter table public.mail add constraint mail_reason_check
  check (reason in (
    'purchase', 'listing_cancelled', 'listing_expired', 'admin_gift', 'bug_report_reward',
    'suggestion_reward', 'world_boss_reward', 'zone_boss_reward', 'gold_donation_reward', 'sale_notification',
    'stripe_purchase'
  ));

create or replace function public.credit_stripe_purchase(p_stripe_session_id text, p_stripe_payment_intent_id text)
returns jsonb
language plpgsql
as $$
declare
  v_character_id uuid;
begin
  update public.stripe_purchases
  set status = 'completed', completed_at = now(), stripe_payment_intent_id = p_stripe_payment_intent_id
  where stripe_session_id = p_stripe_session_id and status = 'pending'
  returning character_id into v_character_id;

  if v_character_id is null then
    return jsonb_build_object('ok', true, 'already_processed', true);
  end if;

  insert into public.mail (character_id, currency_type, amount, reason, sender_label, subject, message)
  values (
    v_character_id,
    'vip_token',
    1,
    'stripe_purchase',
    'Jordan (Ascension Idle)',
    'Thank you! 💜',
    'Thank you so much for supporting Ascension Idle -- it genuinely means a lot. Here''s your VIP Token! -- Jordan'
  );

  return jsonb_build_object('ok', true, 'character_id', v_character_id, 'mailed', true);
end;
$$;

revoke all on function public.credit_stripe_purchase(text, text) from public;
grant execute on function public.credit_stripe_purchase(text, text) to service_role;

commit;
