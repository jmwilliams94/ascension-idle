-- Gear Durability (2026-08-14, requested by the user) — a gold sink tied to
-- equipped gear. Decay is driven by elapsed combat time (not damage taken —
-- this game has no server-authoritative damage-taken/death tracking to hook
-- into) and is folded into resolve_combat_apply_rewards' existing per-tick
-- call rather than a new RPC, specifically to avoid reintroducing the
-- PostgREST egress problem the 2026-08-13 drop-pool caching fix addressed
-- (see supabase/functions/resolve-combat/index.ts's own comments). At 0
-- durability an item stays equipped but contributes nothing to combat stats
-- (client: equipmentBonus.ts's computeEquipmentBonus; server: the equipped-
-- items loop in resolve-combat) and shows a broken badge client-side.
-- Repair is a single "Repair All" action (Shop's new Repair tab) — no
-- per-item picker. All numeric constants here are PLACEHOLDER, loosely
-- shaped like real Conquer reference data without matching it exactly (see
-- CLAUDE.md's Gear system section).
begin;

-- 1. Schema: durability column, numeric (not integer) so fractional
--    per-window decay accumulates exactly, same reasoning as the existing
--    character_monster_kills.kills fractional-kill-count fix.
alter table public.item_instances add column if not exists durability numeric not null default 0;
alter table public.item_instances add constraint item_instances_durability_check check (durability >= 0);

-- 2. Max durability is formula-derived from (slot_type, required_level), not
--    stored per-template — mirrors compute_upgrade_success_chance_pct's own
--    convention. No security definer/grant needed: only ever called
--    internally from other functions below, which already run with the
--    definer's privileges.
create or replace function public.compute_max_durability(slot_type text, required_level integer)
returns numeric
language plpgsql
as $$
declare
  v_base numeric;
  v_cap numeric;
  v_t numeric;
begin
  if slot_type in ('weapon', 'ring') then
    v_base := 10;
    v_cap := 70;
  elsif slot_type in ('necklace', 'boots', 'hat', 'coat') then
    v_base := 20;
    v_cap := 40;
  else
    -- Quiver (no durability at all) and anything else unrecognized.
    return null;
  end if;

  v_t := least(1, required_level::numeric / 110);
  return round(v_base + (v_cap - v_base) * v_t);
end;
$$;

revoke all on function public.compute_max_durability(text, integer) from public;

-- 3. Backfill existing rows to their computed max (there's no real prior wear
--    data to backfill instead — every item is treated as freshly-repaired).
--    Rows whose template has no durability concept (Quiver) are left at the
--    column default of 0, which is never read/displayed for that slot_type.
update public.item_instances ii
set durability = coalesce(public.compute_max_durability(it.slot_type, it.required_level), 0)
from public.item_templates it
where it.id = ii.template_id;

-- 4. Repair cost — flat gold, scaled by the item's own level/quality (2 gold
--    per required_level, times the existing QUALITY_STAT_MULTIPLIERS table
--    already used for sell-price scaling, for consistency).
create or replace function public.compute_repair_cost(required_level integer, quality_tier text)
returns integer
language plpgsql
as $$
declare
  v_multiplier numeric;
begin
  v_multiplier := case quality_tier
    when 'normal' then 1
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;
  return round(2 * required_level * v_multiplier)::integer;
end;
$$;

revoke all on function public.compute_repair_cost(integer, text) from public;

-- 5. Repair All — one flat action, no per-item picker (confirmed with the
--    user). Repairs every one of the character's own damaged items
--    (equipped, inventory, or bank — a resold/rebanked item's wear should
--    still be fixable), excluding Quiver (no durability concept at all).
create or replace function public.repair_all_items(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_gold integer;
  v_total_cost integer := 0;
  v_count integer := 0;
  v_repaired jsonb := '[]'::jsonb;
  v_item record;
  v_max numeric;
  v_cost integer;
begin
  select account_id, gold into v_account_id, v_gold
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  for v_item in
    select ii.id, ii.durability, ii.quality_tier, it.slot_type, it.required_level
    from public.item_instances ii
    join public.item_templates it on it.id = ii.template_id
    where ii.owner_id = p_character_id
      and it.slot_type <> 'quiver'
    for update of ii
  loop
    v_max := public.compute_max_durability(v_item.slot_type, v_item.required_level);

    if v_max is null or v_item.durability >= v_max then
      continue;
    end if;

    v_cost := public.compute_repair_cost(v_item.required_level, v_item.quality_tier);
    v_total_cost := v_total_cost + v_cost;
    v_count := v_count + 1;
    v_repaired := v_repaired || jsonb_build_object('id', v_item.id, 'durability', v_max);
  end loop;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'already_full');
  end if;

  if v_gold < v_total_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_total_cost, 'gold', v_gold);
  end if;

  update public.characters set gold = gold - v_total_cost where id = p_character_id
  returning gold into v_gold;

  update public.item_instances ii
  set durability = (r ->> 'durability')::numeric
  from jsonb_array_elements(v_repaired) as r
  where ii.id = (r ->> 'id')::uuid and ii.owner_id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'gold_spent', v_total_cost,
    'gold_remaining', v_gold,
    'items_repaired', v_count,
    'repaired_items', v_repaired
  );
