-- First-login tutorial fixes (reported by the user after the first mobile
-- test pass):
--
-- 1. grant_tutorial_starter_kit now also grants a real, class-appropriate,
--    level 1 weapon straight into Inventory (unequipped) -- Lucky Bow for
--    Hunter, Lucky Backsword for Wuxia, same templates grant_starter_items
--    already uses. The tutorial's Level Upgrade step was targeting the
--    character's real *equipped* starter weapon, whose next tier (Sapling
--    Bow, required_level 8 for Hunter) exceeds a level-1 tutorial
--    character's own level -- ForgeStandardPanel's blockedByEquipLevel gate
--    (equipped items can't Level Upgrade past the character's own level)
--    then hides the Confirm button entirely, breaking the step. An
--    unequipped Inventory item has no such restriction (see that gate's own
--    "an item sitting in ordinary Inventory has no such restriction"
--    comment) -- and the player keeps their real equipped weapon untouched
--    throughout, gaining this tempered/leveled/socketed one as something to
--    equip once they're done.
--
-- 2. tutorial_level_upgrade's next-tier lookup now routes through
--    upgrade_chain_family() (see 20260807020000_lucky_bow_chains_into_bow.sql)
--    like every real level_upgrade/master_forge_upgrade already does --
--    Hunter's Lucky Bow is a singleton 'lucky-bow' family with no next tier
--    of its own; its real next tier lives in the 'bow' family. Without this,
--    the granted tutorial bow above would have reported already_max_level on
--    its very first (only) attempt.
begin;

-- ============================================================================
-- 1. grant_tutorial_starter_kit
-- ============================================================================
create or replace function public.grant_tutorial_starter_kit(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_repeatable constant boolean := true;
  v_already_completed timestamptz;
  v_gems jsonb;
  v_weapon_name text;
  v_template record;
  v_weapon_id uuid;
begin
  select account_id, class into v_account_id, v_class from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select tutorial_completed_at into v_already_completed from public.players where id = v_account_id for update;
  if not v_repeatable and v_already_completed is not null then
    return jsonb_build_object('ok', false, 'error', 'already_granted');
  end if;

  select gems into v_gems from public.characters where id = p_character_id for update;
  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array['iris_normal'], to_jsonb(coalesce((v_gems ->> 'iris_normal')::integer, 0) + 1));

  update public.characters
  set gems = v_gems, comet_count = comet_count + 1, fallen_star_count = fallen_star_count + 1
  where id = p_character_id;

  v_weapon_name := case v_class when 'hunter' then 'Lucky Bow' when 'wuxia' then 'Lucky Backsword' else null end;

  if v_weapon_name is not null then
    select id, required_level, slot_type into v_template from public.item_templates where name = v_weapon_name;
    if found then
      insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
      values (
        v_template.id, p_character_id, 'normal', v_template.required_level, '[]'::jsonb,
        coalesce(public.compute_max_durability(v_template.slot_type, v_template.required_level), 0)
      )
      returning id into v_weapon_id;
    end if;
  end if;

  update public.players set tutorial_completed_at = now() where id = v_account_id;

  return jsonb_build_object('ok', true, 'gems', v_gems, 'weapon_id', v_weapon_id);
end;
$$;

revoke all on function public.grant_tutorial_starter_kit(uuid) from public;
grant execute on function public.grant_tutorial_starter_kit(uuid) to authenticated;

-- ============================================================================
-- 2. tutorial_level_upgrade
-- ============================================================================
create or replace function public.tutorial_level_upgrade(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_item_family text;
  v_slot_type text;
  v_required_level integer;
  v_next_template_id uuid;
  v_next_required_level integer;
  v_sockets jsonb;
  v_comets integer;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select owner_id, template_id, coalesce(sockets, '[]'::jsonb)
  into v_character_id, v_template_id, v_sockets
  from public.item_instances
  where id = p_item_id
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

  if v_comets < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_comets');
  end if;

  select item_family, required_level, slot_type into v_item_family, v_required_level, v_slot_type
  from public.item_templates
  where id = v_template_id;

  if v_item_family is null then
    return jsonb_build_object('ok', false, 'error', 'no_upgrade_path');
  end if;

  select id, required_level into v_next_template_id, v_next_required_level
  from public.item_templates
  where item_family = public.upgrade_chain_family(v_item_family) and required_level > v_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_level');
  end if;

  update public.characters set comet_count = comet_count - 1 where id = v_character_id
  returning comet_count into v_comets;

  update public.item_instances
  set template_id = v_next_template_id, level = v_next_required_level
  where id = p_item_id;

  if v_slot_type = 'weapon' and jsonb_array_length(v_sockets) = 0 then
    update public.item_instances
    set sockets = v_sockets || 'null'::jsonb
    where id = p_item_id
    returning sockets into v_sockets;
  end if;

  return jsonb_build_object(
    'ok', true,
    'level', v_next_required_level,
    'template_id', v_next_template_id,
    'comets_remaining', v_comets,
    'sockets', v_sockets
  );
end;
$$;

revoke all on function public.tutorial_level_upgrade(uuid) from public;
grant execute on function public.tutorial_level_upgrade(uuid) to authenticated;

commit;
