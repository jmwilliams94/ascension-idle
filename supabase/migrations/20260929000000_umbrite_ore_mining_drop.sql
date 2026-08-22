-- Umbrite Ore as a real Mining drop (Cinderleaf-only, requested by the
-- user) — closes the gap CLAUDE.accounts-and-classes.md flagged since
-- 2026-09-01 ("intended as a future Mining drop... no acquisition path
-- exists yet"). The actual roll/rate lives in resolve-mining/index.ts
-- (UMBRITE_ORE_DROP_CHANCE, UMBRITE_ORE_MINE_ID) — this migration only fixes
-- resolve_mining_apply_results' live-mode grant to use each drop's own
-- required_level instead of a hardcoded 1.
--
-- Bug this surfaces: Umbrite Ore's required_level is 40 (it's Falcon
-- Hunter's tier-40 promotion cost), not 1 like the plain Iron/Silver/Gold
-- Ore rows resolve_mining_apply_results was written against. Granting it
-- with a hardcoded level=1 would violate the "initial grant must set
-- item_instances.level to the template's own required_level" gotcha
-- (CLAUDE.gear-and-forge.md) — same regression class that's bitten
-- claim_loot_holding before. The Edge Function now passes required_level
-- per drop; this just reads it (falls back to 1 if omitted, for any older
-- caller/shape).
begin;

create or replace function public.resolve_mining_apply_results(
  p_character_id uuid,
  p_mode text,
  p_gem_drops jsonb default '[]'::jsonb,
  p_ore_drops jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_gem jsonb;
  v_ore jsonb;
  v_gems jsonb;
  v_key text;
  v_amount integer;
  v_owned integer;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
begin
  select coalesce(gems, '{}'::jsonb) into v_gems from public.characters where id = p_character_id for update;

  for v_gem in select * from jsonb_array_elements(p_gem_drops)
  loop
    v_key := v_gem ->> 'gem_key';
    v_amount := (v_gem ->> 'amount')::integer;
    v_owned := coalesce((v_gems ->> v_key)::integer, 0);
    v_gems := jsonb_set(v_gems, array[v_key], to_jsonb(v_owned + v_amount));
  end loop;

  update public.characters set gems = v_gems where id = p_character_id;

  for v_ore in select * from jsonb_array_elements(p_ore_drops)
  loop
    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, location)
      values (
        (v_ore ->> 'template_id')::uuid,
        p_character_id,
        coalesce((v_ore ->> 'required_level')::integer, 1),
        'normal', 0, 'inventory'
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level)
      values (p_character_id, (v_ore ->> 'template_id')::uuid, 'normal', 0);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'gems', v_gems, 'granted_items', v_granted_items);
end;
$$;

revoke all on function public.resolve_mining_apply_results(uuid, text, jsonb, jsonb) from public;
grant execute on function public.resolve_mining_apply_results(uuid, text, jsonb, jsonb) to service_role;

commit;