end;
$$;

revoke all on function public.repair_all_items(uuid) from public;
grant execute on function public.repair_all_items(uuid) to authenticated;

-- 6. resolve_combat_apply_rewards gains a new p_durability_updates param
--    (applied inside this same call, not a separate RPC — see this
--    migration's header comment). Adding a parameter via create-or-replace
--    creates a second overload rather than replacing the existing one (the
--    same PostgREST-can't-disambiguate gotcha already documented for
--    p_comet_scroll_delta) — the old 8-arg signature must be dropped first.
drop function if exists public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, integer, timestamptz);

create or replace function public.resolve_combat_apply_rewards(
  p_character_id uuid,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_comet_scroll_delta integer default 0,
  p_resolved_at timestamptz default now(),
  p_durability_updates jsonb default '[]'::jsonb
)
returns table (gold integer, comet_count integer, fallen_star_count integer, comet_scroll_count integer)
language plpgsql
as $$
begin
  if jsonb_array_length(p_durability_updates) > 0 then
    update public.item_instances ii
    set durability = (u ->> 'durability')::numeric
    from jsonb_array_elements(p_durability_updates) as u
    where ii.id = (u ->> 'id')::uuid and ii.owner_id = p_character_id;
  end if;

  return query
  update public.characters
  set
    gold = characters.gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = characters.comet_count + p_comet_delta,
    fallen_star_count = characters.fallen_star_count + p_fallen_star_delta,
    comet_scroll_count = characters.comet_scroll_count + p_comet_scroll_delta,
    combat_last_resolved_at = p_resolved_at
  where characters.id = p_character_id
  returning characters.gold, characters.comet_count, characters.fallen_star_count, characters.comet_scroll_count;
end;
$$;

revoke all on function public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, integer, timestamptz, jsonb) from public;
grant execute on function public.resolve_combat_apply_rewards(uuid, integer, integer, integer, integer, integer, integer, timestamptz, jsonb) to service_role;

-- 7. Every other item_instances INSERT site needs durability set to its
--    computed max at creation — same "must stay in sync" gotcha already
--    documented for `level` on these exact functions. quality_upgrade/
--    level_upgrade/etc. never change durability (only these creation paths
--    do), so no other Forge RPC needs touching. Full list: claim_loot_holding,
--    withdraw_gear_composition, admin_send_mail (below), plus
--    claim_kill_count_reward's tier-6 Infused gear reward and
--    draw_lucky_ticket's 5 gear-creating branches (Money Bag/Gem Bag/Radiant
--    Bow/Radiant Coat/Ascended Random — further down).

