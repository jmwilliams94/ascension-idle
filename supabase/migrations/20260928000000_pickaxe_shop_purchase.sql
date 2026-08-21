-- Pickaxe acquisition moved from a free auto-grant to a Shop purchase
-- (requested by the user, 2026-08-22) — mirrors the intent of the Hunter's
-- Quiver's original Shop-purchase design (the Quiver itself was later pulled
-- from the Shop entirely, 20260814000000, and is now granted free at
-- character creation instead — Pickaxe deliberately does NOT follow that
-- same walk-back, the user explicitly wants a real purchase step here).
--
-- Removes ensure_starter_pickaxe's lazy free-grant from both call sites
-- (pickaxe_tier_upgrade, resolve_mining_gather_state) — both now return/leave
-- a 'no_pickaxe' state instead, surfaced client-side by disabling Mine/Tier
-- Up until the player has actually bought one. ensure_starter_pickaxe itself
-- is dropped (no longer called anywhere).
--
-- Also fixes a real, separate room-count gap this surfaced: occupied_inventory_slots
-- (the shared "how full is this character's Inventory" helper used by
-- shop_buy_item/shop_buy_potion) never excluded equipped_pickaxe_id from its
-- equipped-ids array, so any character who already owns a Pickaxe (equipped,
-- not actually sitting in a visible Inventory slot) was silently counted as
-- 1 slot fuller than reality on every other purchase's room check. Known,
-- disclosed, NOT comprehensively fixed: several other functions
-- (resolve_combat_gather_state, draw_lucky_ticket, and others) independently
-- duplicate this same equipped-ids array rather than calling this shared
-- helper, and still don't exclude equipped_pickaxe_id — same category of
-- pre-existing duplication this project already has for this exact array,
-- not something newly introduced here. Left as a minor, disclosed gap rather
-- than a full sweep, since the practical impact is "off by one slot," not
-- data loss or a hard failure.
begin;

update public.item_templates
set price = 50
where name = 'Pickaxe' and item_family = 'pickaxe';

create or replace function public.occupied_inventory_slots(p_character_id uuid)
returns integer
language plpgsql
as $$
declare
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_equipped_ids uuid[];
begin
  select composition_stones, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id, equipped_pickaxe_id],
           null
         )
  into v_composition_stones, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_equipped_ids
  from public.characters
  where id = p_character_id;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

  select coalesce(sum((value)::integer), 0) into v_gem_count
  from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

  select count(*) into v_potion_count
  from public.potion_stacks where character_id = p_character_id and count > 0;

  return v_gear_count + v_stone_count + v_gem_count + v_potion_count
    + coalesce(v_comet_count, 0) + coalesce(v_fallen_star_count, 0)
    + coalesce(v_comet_scroll_count, 0) + coalesce(v_fallen_star_scroll_count, 0);
end;
$$;

-- Buys and immediately equips the base Pickaxe — no room check needed (it's
-- never actually unequipped/visible in the Inventory grid at any observable
-- point, same reasoning shop_buy_item's discard-then-recheck flow doesn't
-- apply here). Refuses a second purchase once one is already owned.
create or replace function public.shop_buy_pickaxe(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
  v_gold integer;
  v_template_id uuid;
  v_price integer;
  v_new_gold integer;
  v_new_item public.item_instances%rowtype;
begin
  select account_id, equipped_pickaxe_id, gold
  into v_account_id, v_equipped_pickaxe_id, v_gold
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_equipped_pickaxe_id is not null then
    return jsonb_build_object('ok', false, 'error', 'already_owned');
  end if;

  select id, price into v_template_id, v_price
  from public.item_templates
  where item_family = 'pickaxe'
  order by required_level asc
  limit 1;

  if v_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;
  if v_gold < v_price then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_price, 'gold', v_gold);
  end if;

  update public.characters set gold = gold - v_price where id = character_id
  returning gold into v_new_gold;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, location)
  values (v_template_id, character_id, 'normal', 1, 'inventory')
  returning * into v_new_item;

  update public.characters set equipped_pickaxe_id = v_new_item.id where id = character_id;

  return jsonb_build_object('ok', true, 'item', to_jsonb(v_new_item), 'gold', v_new_gold);
end;
$$;

revoke all on function public.shop_buy_pickaxe(uuid) from public;
grant execute on function public.shop_buy_pickaxe(uuid) to authenticated;

