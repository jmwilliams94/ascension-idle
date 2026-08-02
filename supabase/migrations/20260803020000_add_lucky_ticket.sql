-- Lucky ticket — Stage 1 (confirmed shape, see CLAUDE.md's Lucky section).
-- A free ticket every 6 hours, plus uncapped paid extra attempts at a flat
-- 20 Ascension Points each (confirmed with the user, 2026-08-03). Drawing
-- presents 9 face-down cards; the player picks one blind, it's revealed as
-- their reward, and the other 8 are then revealed as what they *would* have
-- been (informational only).
--
-- Security requirement, explicit from the user: rewards must never be
-- pre-generated and readable (DOM, or an earlier network response) before
-- the pick is made — that would let a client inspect which card is the
-- jackpot before choosing. draw_lucky_ticket is a single atomic call: the
-- player commits to a card index *blind*, and only after eligibility is
-- checked/paid and the whole 9-card board is rolled and the pick already
-- granted does the response reveal any of it. Nothing about the board ever
-- exists anywhere before that one already-irrevocable, already-paid-for
-- request — same ownership-check -> cost-check -> mutate -> return-jsonb
-- shape as every other RPC in this codebase (quality_upgrade,
-- unlock_next_achievement_tier, sell_item, etc.).
--
-- Reward pool is Stage-1 placeholder only, deliberately limited to content
-- that already exists as real items/currency (10 money-bag gold tiers, plus
-- Meteor/DragonBall/Meteor Scroll/DragonBall Scroll) — hyper-rare Radiant/
-- Ascended gear, the new drop-rate-buff consumable type, and Gems (not
-- implemented as real inventory items at all yet) are explicitly deferred to
-- a later stage per CLAUDE.md, not invented here. Weights below are placeholder
-- economy numbers, unresolved per CLAUDE.md like the rest of this game's
-- costs/odds — sum to exactly 100 for easy reasoning, not sourced from
-- anything.
begin;

alter table public.characters add column if not exists lucky_free_ticket_claimed_at timestamptz;

-- ============================================================================
-- pick_lucky_reward: one weighted roll from the Stage-1 placeholder pool.
-- No table access at all (pure random pick), so it needs no grants of its
-- own — draw_lucky_ticket (below) calls it internally under its own
-- SECURITY DEFINER context.
-- ============================================================================
create or replace function public.pick_lucky_reward()
returns jsonb
language plpgsql
as $$
declare
  v_roll numeric := random() * 100;
  v_cumulative numeric := 0;
  v_row record;
begin
  for v_row in
    select * from (values
      ('gold', 25, 30::numeric),
      ('gold', 50, 20::numeric),
      ('gold', 100, 15::numeric),
      ('gold', 200, 10::numeric),
      ('gold', 400, 7::numeric),
      ('gold', 750, 5::numeric),
      ('gold', 1500, 4::numeric),
      ('gold', 3000, 3::numeric),
      ('gold', 6000, 2::numeric),
      ('gold', 12000, 1.5::numeric),
      ('meteor', 1, 1.5::numeric),
      ('dragonball', 1, 0.7::numeric),
      ('meteor_scroll', 1, 0.25::numeric),
      ('dragonball_scroll', 1, 0.05::numeric)
    ) as t(kind, amount, weight)
  loop
    v_cumulative := v_cumulative + v_row.weight;
    if v_roll < v_cumulative then
      return jsonb_build_object('kind', v_row.kind, 'amount', v_row.amount);
    end if;
  end loop;

  -- Floating-point safety net only — weights above sum to exactly 100, this
  -- should never actually be reached.
  return jsonb_build_object('kind', 'gold', 'amount', 25);
end;
$$;

-- ============================================================================
-- draw_lucky_ticket: the whole draw in one call. See the file header for why
-- this must be atomic (eligibility -> roll -> grant -> reveal, in that
-- order, all before returning anything).
-- ============================================================================
create or replace function public.draw_lucky_ticket(p_character_id uuid, p_card_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_free_claimed_at timestamptz;
  v_gold integer;
  v_meteor_count integer;
  v_dragonball_count integer;
  v_meteor_scroll_count integer;
  v_dragonball_scroll_count integer;
  v_free_available boolean;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_board jsonb := '[]'::jsonb;
  v_won jsonb;
  v_kind text;
  v_amount integer;
  v_new_gold integer;
  v_new_meteor_count integer;
  v_new_dragonball_count integer;
  v_new_meteor_scroll_count integer;
  v_new_dragonball_scroll_count integer;
  v_next_free_at timestamptz;
  i integer;
begin
  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id, gold, meteor_count, dragonball_count, meteor_scroll_count, dragonball_scroll_count,
         lucky_free_ticket_claimed_at
  into v_account_id, v_gold, v_meteor_count, v_dragonball_count, v_meteor_scroll_count, v_dragonball_scroll_count,
       v_free_claimed_at
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_free_available := v_free_claimed_at is null or now() - v_free_claimed_at >= interval '6 hours';

  if v_free_available then
    v_payment := 'free';
  else
    v_payment := 'ascension_points';
    -- Same players-then-characters lock ordering as sell_item/
    -- create_marketplace_listing (characters already locked above) — avoids
    -- deadlocking against a concurrent call touching both rows the other way.
    select ascension_points into v_ap_balance from public.players where id = v_account_id for update;
    if v_ap_balance < 20 then
      v_next_free_at := v_free_claimed_at + interval '6 hours';
      return jsonb_build_object(
        'ok', false, 'error', 'not_enough_ap', 'cost', 20, 'ascension_points', v_ap_balance,
        'next_free_ticket_at', v_next_free_at
      );
    end if;
  end if;

  -- Roll the whole board now that eligibility is confirmed. Still nothing to
  -- read from outside this function — it's a local variable inside a single
  -- request that hasn't returned yet.
  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  v_won := v_board -> p_card_index;
  v_kind := v_won ->> 'kind';
  v_amount := (v_won ->> 'amount')::integer;

  if v_payment = 'ascension_points' then
    update public.players set ascension_points = ascension_points - 20 where id = v_account_id
    returning ascension_points into v_new_ap;
  else
    update public.characters set lucky_free_ticket_claimed_at = now() where id = p_character_id;
  end if;

  v_new_gold := v_gold;
  v_new_meteor_count := v_meteor_count;
  v_new_dragonball_count := v_dragonball_count;
  v_new_meteor_scroll_count := v_meteor_scroll_count;
  v_new_dragonball_scroll_count := v_dragonball_scroll_count;

  if v_kind = 'gold' then
    v_new_gold := v_gold + v_amount;
  elsif v_kind = 'meteor' then
    v_new_meteor_count := v_meteor_count + 1;
  elsif v_kind = 'dragonball' then
    v_new_dragonball_count := v_dragonball_count + 1;
  elsif v_kind = 'meteor_scroll' then
    v_new_meteor_scroll_count := v_meteor_scroll_count + 1;
  elsif v_kind = 'dragonball_scroll' then
    v_new_dragonball_scroll_count := v_dragonball_scroll_count + 1;
  end if;

  update public.characters
  set
    gold = v_new_gold,
    meteor_count = v_new_meteor_count,
    dragonball_count = v_new_dragonball_count,
    meteor_scroll_count = v_new_meteor_scroll_count,
    dragonball_scroll_count = v_new_dragonball_scroll_count
  where id = p_character_id;

  select lucky_free_ticket_claimed_at + interval '6 hours' into v_next_free_at
  from public.characters where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'won_index', p_card_index,
    'payment', v_payment,
    'cost', case when v_payment = 'ascension_points' then 20 else 0 end,
    'character', jsonb_build_object(
      'gold', v_new_gold,
      'meteor_count', v_new_meteor_count,
      'dragonball_count', v_new_dragonball_count,
      'meteor_scroll_count', v_new_meteor_scroll_count,
      'dragonball_scroll_count', v_new_dragonball_scroll_count
    ),
    'ascension_points', v_new_ap,
    'next_free_ticket_at', v_next_free_at
  );
end;
$$;

revoke all on function public.draw_lucky_ticket(uuid, integer) from public;
grant execute on function public.draw_lucky_ticket(uuid, integer) to authenticated;
revoke all on function public.pick_lucky_reward() from public;

commit;