-- 7a. claim_loot_holding (Loot Holding -> real item).
create or replace function public.claim_loot_holding(holding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_currency_type text;
  v_composition_level integer;
  v_required_level integer;
  v_slot_type text;
  v_item jsonb;
  v_new_count integer;
begin
  select character_id, template_id, quality_tier, currency_type, composition_level
  into v_character_id, v_template_id, v_quality_tier, v_currency_type, v_composition_level
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + 1 where id = v_character_id
      returning comet_count into v_new_count;
    else
      update public.characters set fallen_star_count = fallen_star_count + 1 where id = v_character_id
      returning fallen_star_count into v_new_count;
    end if;

    delete from public.loot_holding where id = holding_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  select required_level, slot_type into v_required_level, v_slot_type from public.item_templates where id = v_template_id;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, durability)
  values (
    v_template_id,
    v_character_id,
    v_quality_tier,
    coalesce(v_required_level, 1),
    coalesce(v_composition_level, 0),
    coalesce(public.compute_max_durability(v_slot_type, coalesce(v_required_level, 1)), 0)
  )
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

revoke all on function public.claim_loot_holding(uuid) from public;
grant execute on function public.claim_loot_holding(uuid) to authenticated;

-- 7b. withdraw_gear_composition (Bank composition points -> fresh item).
create or replace function public.withdraw_gear_composition(character_id uuid, template_id uuid, composition_level integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_points jsonb;
  v_slot_type text;
  v_required_level integer;
  v_owned integer;
  v_cost integer;
  v_new_item public.item_instances;
begin
  if composition_level < 0 or composition_level > 12 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select account_id into v_account_id from public.characters where id = character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, required_level into v_slot_type, v_required_level from public.item_templates where id = template_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;

  if v_slot_type is null or v_slot_type not in ('weapon', 'ring', 'necklace', 'boots', 'hat', 'coat') then
    return jsonb_build_object('ok', false, 'error', 'unsupported_slot_type');
  end if;

  select gear_composition_points into v_points from public.players where id = v_account_id for update;

  v_owned := coalesce((v_points ->> v_slot_type)::integer, 0);
  v_cost := public.composition_point_value(composition_level);

  if v_owned < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_points', 'required', v_cost, 'owned', v_owned);
  end if;

  v_points := jsonb_set(v_points, array[v_slot_type], to_jsonb(v_owned - v_cost));
  update public.players set gear_composition_points = v_points where id = v_account_id;

  insert into public.item_instances (owner_id, template_id, composition_level, durability)
  values (character_id, template_id, composition_level, coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0))
  returning * into v_new_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_new_item),
    'slot_type', v_slot_type,
    'gear_composition_points', v_points
  );
end;
$$;

revoke all on function public.withdraw_gear_composition(uuid, uuid, integer) from public;
grant execute on function public.withdraw_gear_composition(uuid, uuid, integer) to authenticated;

