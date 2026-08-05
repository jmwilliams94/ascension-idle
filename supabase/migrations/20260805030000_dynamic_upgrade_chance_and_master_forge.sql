-- Dynamic Quality/Level Upgrade success chance + Master Forge (confirmed
-- with the user, 2026-08-05). Supersedes the flat 70%/80% success chances
-- quality_upgrade/level_upgrade have used since they were first built —
-- both now depend on the item's own level position within its family chain
-- AND its current quality tier, so upgrading is easy on cheap early gear and
-- gets meaningfully harder as the item gets better.
--
-- Level Upgrade (Comet) — base range by level position (linear from the
-- family's lowest required_level to its highest), Normal quality: 90% (at
-- the lowest level) down to 60% (at the highest level). Each quality tier
-- above Normal HALVES the chance (a compounding x0.5 multiplier) — the user
-- supplied a real reference point mid-design ("upgrading super gear from
-- level 100 to 110 used to cost about 20-40 comets in game," i.e. an
-- expected ~2.5-5% success chance at max quality near max level, since
-- materials are spent per attempt regardless of outcome) and a clean
-- per-tier halving lands almost exactly there: 90/45/22.5/11.25/5.6% at the
-- low-level end, 60/30/15/7.5/3.75% at the high-level end, across
-- Normal/Tempered/Infused/Radiant/Ascended.
--
-- Quality Upgrade (Fallen Star) — same shape, gentler: Normal 85% (lowest
-- level) to 75% (highest level), x0.58 per quality tier above Normal.
-- Retuned same day from an initial x0.65 (giving ~21-23% at Radiant) after
-- the user asked for Radiant->Ascended specifically to land "closer to the
-- 15% mark" — x0.58 lands Radiant at ~14.6-16.6%. Still a placeholder guess
-- with no real reference point (unlike Level Upgrade's user-supplied
-- anchor), but deliberately kept softer than Level Upgrade's halving per the
-- user's own original framing that Level gets "significantly harder" while
-- Quality "scales down slightly."
--
-- compute_upgrade_success_chance_pct is the shared formula both
-- quality_upgrade/level_upgrade now call for their real RNG roll, and that
-- master_forge_upgrade (new, below) calls to price its guaranteed-success
-- offer without ever rolling anything.
create or replace function public.compute_upgrade_success_chance_pct(
  p_item_family text,
  p_required_level integer,
  p_quality_tier text,
  p_upgrade_type text
)
returns numeric
language plpgsql
as $$
declare
  v_min_level integer;
  v_max_level integer;
  v_t numeric;
  v_base_min numeric;
  v_base_max numeric;
  v_quality_index integer;
  v_tier_multiplier numeric;
  v_chance numeric;
begin
  select min(required_level), max(required_level)
  into v_min_level, v_max_level
  from public.item_templates
  where item_family = p_item_family;

  if v_min_level is null or v_max_level is null or v_max_level <= v_min_level then
    v_t := 0;
  else
    v_t := greatest(0, least(1, (p_required_level - v_min_level)::numeric / (v_max_level - v_min_level)));
  end if;

  v_quality_index := case p_quality_tier
    when 'normal' then 0
    when 'tempered' then 1
    when 'infused' then 2
    when 'radiant' then 3
    when 'ascended' then 4
    else 0
  end;

  if p_upgrade_type = 'level' then
    v_base_min := 90;
    v_base_max := 60;
    v_tier_multiplier := 0.5;
  else
    v_base_min := 85;
    v_base_max := 75;
    v_tier_multiplier := 0.58;
  end if;

  v_chance := (v_base_min - v_t * (v_base_min - v_base_max)) * power(v_tier_multiplier, v_quality_index);

  -- Clamped away from the literal 0/100 edges — a guaranteed-fail or
  -- guaranteed-succeed roll from this formula was never the intent, just a
  -- very hard or very easy one.
  return greatest(1, least(99, v_chance));
end;
$$;

