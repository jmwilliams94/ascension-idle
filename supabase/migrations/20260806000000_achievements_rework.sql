-- Achievements rework (confirmed with the user, 2026-08-06) — collapses the
-- old dual-track system (an always-on Kill Count multiplier + a paid
-- Prestige gold multiplier) into a single Kill Count ladder with real
-- one-time CLAIMS, and gives the previously-undesigned account-wide ladder
-- its own reward category (small permanent account-wide combat buffs).
--
-- Character track: same 6 kill thresholds (100/250/500/1000/5000/10000, see
-- ACHIEVEMENT_TIERS), but each tier is now a one-time Claim instead of an
-- always-on multiplier that quietly changes as your kill count climbs.
-- Tiers 1-5 grant a small Comet/Fallen Star bundle; tier 6 grants a real
-- Infused-quality gear piece, picked the same "random class-appropriate
-- family, nearest level to the monster" way a random kill-drop already is
-- (see pick_infused_reward_template below) — generalizes the old
-- Windhollow-only MONSTER_GEAR_REWARDS special case to every monster in the
-- game instead of 5 hand-picked ones.
--
-- Account track: same kill totals (summed across all 5 characters, unique
-- per monster), but thresholds are 5x the character ones (confirmed with
-- the user: "since we will have 5 character slots, I want the account
-- rewards to be 5x whatever the character requirement is"). Each claim adds
-- a small permanent account-wide buff to attack and drop chance
-- (players.account_attack_bonus_pct/account_drop_bonus_pct) — see
-- resolve-combat/index.ts for where these actually apply. The user's own
-- framing for why: "so the next time round when you go to level a
-- character and have to kill the low level mobs again, it's easier and
-- with better rewards" — a permanent, account-wide payoff for grinding a
-- monster once, rather than starting from zero on every new character.
--
-- Prestige (the paid, escalating-cost tier-unlock mechanic) is removed
-- entirely, not just renamed/hidden — unlock_next_achievement_tier is
-- dropped outright. character_monster_kills.unlocked_tier_index is
-- REPURPOSED (renamed to claimed_tier_index) rather than dropped and
-- re-added, since it already tracked "how many of the 6 tiers has this
-- character advanced through, in order" — exactly the shape the new claim
-- system needs, just earned by kills + a free claim instead of paid
-- currency.
--
-- All reward VALUES below are a deliberate placeholder, same
-- disclosed-not-final status as every other economy number in this game —
-- "have placeholder rewards for everything... nothing should be a crazy
-- high percentage buff, they should all be small slight increases," per the
-- user's own explicit instruction.
begin;

-- ============================================================================
-- 1. Schema changes.
-- ============================================================================
do $$ begin
  alter table public.character_monster_kills rename column unlocked_tier_index to claimed_tier_index;
exception when undefined_column then null;
end $$;

alter table public.account_monster_kills add column if not exists claimed_tier_index integer not null default 0;
do $$ begin
  alter table public.account_monster_kills
    add constraint account_monster_kills_claimed_tier_index_check check (claimed_tier_index between 0 and 6);
exception when duplicate_object then null;
end $$;

-- Permanent, account-wide, cumulative across every monster's own account-tier
-- claims — read directly by resolve-combat, no per-monster re-summing needed
-- at combat-resolution time.
alter table public.players add column if not exists account_attack_bonus_pct numeric not null default 0;
alter table public.players add column if not exists account_drop_bonus_pct numeric not null default 0;
do $$ begin
  alter table public.players add constraint players_account_attack_bonus_pct_check check (account_attack_bonus_pct >= 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.players add constraint players_account_drop_bonus_pct_check check (account_drop_bonus_pct >= 0);
exception when duplicate_object then null;
end $$;

-- Lottery Ticket (2026-08-06, confirmed with the user, added mid-design:
-- "create an item Lottery Ticket? Which can also be rewarded and is
-- consumed at the Lucky Lad") — a grantable item whose only use is an
-- alternative payment method for LuckyLad's draw, alongside the existing
-- free-every-6-hours ticket and the 20-Ascension-Point paid draw (see
-- draw_lucky_ticket's own update below). Modeled as a plain per-character
-- count, same shape Comets/Fallen Stars had before they became individual
-- Inventory tiles — simplest fit for something with exactly one purpose and
-- nowhere else in the game that needs to display or drag it.
alter table public.characters add column if not exists lottery_ticket_count integer not null default 0;
do $$ begin
  alter table public.characters add constraint characters_lottery_ticket_count_check check (lottery_ticket_count >= 0);
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 2. Prestige removed outright — confirmed dead, no client call left once
--    the achievements UI rework ships in the same commit.
-- ============================================================================
drop function if exists public.unlock_next_achievement_tier(uuid, text);

-- ============================================================================
-- 3. pick_infused_reward_template — shared helper for the character track's
--    tier-6 gear reward. Same "random class-appropriate family (excluding
--    sword/quiver/lucky-bow, the non-droppable standalone families), then
--    the template in that family closest to the monster's own level" shape
--    resolve-combat's own pickDropTemplate (and its client mirror in
--    useInventoryStore.ts) already use for random kill-drops — just
--    deterministic-once-per-claim instead of per-kill, and always Infused
--    quality regardless of the usual drop-quality odds.
-- ============================================================================
create or replace function public.pick_infused_reward_template(p_character_class text, p_monster_level integer)
returns uuid
language plpgsql
as $$
declare
  v_family text;
  v_template_id uuid;
begin
  select item_family into v_family
  from public.item_templates
  where (required_class is null or required_class = p_character_class)
    and item_family not in ('sword', 'quiver', 'lucky-bow')
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select id into v_template_id
  from public.item_templates
  where item_family = v_family
  order by abs(required_level - p_monster_level) asc
  limit 1;

  return v_template_id;
end;
$$;

revoke all on function public.pick_infused_reward_template(text, integer) from public;

-- ============================================================================
-- 4. claim_kill_count_reward — character track. Claims the NEXT tier in
--    sequence (the caller never picks which tier, only "claim the next
--    one," mirroring unlock_next_achievement_tier's own established shape)
--    for one character's kill count on one monster. Free (no currency cost)
--    — the "cost" is the kills themselves.
--
--    Tiers 1-5: a small Comet/Fallen Star bundle. Tier 6: one Infused gear
--    item via pick_infused_reward_template above, granted directly into
--    Inventory (no room check — see the comment inline; this mirrors
--    claim_loot_holding's own currency-claim branch, which also grants
--    unconditionally, on the theory that a deliberate, rare, one-time claim
--    the player explicitly triggered shouldn't silently fail on a full bag
--    the way a background kill-drop reasonably can).
-- ============================================================================
create or replace function public.claim_kill_count_reward(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_class text;
  v_kills integer;
  v_current_index integer;
  v_next_index integer;
  v_threshold integer;
  v_comets_granted integer := 0;
  v_fallen_stars_granted integer := 0;
  v_lottery_tickets_granted integer := 0;
  v_new_comets integer;
  v_new_fallen_stars integer;
  v_new_lottery_tickets integer;
  v_monster_level integer;
  v_template_id uuid;
  v_item jsonb;
begin
  select account_id, class into v_account_id, v_character_class
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select kills, claimed_tier_index into v_kills, v_current_index
  from public.character_monster_kills
  where character_id = p_character_id and monster_id = p_monster_id
  for update;

  if v_kills is null then
    return jsonb_build_object('ok', false, 'error', 'no_kills_yet');
  end if;

  v_current_index := coalesce(v_current_index, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  -- Tier thresholds: 100/250/500/1000/5000/10000 (ACHIEVEMENT_TIERS).
  v_threshold := case v_next_index
    when 1 then 100 when 2 then 250 when 3 then 500
    when 4 then 1000 when 5 then 5000 when 6 then 10000
  end;

  if v_kills < v_threshold then
    return jsonb_build_object('ok', false, 'error', 'not_reached', 'threshold', v_threshold, 'kills', v_kills);
  end if;

  if v_next_index = 6 then
    select level into v_monster_level from public.enemy_types where id = p_monster_id;
    v_template_id := public.pick_infused_reward_template(v_character_class, coalesce(v_monster_level, 1));

    if v_template_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_reward_available');
    end if;

    insert into public.item_instances (template_id, owner_id, quality_tier, level)
    select id, p_character_id, 'infused', required_level
    from public.item_templates
    where id = v_template_id
    returning to_jsonb(item_instances.*) into v_item;
  else
    -- PLACEHOLDER bundle, small on purpose (2026-08-06, confirmed with the
    -- user: "nothing should be a crazy high percentage buff, they should
    -- all be small slight increases"). Fallen Stars deliberately moved to
    -- tier 5 only ("Fallen stars as a reward should be extremely rare
    -- final tier kind of reward") — every earlier tier grants Comets
    -- and/or a Lottery Ticket instead, never Fallen Stars.
    case v_next_index
      when 1 then v_comets_granted := 2;
      when 2 then v_comets_granted := 3;
      when 3 then v_lottery_tickets_granted := 1;
      when 4 then v_comets_granted := 5; v_lottery_tickets_granted := 1;
      when 5 then v_fallen_stars_granted := 1;
    end case;

    if v_comets_granted > 0 then
      update public.characters set comet_count = comet_count + v_comets_granted where id = p_character_id
      returning comet_count into v_new_comets;
    end if;
    if v_fallen_stars_granted > 0 then
      update public.characters set fallen_star_count = fallen_star_count + v_fallen_stars_granted where id = p_character_id
      returning fallen_star_count into v_new_fallen_stars;
    end if;
    if v_lottery_tickets_granted > 0 then
      update public.characters set lottery_ticket_count = lottery_ticket_count + v_lottery_tickets_granted where id = p_character_id
      returning lottery_ticket_count into v_new_lottery_tickets;
    end if;
  end if;

  update public.character_monster_kills set claimed_tier_index = v_next_index
  where character_id = p_character_id and monster_id = p_monster_id;

  return jsonb_build_object(
    'ok', true,
    'claimed_tier_index', v_next_index,
    'comets_granted', v_comets_granted,
    'fallen_stars_granted', v_fallen_stars_granted,
    'lottery_tickets_granted', v_lottery_tickets_granted,
    'comets_remaining', v_new_comets,
    'fallen_stars_remaining', v_new_fallen_stars,
    'lottery_tickets_remaining', v_new_lottery_tickets,
    'item', v_item
  );
end;
$$;

revoke all on function public.claim_kill_count_reward(uuid, text) from public;
grant execute on function public.claim_kill_count_reward(uuid, text) to authenticated;

-- ============================================================================
-- 5. claim_account_achievement_reward — account track. Thresholds are 5x
--    the character track's own (100/250/500/1000/5000/10000 -> 500/1250/
--    2500/5000/25000/50000), matching 5 character slots. Reward is a small
--    permanent bump to players.account_attack_bonus_pct/
--    account_drop_bonus_pct, cumulative across every monster's own claims
--    (see resolve-combat/index.ts for where these actually apply to real
--    combat). No currency cost — same "the kills are the cost" shape as the
--    character track.
-- ============================================================================
create or replace function public.claim_account_achievement_reward(p_account_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kills integer;
  v_current_index integer;
  v_next_index integer;
  v_threshold integer;
  v_attack_bonus numeric;
  v_drop_bonus numeric;
  v_new_attack_bonus_pct numeric;
  v_new_drop_bonus_pct numeric;
begin
  if p_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select kills, claimed_tier_index into v_kills, v_current_index
  from public.account_monster_kills
  where account_id = p_account_id and monster_id = p_monster_id
  for update;

  if v_kills is null then
    return jsonb_build_object('ok', false, 'error', 'no_kills_yet');
  end if;

  v_current_index := coalesce(v_current_index, 0);
  v_next_index := v_current_index + 1;

  if v_next_index > 6 then
    return jsonb_build_object('ok', false, 'error', 'already_maxed');
  end if;

  -- 5x the character track's own thresholds.
  v_threshold := case v_next_index
    when 1 then 500 when 2 then 1250 when 3 then 2500
    when 4 then 5000 when 5 then 25000 when 6 then 50000
  end;

  if v_kills < v_threshold then
    return jsonb_build_object('ok', false, 'error', 'not_reached', 'threshold', v_threshold, 'kills', v_kills);
  end if;

  -- PLACEHOLDER per-tier increments, deliberately tiny per claim — summed
  -- across all 40 monsters at full completion this totals roughly +50%
  -- attack / +42% drop, a genuine long-term account-wide investment without
  -- any single claim ever being "a crazy high percentage buff."
  case v_next_index
    when 1 then v_attack_bonus := 0.05; v_drop_bonus := 0.05;
    when 2 then v_attack_bonus := 0.08; v_drop_bonus := 0.08;
    when 3 then v_attack_bonus := 0.12; v_drop_bonus := 0.12;
    when 4 then v_attack_bonus := 0.20; v_drop_bonus := 0.15;
    when 5 then v_attack_bonus := 0.30; v_drop_bonus := 0.25;
    when 6 then v_attack_bonus := 0.50; v_drop_bonus := 0.40;
  end case;

  update public.players
  set account_attack_bonus_pct = account_attack_bonus_pct + v_attack_bonus,
      account_drop_bonus_pct = account_drop_bonus_pct + v_drop_bonus
  where id = p_account_id
  returning account_attack_bonus_pct, account_drop_bonus_pct into v_new_attack_bonus_pct, v_new_drop_bonus_pct;

  update public.account_monster_kills set claimed_tier_index = v_next_index
  where account_id = p_account_id and monster_id = p_monster_id;

  return jsonb_build_object(
    'ok', true,
    'claimed_tier_index', v_next_index,
    'attack_bonus_gained', v_attack_bonus,
    'drop_bonus_gained', v_drop_bonus,
    'account_attack_bonus_pct', v_new_attack_bonus_pct,
    'account_drop_bonus_pct', v_new_drop_bonus_pct
  );
end;
$$;

revoke all on function public.claim_account_achievement_reward(uuid, text) from public;
grant execute on function public.claim_account_achievement_reward(uuid, text) to authenticated;

-- ============================================================================
-- 6. draw_lucky_ticket — extended with a third payment path (2026-08-06,
--    confirmed with the user: the new Lottery Ticket item, above, "is
--    consumed at the Lucky Lad"). p_use_ticket is a trailing defaulted
--    parameter, so every existing client call (no p_use_ticket argument)
--    keeps working unchanged, defaulting to the original free/AP behavior.
--    NOTE: a distinct (name, arg-types) signature is a genuinely separate
--    Postgres function, not a replacement — create or replace alone left
--    the old 2-arg version in place as a second overload, which PostgREST
--    then couldn't disambiguate for a plain 2-argument RPC call. The old
--    2-arg overload is dropped explicitly first so only the 3-arg version
--    (still callable with just 2 args, since the 3rd has a default) exists.
--    When p_use_ticket is true: requires lottery_ticket_count >= 1, spends
--    exactly one, and skips the free-ticket/Ascension-Point logic entirely
--    (does not touch lucky_free_ticket_claimed_at either way) — a ticket is
--    simply a third, independent way to pay for one draw.
-- ============================================================================
drop function if exists public.draw_lucky_ticket(uuid, integer);

create or replace function public.draw_lucky_ticket(p_character_id uuid, p_card_index integer, p_use_ticket boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_free_claimed_at timestamptz;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_lottery_ticket_count integer;
  v_free_available boolean;
  v_payment text;
  v_ap_balance integer;
  v_new_ap integer;
  v_board jsonb := '[]'::jsonb;
  v_won jsonb;
  v_kind text;
  v_amount integer;
  v_new_gold integer;
  v_new_comet_count integer;
  v_new_fallen_star_count integer;
  v_new_comet_scroll_count integer;
  v_new_fallen_star_scroll_count integer;
  v_new_lottery_ticket_count integer;
  v_next_free_at timestamptz;
  i integer;
begin
  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         lucky_free_ticket_claimed_at, lottery_ticket_count
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_free_claimed_at, v_lottery_ticket_count
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if p_use_ticket then
    if coalesce(v_lottery_ticket_count, 0) < 1 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_lottery_tickets');
    end if;
    v_payment := 'lottery_ticket';
  else
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

  v_new_lottery_ticket_count := v_lottery_ticket_count;

  if v_payment = 'lottery_ticket' then
    v_new_lottery_ticket_count := v_lottery_ticket_count - 1;
    update public.characters set lottery_ticket_count = v_new_lottery_ticket_count where id = p_character_id;
  elsif v_payment = 'ascension_points' then
    update public.players set ascension_points = ascension_points - 20 where id = v_account_id
    returning ascension_points into v_new_ap;
  else
    update public.characters set lucky_free_ticket_claimed_at = now() where id = p_character_id;
  end if;

  v_new_gold := v_gold;
  v_new_comet_count := v_comet_count;
  v_new_fallen_star_count := v_fallen_star_count;
  v_new_comet_scroll_count := v_comet_scroll_count;
  v_new_fallen_star_scroll_count := v_fallen_star_scroll_count;

  if v_kind = 'gold' then
    v_new_gold := v_gold + v_amount;
  elsif v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'fallen_star' then
    v_new_fallen_star_count := v_fallen_star_count + 1;
  elsif v_kind = 'comet_scroll' then
    v_new_comet_scroll_count := v_comet_scroll_count + 1;
  elsif v_kind = 'fallen_star_scroll' then
    v_new_fallen_star_scroll_count := v_fallen_star_scroll_count + 1;
  end if;

  update public.characters
  set
    gold = v_new_gold,
    comet_count = v_new_comet_count,
    fallen_star_count = v_new_fallen_star_count,
    comet_scroll_count = v_new_comet_scroll_count,
    fallen_star_scroll_count = v_new_fallen_star_scroll_count
  where id = p_character_id;

  select lucky_free_ticket_claimed_at + interval '6 hours' into v_next_free_at
  from public.characters where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'board', v_board,
    'won_index', p_card_index,
    'payment', v_payment,
    'cost', case when v_payment = 'ascension_points' then 20 when v_payment = 'lottery_ticket' then 1 else 0 end,
    'character', jsonb_build_object(
      'gold', v_new_gold,
      'comet_count', v_new_comet_count,
      'fallen_star_count', v_new_fallen_star_count,
      'comet_scroll_count', v_new_comet_scroll_count,
      'fallen_star_scroll_count', v_new_fallen_star_scroll_count,
      'lottery_ticket_count', v_new_lottery_ticket_count
    ),
    'ascension_points', v_new_ap,
    'next_free_ticket_at', v_next_free_at
  );
end;
$$;

revoke all on function public.draw_lucky_ticket(uuid, integer, boolean) from public;
grant execute on function public.draw_lucky_ticket(uuid, integer, boolean) to authenticated;

commit;