-- 7c. admin_send_mail's gear-gift item creation.
create or replace function public.admin_send_mail(p_target text, p_subject text, p_message text, p_rewards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_account_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_character record;
  v_recipient_count integer := 0;
  v_reward jsonb;
  v_reward_count integer;
  v_template_id uuid;
  v_required_level integer;
  v_slot_type text;
  v_new_item item_instances%rowtype;
begin
  select id into v_admin_account_id from auth.users where email = 'jmwilliams94@icloud.com';
  if v_admin_account_id is null or auth.uid() <> v_admin_account_id then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_subject is null or length(trim(p_subject)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'subject_required');
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'message_required');
  end if;

  v_reward_count := jsonb_array_length(coalesce(p_rewards, '[]'::jsonb));

  for v_character in
    select id from public.characters
    where p_target = 'all' or name = trim(p_target)
  loop
    v_recipient_count := v_recipient_count + 1;

    if v_reward_count = 0 then
      insert into public.mail (character_id, reason, mail_batch_id, sender_label, subject, message)
      values (v_character.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message);
    else
      for v_reward in select * from jsonb_array_elements(p_rewards)
      loop
        if v_reward ->> 'type' = 'item' then
          select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
          from public.item_templates where id = (v_reward ->> 'template_id')::uuid;

          if v_template_id is not null then
            insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, sockets, durability)
            values (
              v_template_id,
              v_character.id,
              coalesce(v_reward ->> 'quality_tier', 'normal'),
              v_required_level,
              coalesce((v_reward ->> 'composition_level')::integer, 0),
              '[]'::jsonb,
              coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
            )
            returning * into v_new_item;

            insert into public.mail (character_id, item_id, reason, mail_batch_id, sender_label, subject, message)
            values (v_character.id, v_new_item.id, 'admin_gift', v_batch_id, 'GM Switchee', p_subject, p_message);
          end if;
        elsif v_reward ->> 'type' = 'currency' then
          insert into public.mail (character_id, currency_type, amount, reason, mail_batch_id, sender_label, subject, message)
          values (
            v_character.id,
            v_reward ->> 'currency_type',
            greatest(1, coalesce((v_reward ->> 'amount')::integer, 1)),
            'admin_gift',
            v_batch_id,
            'GM Switchee',
            p_subject,
            p_message
          );
        end if;
      end loop;
    end if;
  end loop;

  if v_recipient_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;

  return jsonb_build_object('ok', true, 'batch_id', v_batch_id, 'recipient_count', v_recipient_count);
end;
$$;

-- 7d. claim_kill_count_reward's tier-6 "real Infused-quality gear item" reward.
create or replace function public.claim_kill_count_reward(p_character_id uuid, p_monster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_class text;
  v_kills numeric;
  v_current_index integer;
  v_next_index integer;
  v_threshold integer;
  v_comets_granted integer := 0;
  v_comet_scrolls_granted integer := 0;
  v_lottery_tickets_granted integer := 0;
  v_new_comets integer;
  v_new_comet_scrolls integer;
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

    insert into public.item_instances (template_id, owner_id, quality_tier, level, durability)
    select id, p_character_id, 'infused', required_level, coalesce(public.compute_max_durability(slot_type, required_level), 0)
    from public.item_templates
    where id = v_template_id
    returning to_jsonb(item_instances.*) into v_item;
  else
    case v_next_index
      when 1 then v_comets_granted := 2;
      when 2 then v_comets_granted := 3;
      when 3 then v_lottery_tickets_granted := 1;
      when 4 then v_comets_granted := 5; v_lottery_tickets_granted := 1;
      when 5 then v_comet_scrolls_granted := 1;
    end case;

    if v_comets_granted > 0 then
      update public.characters set comet_count = comet_count + v_comets_granted where id = p_character_id
      returning comet_count into v_new_comets;
    end if;
    if v_comet_scrolls_granted > 0 then
      update public.characters set comet_scroll_count = comet_scroll_count + v_comet_scrolls_granted where id = p_character_id
      returning comet_scroll_count into v_new_comet_scrolls;
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
    'comet_scrolls_granted', v_comet_scrolls_granted,
    'lottery_tickets_granted', v_lottery_tickets_granted,
    'comets_remaining', v_new_comets,
    'comet_scrolls_remaining', v_new_comet_scrolls,
    'lottery_tickets_remaining', v_new_lottery_tickets,
    'item', v_item
  );
end;
$$;

revoke all on function public.claim_kill_count_reward(uuid, text) from public;
grant execute on function public.claim_kill_count_reward(uuid, text) to authenticated;

