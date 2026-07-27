-- Scales Quality/Level Upgrade costs with the item's current progression, replacing
-- the flat 1 DragonBall / 1 Meteor placeholder from
-- 20260727050000_add_quality_level_upgrade.sql. Still a placeholder curve — real
-- costs are unresolved per CLAUDE.md — just meant to feel meaningfully steeper for
-- later upgrades than earlier ones. CREATE OR REPLACE keeps the same signature, so
-- existing grants carry over untouched.

create or replace function public.quality_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_current_tier text;
  v_next_tier text;
  v_cost integer;
  -- PLACEHOLDER success chance — real values are unresolved per CLAUDE.md.
  v_success_chance numeric := 0.7;
  v_dragonballs integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier into v_owner_id, v_current_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  if v_owner_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_next_tier := case v_current_tier
    when 'normal' then 'refined'
    when 'refined' then 'unique'
    when 'unique' then 'elite'
    when 'elite' then 'super'
    else null
  end;

  if v_next_tier is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_quality', 'quality_tier', v_current_tier);
  end if;

  -- PLACEHOLDER scaling cost curve, unresolved per CLAUDE.md: 1 DragonBall at
  -- Normal, rising to 4 at Elite (the last upgradeable tier).
  v_cost := case v_current_tier
    when 'normal' then 1
    when 'refined' then 2
    when 'unique' then 3
    when 'elite' then 4
    else 1
  end;

  select dragonballs into v_dragonballs from public.players where id = auth.uid() for update;

  if v_dragonballs is null or v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', coalesce(v_dragonballs, 0)
    );
  end if;

  update public.players set dragonballs = dragonballs - v_cost where id = auth.uid();
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set quality_tier = v_next_tier where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'quality_tier', case when v_upgraded then v_next_tier else v_current_tier end,
    'dragonballs_spent', v_cost,
    'dragonballs_remaining', v_dragonballs - v_cost
  );
end;
$$;

create or replace function public.level_upgrade(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_current_level integer;
  -- PLACEHOLDER cap — real cap is unresolved per CLAUDE.md.
  v_level_cap integer := 130;
  v_cost integer;
  -- PLACEHOLDER success chance — real values are unresolved per CLAUDE.md.
  v_success_chance numeric := 0.8;
  v_meteors integer;
  v_upgraded boolean;
begin
  select owner_id, level into v_owner_id, v_current_level
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  if v_owner_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_current_level >= v_level_cap then
    return jsonb_build_object('ok', false, 'error', 'already_max_level', 'level', v_current_level);
  end if;

  -- PLACEHOLDER scaling cost curve, unresolved per CLAUDE.md: 1 Meteor per 5
  -- levels (e.g. still 1 at level 1-4, 2 at level 5-9, ... 27 by level 130).
  v_cost := 1 + (v_current_level / 5);

  select meteors into v_meteors from public.players where id = auth.uid() for update;

  if v_meteors is null or v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', coalesce(v_meteors, 0)
    );
  end if;

  update public.players set meteors = meteors - v_cost where id = auth.uid();
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances set level = level + 1 where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_current_level + 1 else v_current_level end,
    'meteors_spent', v_cost,
    'meteors_remaining', v_meteors - v_cost
  );
end;
$$;

grant execute on function public.quality_upgrade(uuid) to authenticated;
grant execute on function public.level_upgrade(uuid) to authenticated;
