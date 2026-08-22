-- Gear Lock + Gear Score + Leaderboard (requested by the user).
--
-- Lock: a per-item flag that blocks the item from being destroyed via Sell
-- (Shop), Salvage (Forge), Marketplace listing, Bank "Deposit as Composition"
-- (liquidate for composition points), or being fed as Composition fuel in the
-- Forge. Locking never blocks non-destructive actions (Level/Quality Upgrade,
-- physical Bank Storage deposit, being the *target* of a Composition feed).
--
-- Gear Score: quality tier (0-4) + unlocked socket count (0-2, filled or
-- empty) + composition_level literal (0-12) + enchant HP tier (0-3) + Bless
-- tier (0-4), summed across a character's 6 always-real equip slots plus
-- equipped_quiver_id when it isn't a real `quiver` slot_type item (Hunter's
-- ammo Quiver and Wuxia's non-interactive off-hand echo are excluded --
-- Wuxia's echo has no real item_instance there at all, so it's already
-- excluded structurally; only the real Quiver item needs an explicit filter).

alter table public.item_instances add column if not exists locked boolean not null default false;

-- Lock/unlock toggle -- ownership-checked, no other side effects.
create or replace function public.set_item_locked(p_item_id uuid, p_locked boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
begin
  select owner_id into v_character_id
  from public.item_instances
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  update public.item_instances set locked = p_locked where id = p_item_id;

  return jsonb_build_object('ok', true, 'locked', p_locked);
end;
$$;

revoke all on function public.set_item_locked(uuid, boolean) from public;
grant execute on function public.set_item_locked(uuid, boolean) to authenticated;

-- sell_item -- add a locked guard before the destructive delete. Body is
-- otherwise an unchanged copy of the latest version (20260814040000).
create or replace function public.sell_item(item_id uuid)
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
  v_locked boolean;
  v_price integer;
  v_multiplier numeric;
  v_sell_price integer;
  v_new_gold integer;
begin
  select owner_id, template_id, quality_tier, locked into v_character_id, v_template_id, v_quality_tier, v_locked
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'item_locked');
  end if;

  select price into v_price from public.item_templates where id = v_template_id;

  v_multiplier := case v_quality_tier
    when 'normal' then 1
    when 'tempered' then 1.25
    when 'infused' then 1.5
    when 'radiant' then 1.75
    when 'ascended' then 2
    else 1
  end;
  v_sell_price := round(coalesce(v_price, 0) * 0.5 * v_multiplier);

  delete from public.item_instances where id = item_id;

  update public.characters set gold = gold + v_sell_price where id = v_character_id
  returning gold into v_new_gold;

  return jsonb_build_object(
    'ok', true,
    'gold_gained', v_sell_price,
    'gold', v_new_gold
  );
end;
$$;

-- salvage_item -- same locked guard. Body otherwise an unchanged copy of the
-- latest version (20260807060000).
create or replace function public.salvage_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_quality_tier text;
  v_locked boolean;
  v_ap_gained integer;
  v_new_ap integer;
begin
  select owner_id, quality_tier, locked into v_character_id, v_quality_tier, v_locked
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'item_locked');
  end if;

  v_ap_gained := case v_quality_tier
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  delete from public.item_instances where id = item_id;

  update public.players set ascension_points = ascension_points + v_ap_gained where id = v_account_id
  returning ascension_points into v_new_ap;

  return jsonb_build_object(
    'ok', true,
    'ap_gained', v_ap_gained,
    'ascension_points', v_new_ap
  );
end;
$$;

-- deposit_item_as_composition -- same locked guard. Body otherwise an
-- unchanged copy of the latest version (20260813040000).
create or replace function public.deposit_item_as_composition(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_composition_level integer;
  v_locked boolean;
  v_slot_type text;
  v_points_gained integer;
  v_points jsonb;
begin
  select owner_id, template_id, composition_level, locked
  into v_character_id, v_template_id, v_composition_level, v_locked
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'item_locked');
  end if;

  select slot_type into v_slot_type from public.item_templates where id = v_template_id;

  if v_slot_type is null or v_slot_type not in ('weapon', 'ring', 'necklace', 'boots', 'hat', 'coat') then
    return jsonb_build_object('ok', false, 'error', 'unsupported_slot_type');
  end if;

  v_points_gained := public.composition_point_value(v_composition_level);

  if v_points_gained <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_points_contributed');
  end if;

  select gear_composition_points into v_points from public.players where id = v_account_id for update;
  v_points := jsonb_set(v_points, array[v_slot_type], to_jsonb(coalesce((v_points ->> v_slot_type)::integer, 0) + v_points_gained));
  update public.players set gear_composition_points = v_points where id = v_account_id;

  delete from public.item_instances where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'slot_type', v_slot_type,
    'points_gained', v_points_gained,
    'gear_composition_points', v_points
  );