-- 7e. draw_lucky_ticket's gear-creating branches (Money Bag/Gem Bag/Radiant
--     Bow/Radiant Coat/Ascended Random). Unchanged 3-arg signature, plain
--     create-or-replace is safe (per this function's own existing header
--     comment elsewhere in this project).
create or replace function public.draw_lucky_ticket(p_character_id uuid, p_card_index integer, p_use_ticket boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_character_name text;
  v_character_class text;
  v_free_claimed_at timestamptz;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_lottery_ticket_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_equipped_ids uuid[];
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
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_occupied integer;
  v_needs_room boolean;
  v_stone_key text;
  v_stone_owned integer;
  v_gem_id text;
  v_gem_tier text;
  v_gem_key text;
  v_gem_owned integer;
  v_template_id uuid;
  v_required_level integer;
  v_slot_type text;
  v_new_item item_instances%rowtype;
  v_granted_item jsonb;
  v_item_name text;
  i integer;
begin
  if p_card_index is null or p_card_index < 0 or p_card_index > 8 then
    return jsonb_build_object('ok', false, 'error', 'invalid_card_index');
  end if;

  select account_id, gold, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         lucky_free_ticket_claimed_at, lottery_ticket_count, name, class, composition_stones, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_gold, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_free_claimed_at, v_lottery_ticket_count, v_character_name, v_character_class, v_composition_stones, v_gems,
       v_equipped_ids
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

  for i in 0..8 loop
    v_board := v_board || jsonb_build_array(public.pick_lucky_reward());
  end loop;

  v_won := v_board -> p_card_index;
  v_kind := v_won ->> 'kind';
  v_amount := (v_won ->> 'amount')::integer;

  v_needs_room := v_kind in (
    'money_bag', 'gem_bag', 'composition_stone',
    'gem_tempered_drake', 'gem_tempered_ember', 'gem_tempered_bastion', 'gem_tempered_iris',
    'gem_ascended_drake', 'gem_ascended_ember', 'gem_ascended_bastion', 'gem_ascended_iris',
    'gear_radiant_bow', 'gear_radiant_coat', 'gear_ascended_random'
  );

  if v_needs_room then
    select count(*) into v_gear_count
    from public.item_instances
    where owner_id = p_character_id
      and location <> 'bank'
      and not (id = any(v_equipped_ids));

    select coalesce(sum((value)::integer), 0) into v_stone_count
    from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

    select coalesce(sum((value)::integer), 0) into v_gem_count
    from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

    select count(*) into v_potion_count
    from public.potion_stacks ps
    where ps.character_id = p_character_id and ps.count > 0;

    v_occupied := v_gear_count + v_stone_count + v_gem_count + v_potion_count
      + v_comet_count + v_fallen_star_count + v_comet_scroll_count + v_fallen_star_scroll_count;

    if v_occupied >= 40 then
      return jsonb_build_object('ok', false, 'error', 'not_enough_room');
    end if;
  end if;

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

  if v_kind = 'comet' then
    v_new_comet_count := v_comet_count + 1;
  elsif v_kind = 'fallen_star' then
    v_new_fallen_star_count := v_fallen_star_count + 1;
  elsif v_kind = 'comet_scroll' then
    v_new_comet_scroll_count := v_comet_scroll_count + 1;
  elsif v_kind = 'fallen_star_scroll' then
    v_new_fallen_star_scroll_count := v_fallen_star_scroll_count + 1;
  elsif v_kind = 'money_bag' then
    select id, slot_type into v_template_id, v_slot_type
    from public.item_templates where name = 'Class ' || v_amount || ' Money Bag';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gem_bag' then
    select id, slot_type into v_template_id, v_slot_type from public.item_templates where name = 'Random Gem Bag';

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'normal', 1, '[]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 1), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'composition_stone' then
    v_stone_key := v_amount::text;
    v_stone_owned := coalesce((v_composition_stones ->> v_stone_key)::integer, 0);
    v_composition_stones := jsonb_set(coalesce(v_composition_stones, '{}'::jsonb), array[v_stone_key], to_jsonb(v_stone_owned + 1));
    update public.characters set composition_stones = v_composition_stones where id = p_character_id;
  elsif v_kind like 'gem\_tempered\_%' escape '\' or v_kind like 'gem\_ascended\_%' escape '\' then
    -- Gem type/tier are now baked into the kind itself, e.g.
    -- 'gem_tempered_drake' -> id 'drake', tier 'tempered' (see
    -- pick_lucky_reward and LuckyRewardKind's own header for why).
    v_gem_id := split_part(v_kind, '_', 3);
    v_gem_tier := split_part(v_kind, '_', 2);
    v_gem_key := v_gem_id || '_' || v_gem_tier;
    v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
    v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned + 1));
    update public.characters set gems = v_gems where id = p_character_id;
  elsif v_kind = 'gear_radiant_bow' then
    select id, slot_type into v_template_id, v_slot_type
    from public.item_templates where name = 'Ranger''s Bow' and required_level = 15;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 15), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gear_radiant_coat' then
    select id, slot_type into v_template_id, v_slot_type
    from public.item_templates where name = 'Fawnhide Coat' and required_level = 15;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
    values (v_template_id, p_character_id, 'radiant', 15, '[null,null]'::jsonb, coalesce(public.compute_max_durability(v_slot_type, 15), 0))
    returning * into v_new_item;
    v_granted_item := to_jsonb(v_new_item);
  elsif v_kind = 'gear_ascended_random' then
    v_template_id := public.pick_ascended_reward_template(v_character_class);

    if v_template_id is not null then
      select required_level, slot_type into v_required_level, v_slot_type from public.item_templates where id = v_template_id;

      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (
        v_template_id, p_character_id, 'ascended', v_required_level, '[]'::jsonb,
        coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
      )
      returning * into v_new_item;
      v_granted_item := to_jsonb(v_new_item);
    end if;
  end if;

  -- Announcement scope (2026-08-10, confirmed with the user): anything at
  -- least as rare as Comet Scroll's own weight, minus Money Bags/Composition
  -- Stones (kept out deliberately — those already feel like a frequent
  -- progression drip, not a standout win). `kind` here stays the generic
  -- lucky_gem_tempered/lucky_gem_ascended discriminator (unchanged) — the
  -- specific gem name is already in the message text, which
  -- GlobalAnnouncementTicker.tsx's resolveAnnouncementIconSrc parses back
  -- out client-side for its icon. "LL" (was "Lucky Lad", shortened
  -- 2026-08-13).
  if v_kind = 'comet_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_comet_scroll', v_character_name, v_character_name || ' won a Comet Scroll from LL!');
  elsif v_kind = 'fallen_star_scroll' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star_scroll', v_character_name, v_character_name || ' won a Fallen Star Scroll from LL!');
  elsif v_kind = 'fallen_star' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_fallen_star', v_character_name, v_character_name || ' won a Fallen Star from LL!');
  elsif v_kind like 'gem\_tempered\_%' escape '\' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gem_tempered', v_character_name, v_character_name || ' won a Tempered ' || initcap(v_gem_id) || ' Gem from LL!');
  elsif v_kind like 'gem\_ascended\_%' escape '\' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gem_ascended', v_character_name, v_character_name || ' won an Ascended ' || initcap(v_gem_id) || ' Gem from LL!');
  elsif v_kind = 'gear_radiant_bow' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_radiant_bow', v_character_name, v_character_name || ' won a Radiant Ranger''s Bow from LL!');
  elsif v_kind = 'gear_radiant_coat' then
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_radiant_coat', v_character_name, v_character_name || ' won a Radiant Fawnhide Coat from LL!');
  elsif v_kind = 'gear_ascended_random' and v_granted_item is not null then
    select name into v_item_name from public.item_templates where id = v_template_id;
    insert into public.global_announcements (kind, character_name, message)
    values ('lucky_gear_ascended_random', v_character_name, v_character_name || ' won an Ascended ' || coalesce(v_item_name, 'item') || ' from LL!');
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
    'next_free_ticket_at', v_next_free_at,
    'granted_item', v_granted_item,
    'composition_stones', v_composition_stones,
    'gems', v_gems
  );
end;
$$;

revoke all on function public.draw_lucky_ticket(uuid, integer, boolean) from public;
grant execute on function public.draw_lucky_ticket(uuid, integer, boolean) to authenticated;

commit;
