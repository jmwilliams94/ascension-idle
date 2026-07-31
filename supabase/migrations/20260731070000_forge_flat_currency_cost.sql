-- Stage 3 of the Bank/Warehouse economy redesign (see CLAUDE.md's Accounts &
-- Characters -> Warehouse note, and stages 1-2's migrations). Forge's cost
-- model switches from a scaling formula (DragonBalls 1/2/3/4 by current
-- quality tier; Meteors 1 + floor(level/5)) to a flat 1 Meteor / 1 DragonBall
-- per attempt, regardless of the item's current tier/level -- confirmed with
-- the user. Cost is still spent from meteor_count/dragonball_count, the same
-- columns stage 1 turned into real Inventory-tile counts (not a separate
-- stored-currency balance) -- no qualifying unit on hand means no attempt is
-- possible at all, same "not_enough_meteors"/"not_enough_dragonballs" error
-- shape as before, just gated at 1 instead of a scaled amount.
--
-- Success chance/roll logic and the level-upgrade next-template-in-chain
-- mechanic are UNCHANGED in this stage -- only the cost constant moves.
begin;

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
  v_cost integer := 1;
  v_success_chance numeric := 0.7;
  v_dragonballs integer;
  v_upgraded boolean;
begin
  select owner_id, quality_tier into v_character_id, v_current_tier
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, dragonball_count into v_account_id, v_dragonballs
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
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

  if v_dragonballs < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_dragonballs',
      'cost', v_cost,
      'dragonballs', v_dragonballs
    );
  end if;

  update public.characters set dragonball_count = dragonball_count - v_cost where id = v_character_id;
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
  v_character_id uuid;
  v_account_id uuid;
  v_current_level integer;
  v_template_id uuid;
  v_item_family text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_cost integer := 1;
  v_success_chance numeric := 0.8;
  v_meteors integer;
  v_upgraded boolean;
begin
  select owner_id, level, template_id into v_character_id, v_current_level, v_template_id
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, meteor_count into v_account_id, v_meteors
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select item_family, required_level into v_item_family, v_required_level
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

  if v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', v_meteors
    );
  end if;

  update public.characters set meteor_count = meteor_count - v_cost where id = v_character_id;
  v_upgraded := random() < v_success_chance;

  if v_upgraded then
    update public.item_instances
    set template_id = v_next_template_id, level = v_next_required_level
    where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'level', case when v_upgraded then v_next_required_level else v_current_level end,
    'template_id', case when v_upgraded then v_next_template_id else v_template_id end,
    'meteors_spent', v_cost,
    'meteors_remaining', v_meteors - v_cost
  );
end;
$$;

commit;
