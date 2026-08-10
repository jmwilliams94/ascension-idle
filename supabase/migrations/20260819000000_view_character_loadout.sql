-- "Inspect other player's gear" (2026-08-19, requested by the user) -- Global
-- Chat's character-name badges open a read-only view of that character's
-- currently equipped gear. No existing RLS policy lets a client read another
-- account's characters/item_instances rows at all (both are scoped to
-- account_id = auth.uid()), so this is a single SECURITY DEFINER RPC that
-- returns a safe public snapshot (name/level/class + each equipped slot's
-- item fields) rather than widening RLS on either table -- same reasoning as
-- the marketplace listing's item snapshot and seller_character_name: only
-- expose exactly what's needed to render the view, nothing else (no gold,
-- no currencies, no account id).
begin;

create or replace function public.view_character_loadout(p_character_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_level integer;
  v_class text;
  v_equipment jsonb;
begin
  select
    c.name, c.level, c.class,
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
  into v_name, v_level, v_class, v_equipment
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
    'equipment', v_equipment
  );
end;
$$;

-- No ownership check, deliberately -- unlike almost every other RPC in this
-- project, this one is meant to read a character that ISN'T the caller's
-- own. Every authenticated player can look up every other character's
-- currently equipped gear this way.
revoke all on function public.view_character_loadout(text) from public;
grant execute on function public.view_character_loadout(text) to authenticated;

commit;