revoke all on function public.compute_upgrade_success_chance_pct(text, integer, text, text) from public;

-- ============================================================================
-- quality_upgrade — success chance is now dynamic (see above), everything
-- else (flat 1 Fallen Star cost regardless of outcome, the independent ~1%
-- armor socket-unlock roll) is unchanged.
-- ============================================================================
create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_tier text;
  v_next_tier text;
  v_template_id uuid;
  v_slot_type text;
  v_item_family text;
  v_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric;
  v_socket_roll_chance numeric := 0.01;
  v_fallen_stars integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, fallen_star_count into v_account_id, v_fallen_stars
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, item_family, required_level into v_slot_type, v_item_family, v_required_level
  from public.item_templates where id = v_template_id;

  v_next_tier := case v_current_tier
    when 'normal' then 'tempered'
    when 'tempered' then 'infused'
    when 'infused' then 'radiant'
    when 'radiant' then 'ascended'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  if v_fallen_stars < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_fallen_stars',
      'cost', v_cost,
      'fallen_stars', v_fallen_stars
    );
  end if;

  v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_current_tier, 'quality') / 100.0;

  update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'fallen_stars_spent', v_cost,
    'fallen_stars_remaining', v_fallen_stars - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- level_upgrade — success chance is now dynamic (see above); gained a
-- quality_tier read (needed for the new formula, wasn't selected before) —
-- everything else (flat 1 Comet cost, next-template-in-chain lookup, the
-- independent ~1% armor socket-unlock roll) is unchanged.
-- ============================================================================
create or replace function public.level_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_level integer;
  v_quality_tier text;
  v_template_id uuid;
  v_item_family text;
  v_slot_type text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_cost integer := 1;
  v_success_chance numeric;
  v_socket_roll_chance numeric := 0.01;
  v_comets integer;
  v_upgraded boolean;
begin
  select owner_id, level, quality_tier, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_current_level, v_quality_tier, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, comet_count into v_account_id, v_comets
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select item_family, required_level, slot_type into v_item_family, v_required_level, v_slot_type
  from public.item_templates
  where id = v_template_id;

  if v_item_family is null then
    return jsonb_build_object('ok', false, 'error', 'no_upgrade_path');
  end if;

  select id, required_level into v_next_template_id, v_next_required_level
  from public.item_templates
  where item_family = v_item_family and required_level > v_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  if v_comets < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_comets',
      'cost', v_cost,
      'comets', v_comets
    );
  end if;

  v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'level') / 100.0;

  update public.characters set comet_count = comet_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances
    set template_id = v_next_template_id, level = v_next_required_level
    where id = item_id;
  end if;

  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_next_required_level else v_current_level end,
    'template_id', case when v_upgraded then v_next_template_id else v_template_id end,
    'comets_spent', v_cost,
    'comets_remaining', v_comets - v_cost,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

