-- Enchantress "Bless" tab (2026-08-13) — a second Enchantress mechanic
-- alongside the existing HP roll (20260813000000_enchantress_hp_enchant.sql).
-- Consumes exactly one Ascended Bastion Gem (no other gem/tier accepted) to
-- advance a gear item's Blessed Damage Reduction along a fixed, deterministic
-- ladder: +1% -> +3% -> +5% -> +7%. Unlike the HP roll, there's no RNG here —
-- a Bless attempt always succeeds and always consumes its gem, provided the
-- item isn't already at the +7% ceiling (checked *before* spending the gem,
-- so a maxed item can't have a gem wasted on it — same "refuse the whole
-- attempt upfront" shape as composition_feed's already_max_composition
-- guard). Shares item_instances.enchant with the HP roll (stored shape now
-- {"hp": <int>, "blessPct": <int>}) — both functions below preserve
-- whichever of the two keys they don't touch via jsonb_set rather than
-- jsonb_build_object, and both return the item's full resulting `enchant`
-- object so the client can just overwrite its local copy wholesale instead
-- of hand-merging two independent RPC responses.

-- Fix: enchant_item_hp previously did
--   update ... set enchant = jsonb_build_object('hp', v_rolled)
-- which would have silently wiped out a blessPct key on the same item the
-- moment blessing existed. Switched to jsonb_set so it only ever touches its
-- own 'hp' key.
create or replace function public.enchant_item_hp(item_id uuid, gem_id text, gem_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_enchant jsonb;
  v_current_hp integer;
  v_gems jsonb;
  v_gem_key text;
  v_gem_owned integer;
  v_min integer;
  v_max integer;
  v_rolled integer;
  v_applied boolean;
  v_new_enchant jsonb;
begin
  if gem_id not in ('drake', 'ember', 'bastion', 'iris') then
    return jsonb_build_object('ok', false, 'error', 'invalid_gem');
  end if;
  if gem_tier not in ('normal', 'tempered', 'ascended') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;

  select owner_id, coalesce(enchant, '{}'::jsonb)
  into v_character_id, v_current_enchant
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  v_current_hp := coalesce((v_current_enchant->>'hp')::integer, 0);

  select account_id, gems into v_account_id, v_gems
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_gem_key := gem_id || '_' || gem_tier;
  v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
  if v_gem_owned < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gems');
  end if;

  case gem_tier
    when 'normal' then v_min := 1; v_max := 59;
    when 'tempered' then v_min := 100; v_max := 159;
    else v_min := 200; v_max := 255;
  end case;

  v_rolled := v_min + floor(random() * (v_max - v_min + 1))::integer;
  v_applied := v_rolled > v_current_hp;

  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned - 1));
  update public.characters set gems = v_gems where id = v_character_id;

  v_new_enchant := v_current_enchant;
  if v_applied then
    v_new_enchant := jsonb_set(v_new_enchant, array['hp'], to_jsonb(v_rolled));
    update public.item_instances set enchant = v_new_enchant where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rolled', v_rolled,
    'applied', v_applied,
    'enchant_hp', case when v_applied then v_rolled else v_current_hp end,
    'enchant', v_new_enchant,
    'gems', v_gems
  );
end;
$$;

-- Fixed ladder — mirrored client-side in gemCatalog.ts's BLESS_PCT_STEPS,
-- keep in sync.
create or replace function public.bless_item(item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_enchant jsonb;
  v_current_pct integer;
  v_next_pct integer;
  v_gems jsonb;
  v_gem_key text;
  v_gem_owned integer;
  v_new_enchant jsonb;
begin
  select owner_id, coalesce(enchant, '{}'::jsonb)
  into v_character_id, v_current_enchant
  from public.item_instances
  where id = item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'item_not_found');
  end if;

  select account_id, gems into v_account_id, v_gems
  from public.characters
  where id = v_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  v_current_pct := coalesce((v_current_enchant->>'blessPct')::integer, 0);

  v_next_pct := case
    when v_current_pct < 1 then 1
    when v_current_pct < 3 then 3
    when v_current_pct < 5 then 5
    when v_current_pct < 7 then 7
    else null
  end;

  if v_next_pct is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_bless');
  end if;

  v_gem_key := 'bastion_ascended';
  v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
  if v_gem_owned < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gems');
  end if;

  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned - 1));
  update public.characters set gems = v_gems where id = v_character_id;

  v_new_enchant := jsonb_set(v_current_enchant, array['blessPct'], to_jsonb(v_next_pct));
  update public.item_instances set enchant = v_new_enchant where id = item_id;

  return jsonb_build_object(
    'ok', true,
    'bless_pct', v_next_pct,
    'enchant', v_new_enchant,
    'gems', v_gems
  );
end;
$$;

revoke all on function public.bless_item(uuid) from public;
grant execute on function public.bless_item(uuid) to authenticated;
