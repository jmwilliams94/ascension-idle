-- World Boss / Gold Donation reward overhaul (2026-09-04, requested by the
-- user): both events' 1st/2nd/3rd/participation payouts switch from
-- gold+AP to Fallen Stars/Comet Box/Comet Scrolls/Lottery Tickets, and both
-- events now share the exact same reward amounts (previously Gold Donation
-- paid out larger gold amounts than World Boss). Gold/ascension_points rows
-- are dropped entirely, not kept alongside the new rewards.
--
-- ============================================================================
-- 1. mail: 'comet_box' becomes a new Mail currency_type (1st place reward).
--    Every other pre-existing branch of mail_currency_type_check/claim_mail
--    is untouched.
-- ============================================================================
alter table public.mail drop constraint if exists mail_currency_type_check;
alter table public.mail add constraint mail_currency_type_check
  check (currency_type in ('comet', 'fallen_star', 'comet_scroll', 'fallen_star_scroll', 'lottery_ticket', 'ascension_points', 'gold', 'comet_box'));

-- Same-signature create-or-replace on claim_mail (full body copied from
-- 20260826000000_add_world_boss.sql) — only the new 'comet_box' branch added.
create or replace function public.claim_mail(p_character_id uuid, p_mail_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_mail_character_id uuid;
  v_item_id uuid;
  v_currency_type text;
  v_amount integer;
  v_claimed_at timestamptz;
  v_new_count integer;
  v_new_claimed_at timestamptz;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select character_id, item_id, currency_type, amount, claimed_at
  into v_mail_character_id, v_item_id, v_currency_type, v_amount, v_claimed_at
  from public.mail where id = p_mail_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_mail_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_recipient');
  end if;

  if v_claimed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  v_amount := coalesce(v_amount, 1);

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + v_amount where id = p_character_id returning comet_count into v_new_count;
    elsif v_currency_type = 'fallen_star' then
      update public.characters set fallen_star_count = fallen_star_count + v_amount where id = p_character_id returning fallen_star_count into v_new_count;
    elsif v_currency_type = 'comet_scroll' then
      update public.characters set comet_scroll_count = comet_scroll_count + v_amount where id = p_character_id
      returning comet_scroll_count into v_new_count;
    elsif v_currency_type = 'fallen_star_scroll' then
      update public.characters set fallen_star_scroll_count = fallen_star_scroll_count + v_amount where id = p_character_id
      returning fallen_star_scroll_count into v_new_count;
    elsif v_currency_type = 'comet_box' then
      update public.characters set comet_box_count = comet_box_count + v_amount where id = p_character_id
      returning comet_box_count into v_new_count;
    elsif v_currency_type = 'lottery_ticket' then
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_amount where id = p_character_id
      returning lottery_ticket_count into v_new_count;
    elsif v_currency_type = 'gold' then
      update public.characters set gold = gold + v_amount where id = p_character_id returning gold into v_new_count;
    else -- 'ascension_points' -- account-wide, not a characters column
      update public.players set ascension_points = ascension_points + v_amount where id = v_account_id
      returning ascension_points into v_new_count;
    end if;

    update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

    return jsonb_build_object(
      'ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count, 'claimed_at', v_new_claimed_at
    );
  end if;

  update public.mail set claimed_at = now() where id = p_mail_id returning claimed_at into v_new_claimed_at;

  return jsonb_build_object('ok', true, 'item_id', v_item_id, 'claimed_at', v_new_claimed_at);
end;
$$;

-- ============================================================================
-- 2. world_boss_reward_for_tier — new reward table, same swap-via-
--    create-or-replace mechanism, zero schema change.
-- ============================================================================
create or replace function public.world_boss_reward_for_tier(p_tier text)
returns table (currency_type text, amount integer)
language sql
stable
as $$
  select t.currency_type, t.amount from (values
    ('participation', 'lottery_ticket', 1),
    ('third', 'fallen_star', 1),
    ('third', 'comet_scroll', 1),
    ('third', 'lottery_ticket', 4),
    ('second', 'fallen_star', 2),
    ('second', 'comet_scroll', 2),
    ('second', 'lottery_ticket', 7),
    ('first', 'fallen_star', 3),
    ('first', 'comet_box', 1),
    ('first', 'lottery_ticket', 10)
  ) as t(tier, currency_type, amount)
  where t.tier = p_tier;
$$;

revoke all on function public.world_boss_reward_for_tier(text) from public;

-- ============================================================================
-- 3. gold_donation_reward_for_tier — same new reward table as World Boss
--    (previously smaller gold-only amounts; both events now pay identically).
-- ============================================================================
create or replace function public.gold_donation_reward_for_tier(p_tier text)
returns table (currency_type text, amount integer)
language sql
stable
as $$
  select t.currency_type, t.amount from (values
    ('participation', 'lottery_ticket', 1),
    ('third', 'fallen_star', 1),
    ('third', 'comet_scroll', 1),
    ('third', 'lottery_ticket', 4),
    ('second', 'fallen_star', 2),
    ('second', 'comet_scroll', 2),
    ('second', 'lottery_ticket', 7),
    ('first', 'fallen_star', 3),
    ('first', 'comet_box', 1),
    ('first', 'lottery_ticket', 10)
  ) as t(tier, currency_type, amount)
  where t.tier = p_tier;
$$;

revoke all on function public.gold_donation_reward_for_tier(text) from public;
