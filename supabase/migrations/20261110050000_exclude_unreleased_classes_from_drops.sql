-- Juggernaut/Twin-soul gear exists in the catalog (see
-- CLAUDE.accounts-and-classes.md) but neither class is unlocked for
-- character creation yet — the class-agnostic level-ranged drop pool
-- introduced by 20261110030000_class_agnostic_level_range_drops.sql picks
-- from *any* class's gear with no class filter at all, so it started
-- handing out both classes' gear on ordinary kills well before either class
-- is actually playable. Reported by the user, 2026-08-29.
--
-- Same signature as the latest version (20261110030000) — plain replace, no
-- drop needed. Remove the required_class exclusion (and the matching
-- UNRELEASED_DROP_CLASSES filter in useInventoryStore.ts's own
-- pickLevelAppropriateTemplate mirror) once those classes actually launch.
create or replace function public.pick_drop_template(p_level integer)
returns jsonb
language plpgsql
as $$
declare
  v_min_level integer := greatest(1, p_level - 40);
  v_family text;
  v_result jsonb;
begin
  select item_family into v_family
  from public.item_templates
  where item_family is not null
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag', 'promotion-gear', 'promotion-material', 'pickaxe', 'ore')
    and (required_class is null or required_class not in ('juggernaut', 'twin-soul'))
    and required_level between v_min_level and p_level
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select jsonb_build_object('id', id, 'required_level', required_level, 'slot_type', slot_type)
  into v_result
  from public.item_templates
  where item_family = v_family
    and required_level between v_min_level and p_level
  order by random()
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.pick_drop_template(integer) from public;
grant execute on function public.pick_drop_template(integer) to service_role;
