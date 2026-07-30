-- Level Upgrade redesign: a successful Level Upgrade now advances the item to
-- the NEXT item template in its own family's level-ordered chain (e.g. Tin Ring
-- (Lv1) -> Brass Ring (Lv10)) instead of a meaningless +1 to a bare `level`
-- number that had no effect on stats or name at all (computeEquipmentBonus only
-- ever read template.base_stats, never level — a previously-documented gap).
-- This closes that gap: leveling up now actually changes the item's identity.
--
-- item_family groups templates that belong to the same progression chain.
-- Distinct from slot_type, because slot_type 'weapon' currently holds both the
-- Bow chain (see 20260730000000_add_gear_catalog.sql) and the standalone
-- legacy "Wooden Sword" freebie, which must never be treated as part of the
-- same chain as the Bows.

alter table public.item_templates add column if not exists item_family text;

update public.item_templates set item_family = 'bow' where slot_type = 'weapon' and name like '%Bow';
update public.item_templates set item_family = 'sword' where name = 'Wooden Sword';
update public.item_templates set item_family = slot_type where item_family is null;

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
  -- PLACEHOLDER cost curve, unresolved per CLAUDE.md, unchanged by this step:
  -- 1 Meteor per 5 levels of the item's *own* current level number. Since level
  -- now jumps by a whole catalog tier per success (often 5-10 at once) rather
  -- than +1, costs climb noticeably faster than before this redesign — a
  -- direct, accepted consequence of the bigger jumps, not separately re-tuned.
  v_cost integer;
  -- PLACEHOLDER success chance — real values are unresolved per CLAUDE.md.
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

  select account_id, meteors into v_account_id, v_meteors
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

  v_cost := 1 + (v_current_level / 5);

  if v_meteors < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_meteors',
      'cost', v_cost,
      'meteors', v_meteors
    );
  end if;

  update public.characters set meteors = meteors - v_cost where id = v_character_id;
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

grant execute on function public.level_upgrade(uuid) to authenticated;
