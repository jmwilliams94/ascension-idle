-- Enchantress (2026-08-13) — a new Forge tile: consume one gem (any of the
-- four types, any tier — only the tier matters here) to roll a flat HP bonus
-- onto a gear item. Reuses the item_instances.enchant jsonb column, which has
-- existed since the original schema but was unused until now. Stored shape:
-- {"hp": <int>}. One enchant slot per item, overwrite-only: a new roll only
-- replaces the stored value if it's higher — the gem is consumed either way.
-- No "un-enchant" path, matching this project's existing "gems can't be
-- removed" precedent from socket_gem (20260810040000_add_socket_gem.sql),
-- whose ownership-check shape this mirrors closely.
create or replace function public.enchant_item_hp(item_id uuid, gem_id text, gem_tier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_current_hp integer;
  v_gems jsonb;
  v_gem_key text;
  v_gem_owned integer;
  v_min integer;
  v_max integer;
  v_rolled integer;
  v_applied boolean;
begin
  if gem_id not in ('drake', 'ember', 'bastion', 'iris') then
    return jsonb_build_object('ok', false, 'error', 'invalid_gem');
  end if;
  if gem_tier not in ('normal', 'tempered', 'ascended') then
    return jsonb_build_object('ok', false, 'error', 'invalid_tier');
  end if;

  select owner_id, coalesce((enchant->>'hp')::integer, 0)
  into v_character_id, v_current_hp
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

  v_gem_key := gem_id || '_' || gem_tier;
  v_gem_owned := coalesce((v_gems ->> v_gem_key)::integer, 0);
  if v_gem_owned < 1 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gems');
  end if;

  -- Real reference ranges supplied by the user: Normal 1-59 HP, Tempered
  -- 100-159 HP, Ascended 200-255 HP.
  case gem_tier
    when 'normal' then v_min := 1; v_max := 59;
    when 'tempered' then v_min := 100; v_max := 159;
    else v_min := 200; v_max := 255;
  end case;

  v_rolled := v_min + floor(random() * (v_max - v_min + 1))::integer;
  v_applied := v_rolled > v_current_hp;

  v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_gem_key], to_jsonb(v_gem_owned - 1));
  update public.characters set gems = v_gems where id = v_character_id;

  if v_applied then
    update public.item_instances set enchant = jsonb_build_object('hp', v_rolled) where id = item_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rolled', v_rolled,
    'applied', v_applied,
    'enchant_hp', case when v_applied then v_rolled else v_current_hp end,
    'gems', v_gems
  );
end;
$$;

revoke all on function public.enchant_item_hp(uuid, text, text) from public;
grant execute on function public.enchant_item_hp(uuid, text, text) to authenticated;