-- pickaxe_tier_upgrade: no more lazy free-grant -- refuses upfront with
-- 'no_pickaxe' instead. Otherwise unchanged from 20260927000000.
create or replace function public.pickaxe_tier_upgrade(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
  v_current_template_id uuid;
  v_current_name text;
  v_current_required_level integer;
  v_next_template_id uuid;
  v_next_name text;
  v_next_required_level integer;
  v_gems jsonb;
  v_gold integer;
  v_gold_cost integer;
  v_gem_amount integer;
  v_gem_keys text[];
  v_key text;
  v_gem_owned integer;
  v_ascended_gem_type text;
  i integer;
begin
  select account_id, equipped_pickaxe_id, gems, gold, pickaxe_ascended_gem_type
  into v_account_id, v_equipped_pickaxe_id, v_gems, v_gold, v_ascended_gem_type
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if v_equipped_pickaxe_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_pickaxe');
  end if;

  select ii.template_id, it.name, it.required_level
  into v_current_template_id, v_current_name, v_current_required_level
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = v_equipped_pickaxe_id
  for update of ii;

  select id, name, required_level into v_next_template_id, v_next_name, v_next_required_level
  from public.item_templates
  where item_family = 'pickaxe' and required_level > v_current_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_tier', 'template_id', v_current_template_id, 'name', v_current_name);
  end if;

  case v_next_name
    when 'Tempered Pickaxe' then
      v_gem_amount := 5; v_gold_cost := 100000;
      v_gem_keys := array['drake_normal', 'ember_normal', 'bastion_normal', 'iris_normal'];
    when 'Infused Pickaxe' then
      v_gem_amount := 1; v_gold_cost := 250000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'Radiant Pickaxe' then
      v_gem_amount := 5; v_gold_cost := 500000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'Ascended Pickaxe' then
      if v_ascended_gem_type is null then
        v_ascended_gem_type := (array['drake', 'ember', 'bastion', 'iris'])[floor(random() * 4)::int + 1];
        update public.characters set pickaxe_ascended_gem_type = v_ascended_gem_type where id = character_id;
      end if;
      v_gem_amount := 1; v_gold_cost := 0;
      v_gem_keys := array[v_ascended_gem_type || '_ascended'];
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_next_tier');
  end case;

  if v_gold < v_gold_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'gold_cost', v_gold_cost, 'gold', v_gold);
  end if;
  for i in 1..array_length(v_gem_keys, 1) loop
    v_key := v_gem_keys[i];
    v_gem_owned := coalesce((v_gems ->> v_key)::integer, 0);
    if v_gem_owned < v_gem_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gems', 'gem_key', v_key, 'needed', v_gem_amount, 'owned', v_gem_owned);
    end if;
  end loop;

  for i in 1..array_length(v_gem_keys, 1) loop
    v_key := v_gem_keys[i];
    v_gem_owned := coalesce((v_gems ->> v_key)::integer, 0);
    v_gems := jsonb_set(v_gems, array[v_key], to_jsonb(v_gem_owned - v_gem_amount));
  end loop;

  update public.characters
  set gems = v_gems, gold = gold - v_gold_cost
  where id = character_id
  returning gold into v_gold;

  update public.item_instances
  set template_id = v_next_template_id, level = v_next_required_level
  where id = v_equipped_pickaxe_id;

  return jsonb_build_object(
    'ok', true,
    'template_id', v_next_template_id,
    'name', v_next_name,
    'gold_spent', v_gold_cost,
    'gold_remaining', v_gold,
    'gems', v_gems,
    'ascended_gem_type', v_ascended_gem_type
  );
end;
$$;

revoke all on function public.pickaxe_tier_upgrade(uuid) from public;
grant execute on function public.pickaxe_tier_upgrade(uuid) to authenticated;

-- resolve_mining_gather_state: no more lazy free-grant -- v_equipped_pickaxe_id
-- simply stays null when the character has none, which the subsequent
-- pickaxe lookup (a SELECT ... INTO against a null id) already naturally
-- leaves v_pickaxe null for -- the Edge Function's existing `if (!pickaxe)`
-- branch (see resolve-mining/index.ts) already handles that. Otherwise
-- unchanged from 20260927000000.
create or replace function public.resolve_mining_gather_state(p_character_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_old_character jsonb;
  v_old_resolved_at timestamptz;
  v_new_resolved_at timestamptz := now();
  v_selected_mine_id text;
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
  v_rows_updated integer;
  v_claimed boolean;
  v_pickaxe jsonb;
  v_node jsonb;
  v_gear_count integer;
  v_holding_count integer;
begin
  select to_jsonb(c), c.mining_last_resolved_at, c.selected_mine_id, c.account_id, c.equipped_pickaxe_id
  into v_old_character, v_old_resolved_at, v_selected_mine_id, v_account_id, v_equipped_pickaxe_id
  from public.characters c
  where c.id = p_character_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.characters
  set mining_last_resolved_at = v_new_resolved_at
  where id = p_character_id and mining_last_resolved_at = v_old_resolved_at;
  get diagnostics v_rows_updated = row_count;
  v_claimed := v_rows_updated > 0;

  if not v_claimed or v_selected_mine_id is null then
    return jsonb_build_object(
      'ok', true,
      'claimed', v_claimed,
      'claimed_at', case when v_claimed then v_new_resolved_at else null end,
      'restore_at', v_old_resolved_at,
      'character', v_old_character,
      'node', null
    );
  end if;

  select jsonb_build_object(
    'id', ii.id,
    'template_id', ii.template_id,
    'composition_level', ii.composition_level,
    'physical_attack', coalesce((it.base_stats->>'physical_attack')::numeric, 0)
  )
  into v_pickaxe
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = v_equipped_pickaxe_id;

  select to_jsonb(n) into v_node from public.mining_nodes n where n.mine_id = v_selected_mine_id;

  if v_node is null then
    return jsonb_build_object(
      'ok', true,
      'claimed', true,
      'claimed_at', v_new_resolved_at,
      'restore_at', v_old_resolved_at,
      'character', v_old_character,
      'pickaxe', v_pickaxe,
      'node', null
    );
  end if;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id
    and location <> 'bank'
    and id <> v_equipped_pickaxe_id
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select count(*) into v_holding_count from public.loot_holding where character_id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'claimed', true,
    'claimed_at', v_new_resolved_at,
    'restore_at', v_old_resolved_at,
    'character', v_old_character,
    'pickaxe', v_pickaxe,
    'node', v_node,
    'gear_count', v_gear_count,
    'holding_count', v_holding_count
  );
end;
$$;

revoke all on function public.resolve_mining_gather_state(uuid) from public;
grant execute on function public.resolve_mining_gather_state(uuid) to service_role;

drop function if exists public.ensure_starter_pickaxe(uuid);

commit;