end;
$$;

-- composition_feed -- guard fuel items only (the feed target is never
-- consumed, so it's unaffected by its own lock state). Body otherwise an
-- unchanged copy of the latest version (20260811040000).
create or replace function public.composition_feed(item_id uuid, stone_amounts jsonb, fuel_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_composition_level integer;
  v_composition_points integer;
  v_stones jsonb;
  v_new_stones jsonb;
  v_tier_key text;
  v_tier_amount integer;
  v_tier_num integer;
  v_owned integer;
  v_total_points integer := 0;
  v_fuel_ids uuid[];
  v_fuel_id uuid;
  v_fuel_owner uuid;
  v_fuel_level integer;
  v_fuel_locked boolean;
  v_required integer;
begin
  select owner_id, composition_level, composition_points into v_character_id, v_composition_level, v_composition_points
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, composition_stones into v_account_id, v_stones
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if public.composition_points_required(v_composition_level) is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_composition', 'composition_level', v_composition_level);
  end if;

  v_fuel_ids := array(select distinct unnest(coalesce(fuel_item_ids, array[]::uuid[])));

  for v_tier_key, v_tier_amount in select key, value::integer from jsonb_each_text(coalesce(stone_amounts, '{}'::jsonb))
  loop
    if v_tier_amount = 0 then
      continue;
    end if;

    v_tier_num := v_tier_key::integer;
    if v_tier_amount < 0 or v_tier_num < 1 or v_tier_num > 9 then
      return jsonb_build_object('ok', false, 'error', 'invalid_stone_tier', 'tier', v_tier_key);
    end if;

    v_owned := coalesce((v_stones ->> v_tier_key)::integer, 0);
    if v_owned < v_tier_amount then
      return jsonb_build_object(
        'ok', false,
        'error', 'not_enough_stones',
        'tier', v_tier_key,
        'owned', v_owned,
        'requested', v_tier_amount
      );
    end if;

    v_total_points := v_total_points + v_tier_amount * public.composition_point_value(v_tier_num);
  end loop;

  foreach v_fuel_id in array v_fuel_ids
  loop
    if v_fuel_id = item_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_is_target_item', 'item_id', v_fuel_id);
    end if;

    select owner_id, composition_level, locked into v_fuel_owner, v_fuel_level, v_fuel_locked
    from public.item_instances
    where id = v_fuel_id;

    if not found or v_fuel_owner <> v_character_id then
      return jsonb_build_object('ok', false, 'error', 'fuel_not_owned', 'item_id', v_fuel_id);
    end if;

    if v_fuel_locked then
      return jsonb_build_object('ok', false, 'error', 'fuel_locked', 'item_id', v_fuel_id);
    end if;

    if v_fuel_level > 0 then
      v_total_points := v_total_points + public.composition_point_value(v_fuel_level);
    end if;
  end loop;

  if v_total_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_points_contributed');
  end if;

  v_new_stones := v_stones;
  for v_tier_key, v_tier_amount in select key, value::integer from jsonb_each_text(coalesce(stone_amounts, '{}'::jsonb))
  loop
    if v_tier_amount > 0 then
      v_new_stones := jsonb_set(
        v_new_stones,
        array[v_tier_key],
        to_jsonb(coalesce((v_new_stones ->> v_tier_key)::integer, 0) - v_tier_amount)
      );
    end if;
  end loop;

  update public.characters set composition_stones = v_new_stones where id = v_character_id;

  if array_length(v_fuel_ids, 1) > 0 then
    delete from public.item_instances where id = any(v_fuel_ids);
  end if;

  declare
    v_result jsonb;
  begin
    v_result := '{}'::jsonb;
    loop
      v_required := public.composition_points_required(v_composition_level);
      exit when v_required is null or v_composition_points + v_total_points < v_required;
      v_total_points := v_total_points - v_required;
      v_composition_points := 0;
      v_composition_level := v_composition_level + 1;
    end loop;
    v_composition_points := v_composition_points + v_total_points;
  end;

  update public.item_instances
  set composition_level = v_composition_level, composition_points = v_composition_points
  where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'composition_level', v_composition_level,
    'composition_points', v_composition_points,
    'points_required_for_next', public.composition_points_required(v_composition_level),
    'stones', v_new_stones
  );
end;
$$;

-- Gear Score.
create or replace function public.compute_item_gear_score(
  p_quality_tier text,
  p_sockets jsonb,
  p_enchant jsonb,
  p_composition_level integer
)
returns integer
language sql
immutable
as $$
  select
    (case p_quality_tier
      when 'tempered' then 1
      when 'infused' then 2
      when 'radiant' then 3
      when 'ascended' then 4
      else 0
    end)
    + coalesce(jsonb_array_length(coalesce(p_sockets, '[]'::jsonb)), 0)
    + coalesce(p_composition_level, 0)
    + (case
        when (p_enchant ->> 'hp') is null then 0
        when (p_enchant ->> 'hp')::integer >= 200 then 3
        when (p_enchant ->> 'hp')::integer >= 100 then 2
        when (p_enchant ->> 'hp')::integer >= 1 then 1
        else 0
      end)
    + (case
        when (p_enchant ->> 'blessPct') is null then 0
        when (p_enchant ->> 'blessPct')::numeric >= 7 then 4
        when (p_enchant ->> 'blessPct')::numeric >= 5 then 3
        when (p_enchant ->> 'blessPct')::numeric >= 3 then 2
        when (p_enchant ->> 'blessPct')::numeric >= 1 then 1
        else 0
      end);
$$;

-- Sums gear score across a character's 6 always-real equip slots plus
-- equipped_quiver_id, excluding a real `quiver` slot_type item (Hunter's
-- stat-less ammo Quiver) -- Twin-soul's off-hand weapon and Juggernaut's
-- Shield sit in the same column but have real slot_types and DO count.
create or replace function public.get_character_gear_score(p_character_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    public.compute_item_gear_score(wi.quality_tier, wi.sockets, wi.enchant, wi.composition_level)
    + public.compute_item_gear_score(ri.quality_tier, ri.sockets, ri.enchant, ri.composition_level)
    + public.compute_item_gear_score(ni.quality_tier, ni.sockets, ni.enchant, ni.composition_level)
    + public.compute_item_gear_score(bi.quality_tier, bi.sockets, bi.enchant, bi.composition_level)
    + public.compute_item_gear_score(hi.quality_tier, hi.sockets, hi.enchant, hi.composition_level)
    + public.compute_item_gear_score(coi.quality_tier, coi.sockets, coi.enchant, coi.composition_level)
    + case
        when qt.slot_type is not null and qt.slot_type <> 'quiver'
        then public.compute_item_gear_score(qi.quality_tier, qi.sockets, qi.enchant, qi.composition_level)
        else 0
      end
  from public.characters c
  left join public.item_instances wi on wi.id = c.equipped_weapon_id
  left join public.item_instances ri on ri.id = c.equipped_ring_id
  left join public.item_instances ni on ni.id = c.equipped_necklace_id
  left join public.item_instances bi on bi.id = c.equipped_boots_id
  left join public.item_instances hi on hi.id = c.equipped_hat_id
  left join public.item_instances coi on coi.id = c.equipped_coat_id
  left join public.item_instances qi on qi.id = c.equipped_quiver_id
  left join public.item_templates qt on qt.id = qi.template_id
  where c.id = p_character_id;
$$;

revoke all on function public.get_character_gear_score(uuid) from public;
grant execute on function public.get_character_gear_score(uuid) to authenticated;

-- Leaderboard, same {ok, entries, self} response shape
-- get_world_boss_leaderboard already uses.
create or replace function public.get_gear_score_leaderboard(
  p_character_id uuid,
  p_class text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entries jsonb;
  v_self jsonb;
begin
  with scored as (
    select c.id, c.name, c.class, c.level, public.get_character_gear_score(c.id) as gear_score
    from public.characters c
    where p_class is null or c.class = p_class
  ),
  ranked as (
    select *, rank() over (order by gear_score desc) as rnk from scored
  )
  select jsonb_agg(jsonb_build_object(
    'rank', rnk, 'character_name', name, 'class', class, 'level', level, 'gear_score', gear_score
  ) order by rnk)
  into v_entries
  from (select * from ranked order by rnk limit p_limit) top_ranked;

  select jsonb_build_object('rank', rnk, 'gear_score', gear_score)
  into v_self
  from ranked
  where id = p_character_id;

  return jsonb_build_object('ok', true, 'entries', coalesce(v_entries, '[]'::jsonb), 'self', v_self);
end;
$$;

revoke all on function public.get_gear_score_leaderboard(uuid, text, integer) from public;
grant execute on function public.get_gear_score_leaderboard(uuid, text, integer) to authenticated;

-- view_character_loadout gains a gear_score field, same signature (safe
-- create or replace) -- so the "inspect gear" modal reused by the
-- Leaderboard can show the score alongside the loadout it's inspecting.
create or replace function public.view_character_loadout(p_character_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_level integer;
  v_class text;
  v_equipment jsonb;
begin
  select
    c.id, c.name, c.level, c.class,
    jsonb_build_object(
      'weapon', case when wi.id is not null then jsonb_build_object(
        'item_id', wi.id, 'template_id', wi.template_id, 'quality_tier', wi.quality_tier,
        'level', wi.level, 'composition_level', wi.composition_level,
        'sockets', coalesce(wi.sockets, '[]'::jsonb), 'durability', wi.durability, 'enchant', wi.enchant
      ) end,
      'ring', case when ri.id is not null then jsonb_build_object(
        'item_id', ri.id, 'template_id', ri.template_id, 'quality_tier', ri.quality_tier,
        'level', ri.level, 'composition_level', ri.composition_level,
        'sockets', coalesce(ri.sockets, '[]'::jsonb), 'durability', ri.durability, 'enchant', ri.enchant
      ) end,
      'necklace', case when ni.id is not null then jsonb_build_object(
        'item_id', ni.id, 'template_id', ni.template_id, 'quality_tier', ni.quality_tier,
        'level', ni.level, 'composition_level', ni.composition_level,
        'sockets', coalesce(ni.sockets, '[]'::jsonb), 'durability', ni.durability, 'enchant', ni.enchant
      ) end,
      'boots', case when bi.id is not null then jsonb_build_object(
        'item_id', bi.id, 'template_id', bi.template_id, 'quality_tier', bi.quality_tier,
        'level', bi.level, 'composition_level', bi.composition_level,
        'sockets', coalesce(bi.sockets, '[]'::jsonb), 'durability', bi.durability, 'enchant', bi.enchant
      ) end,
      'hat', case when hi.id is not null then jsonb_build_object(
        'item_id', hi.id, 'template_id', hi.template_id, 'quality_tier', hi.quality_tier,
        'level', hi.level, 'composition_level', hi.composition_level,
        'sockets', coalesce(hi.sockets, '[]'::jsonb), 'durability', hi.durability, 'enchant', hi.enchant
      ) end,
      'coat', case when coi.id is not null then jsonb_build_object(
        'item_id', coi.id, 'template_id', coi.template_id, 'quality_tier', coi.quality_tier,
        'level', coi.level, 'composition_level', coi.composition_level,
        'sockets', coalesce(coi.sockets, '[]'::jsonb), 'durability', coi.durability, 'enchant', coi.enchant
      ) end,
      'quiver', case when qi.id is not null then jsonb_build_object(
        'item_id', qi.id, 'template_id', qi.template_id, 'quality_tier', qi.quality_tier,
        'level', qi.level, 'composition_level', qi.composition_level,
        'sockets', coalesce(qi.sockets, '[]'::jsonb), 'durability', qi.durability, 'enchant', qi.enchant
      ) end
    )
  into v_id, v_name, v_level, v_class, v_equipment
  from public.characters c
  left join public.item_instances wi on wi.id = c.equipped_weapon_id
  left join public.item_instances ri on ri.id = c.equipped_ring_id
  left join public.item_instances ni on ni.id = c.equipped_necklace_id
  left join public.item_instances bi on bi.id = c.equipped_boots_id
  left join public.item_instances hi on hi.id = c.equipped_hat_id
  left join public.item_instances coi on coi.id = c.equipped_coat_id
  left join public.item_instances qi on qi.id = c.equipped_quiver_id
  where c.name = trim(p_character_name);

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'character', jsonb_build_object('name', v_name, 'level', v_level, 'class', v_class),
    'equipment', v_equipment,
    'gear_score', public.get_character_gear_score(v_id)
  );
end;
$$;

revoke all on function public.view_character_loadout(text) from public;
grant execute on function public.view_character_loadout(text) to authenticated;
