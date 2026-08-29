-- Monster drops are no longer class-specific and no longer pinned to a
-- single "closest level" template (requested by the user, 2026-08-29).
-- Every kill now draws from any class's gear whose required_level falls in
-- [max(1, monsterLevel - 40), monsterLevel] — a level-129/130 kill can drop
-- anything from level ~90 up to 130, across every class; a level-40 kill
-- drops from level 1-40. Same rule at every zone/level. Equip-time class
-- gating (required_class, checked elsewhere — Shop/Equipment/Bank) is
-- untouched: a wrong-class drop is still sellable/tradeable, just not
-- equippable by that character.
--
-- p_class is being dropped entirely, so the signature is changing — needs an
-- explicit drop first (create or replace with a different arg list creates
-- an ambiguous second overload instead of replacing).
drop function if exists public.pick_drop_template(text, integer);

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