-- ============================================================================
-- master_forge_upgrade — new. Guarantees success on either upgrade type for
-- a price: 1.5x the expected manual cost (1 / success_chance, since a manual
-- attempt costs 1 currency regardless of outcome), rounded up, in the same
-- currency the manual path would use. Confirmed with the user, 2026-08-05.
--
-- Level Upgrade specifically gets a guard manual Level Upgrade deliberately
-- doesn't have: it refuses to produce a result above the character's own
-- level. The user's own reasoning for scoping this to Master Forge only:
-- players sometimes level-upgrade cheap Shop-bought gear purely to farm the
-- armor socket-unlock roll, or to resell for gold, with no intention of ever
-- equipping the result — manual upgrades need to keep supporting that.
-- Master Forge's guaranteed, premium result is assumed to be for actual use,
-- so blocking a result the character can't even equip yet is the right
-- default there specifically.
-- ============================================================================
create or replace function public.master_forge_upgrade(item_id uuid, upgrade_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_character_level integer;
  v_template_id uuid;
  v_item_family text;
  v_required_level integer;
  v_slot_type text;
  v_quality_tier text;
  v_current_level integer;
  v_sockets jsonb;
  v_socket_count integer;
  v_socket_gained boolean := false;
  v_socket_roll_chance numeric := 0.01;
  v_success_chance numeric;
  v_cost integer;
  v_next_tier text;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_currency_owned integer;
begin
  if upgrade_type not in ('quality', 'level') then
    return jsonb_build_object('ok', false, 'error', 'invalid_upgrade_type');
  end if;

  select owner_id, quality_tier, level, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_quality_tier, v_current_level, v_template_id, v_sockets
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, level into v_account_id, v_character_level
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select slot_type, item_family, required_level into v_slot_type, v_item_family, v_required_level
  from public.item_templates where id = v_template_id;

  if upgrade_type = 'quality' then
    v_next_tier := case v_quality_tier
      when 'normal' then 'tempered'
      when 'tempered' then 'infused'
      when 'infused' then 'radiant'
      when 'radiant' then 'ascended'
      else null
    end;

    if v_next_tier is null then
      return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_quality_tier);
    end if;

    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'quality') / 100.0;
  else
    if v_item_family is null then
      return jsonb_build_object('ok', false, 'error', 'no_upgrade_path');
    end if;

    select id, required_level into v_next_template_id, v_next_required_level
    from public.item_templates
    where item_family = v_item_family and required_level > v_required_level
    order by required_level asc
    limit 1;

    if v_next_template_id is null then
      return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
    end if;

    if v_next_required_level > v_character_level then
      return jsonb_build_object(
        'ok', false,
        'error', 'exceeds_character_level',
        'result_level', v_next_required_level,
        'character_level', v_character_level
      );
    end if;

    v_success_chance := public.compute_upgrade_success_chance_pct(v_item_family, v_required_level, v_quality_tier, 'level') / 100.0;
  end if;

  v_cost := ceil((1.0 / v_success_chance) * 1.5);

  if upgrade_type = 'quality' then
    select fallen_star_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_fallen_stars', 'cost', v_cost, 'fallen_stars', v_currency_owned);
    end if;
    update public.characters set fallen_star_count = fallen_star_count - v_cost where id = v_character_id
    returning fallen_star_count into v_currency_owned;
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  else
    select comet_count into v_currency_owned from public.characters where id = v_character_id;
    if v_currency_owned < v_cost then
      return jsonb_build_object('ok', false, 'error', 'not_enough_comets', 'cost', v_cost, 'comets', v_currency_owned);
    end if;
    update public.characters set comet_count = comet_count - v_cost where id = v_character_id
    returning comet_count into v_currency_owned;
    update public.item_instances set template_id = v_next_template_id, level = v_next_required_level where id = item_id;
  end if;

  -- Same independent armor socket-unlock roll every manual upgrade attempt
  -- already gets — Master Forge doesn't remove it, just guarantees the main
  -- roll.
  v_socket_count := jsonb_array_length(v_sockets);
  if v_slot_type in ('ring', 'necklace', 'boots', 'hat', 'coat')
     and v_socket_count < 2
     and random() < v_socket_roll_chance then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = item_id
    returning sockets into v_sockets;
    v_socket_gained := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgrade_type', upgrade_type,
    'cost', v_cost,
    'quality_tier', case when upgrade_type = 'quality' then v_next_tier else v_quality_tier end,
    'level', case when upgrade_type = 'level' then v_next_required_level else v_current_level end,
    'template_id', case when upgrade_type = 'level' then v_next_template_id else v_template_id end,
    'fallen_stars_remaining', case when upgrade_type = 'quality' then v_currency_owned else null end,
    'comets_remaining', case when upgrade_type = 'level' then v_currency_owned else null end,
    'sockets', v_sockets,
    'socket_gained', v_socket_gained
  );
end;
$$;

revoke all on function public.master_forge_upgrade(uuid, text) from public;
grant execute on function public.master_forge_upgrade(uuid, text) to authenticated;
