-- Monster-kill drops now roll a random durability between 1 and the item's
-- max (requested by the user, 2026-08-29), instead of always landing at full
-- durability. Scoped ONLY to combat drops — shop purchases, promotion gear,
-- starter kits, and Lucky Lad/achievement rewards (which also flow through
-- loot_holding) are untouched and keep granting full durability.
--
-- loot_holding gets a new nullable `durability` column: null means "not a
-- combat-drop roll" (every other loot_holding source leaves it unset), a
-- rolled value means claim_loot_holding should honor it instead of
-- recomputing full max.
alter table public.loot_holding add column if not exists durability numeric;

-- resolve_combat_apply_results: same signature as the latest version
-- (20261105000000_server_side_mp_gating.sql) — plain replace. Only change:
-- roll a random durability from each drop's max_durability (already computed
-- client-side and passed in v_drop) instead of using the max directly, for
-- both the live-mode item_instances insert and the new offline-mode
-- loot_holding.durability column.
create or replace function public.resolve_combat_apply_results(
  p_character_id uuid,
  p_account_id uuid,
  p_monster_id text,
  p_mode text,
  p_kills_delta numeric,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_comet_scroll_delta integer default 0,
  p_durability_updates jsonb default '[]'::jsonb,
  p_pet_obtained boolean default false,
  p_item_drops jsonb default '[]'::jsonb,
  p_currency_drops jsonb default '[]'::jsonb,
  p_current_mp numeric default null
)
returns jsonb
language plpgsql
as $$
declare
  v_character_kills numeric;
  v_account_kills numeric;
  v_gold integer;
  v_comets integer;
  v_fallen_stars integer;
  v_comet_scrolls integer;
  v_drop jsonb;
  v_currency jsonb;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
  v_character_name text;
  v_monster_name text;
  v_max_durability numeric;
  v_rolled_durability numeric;
begin
  if p_kills_delta > 0 then
    insert into public.character_monster_kills (character_id, monster_id, kills)
    values (p_character_id, p_monster_id, p_kills_delta)
    on conflict (character_id, monster_id)
    do update set kills = public.character_monster_kills.kills + excluded.kills
    returning kills into v_character_kills;

    insert into public.account_monster_kills (account_id, monster_id, kills)
    values (p_account_id, p_monster_id, p_kills_delta)
    on conflict (account_id, monster_id)
    do update set kills = public.account_monster_kills.kills + excluded.kills
    returning kills into v_account_kills;
  end if;

  if p_pet_obtained then
    insert into public.account_pets (account_id, monster_id)
    values (p_account_id, p_monster_id)
    on conflict do nothing;

    if found then
      select name into v_character_name from public.characters where id = p_character_id;
      select display_name into v_monster_name from public.enemy_types where id = p_monster_id;

      insert into public.global_announcements (kind, character_name, message)
      values (
        'pet_obtained',
        v_character_name,
        v_character_name || ' obtained the ' || coalesce(v_monster_name, 'Unknown') || ' pet!'
      );
    end if;
  end if;

  if jsonb_array_length(p_durability_updates) > 0 then
    update public.item_instances ii
    set durability = (u ->> 'durability')::numeric
    from jsonb_array_elements(p_durability_updates) as u
    where ii.id = (u ->> 'id')::uuid and ii.owner_id = p_character_id;
  end if;

  -- Item drops: live mode grants straight into item_instances (already
  -- confirmed to fit at roll time — see resolve-combat's own room-check),
  -- offline mode always routes to loot_holding regardless of room.
  for v_drop in select * from jsonb_array_elements(p_item_drops)
  loop
    v_max_durability := coalesce((v_drop ->> 'max_durability')::numeric, 0);
    v_rolled_durability := case
      when v_max_durability > 0 then (1 + floor(random() * v_max_durability))
      else 0
    end;

    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, durability)
      values (
        (v_drop ->> 'template_id')::uuid,
        p_character_id,
        (v_drop ->> 'required_level')::integer,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        v_rolled_durability
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level, durability)
      values (
        p_character_id,
        (v_drop ->> 'template_id')::uuid,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        v_rolled_durability
      );
    end if;
  end loop;

  -- Currency drops: offline mode only (loot_holding routing) — live mode
  -- currency drops are plain deltas via p_comet_delta/p_fallen_star_delta.
  for v_currency in select * from jsonb_array_elements(p_currency_drops)
  loop
    insert into public.loot_holding (character_id, currency_type)
    values (p_character_id, v_currency ->> 'currency_type');
  end loop;

  update public.characters
  set
    gold = gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = comet_count + p_comet_delta,
    fallen_star_count = fallen_star_count + p_fallen_star_delta,
    comet_scroll_count = comet_scroll_count + p_comet_scroll_delta,
    current_mp = coalesce(p_current_mp, current_mp)
  where id = p_character_id
  returning gold, comet_count, fallen_star_count, comet_scroll_count
  into v_gold, v_comets, v_fallen_stars, v_comet_scrolls;

  return jsonb_build_object(
    'gold', v_gold,
    'comet_count', v_comets,
    'fallen_star_count', v_fallen_stars,
    'comet_scroll_count', v_comet_scrolls,
    'character_kills', v_character_kills,
    'account_kills', v_account_kills,
    'granted_items', v_granted_items
  );
end;
$$;

revoke all on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric
) from public;
grant execute on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric
) to service_role;

-- claim_loot_holding: same signature as the latest version
-- (20260814000000_add_gear_durability.sql) — plain replace. Only change:
-- honor a pre-rolled loot_holding.durability (set above for combat drops)
-- instead of always granting full max — every other loot_holding source
-- (Lucky Lad, achievements, etc.) never sets that column, so coalesce falls
-- through to the old "full durability" behavior for them unchanged.
create or replace function public.claim_loot_holding(holding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_currency_type text;
  v_composition_level integer;
  v_loot_durability numeric;
  v_required_level integer;
  v_slot_type text;
  v_item jsonb;
  v_new_count integer;
begin
  select character_id, template_id, quality_tier, currency_type, composition_level, durability
  into v_character_id, v_template_id, v_quality_tier, v_currency_type, v_composition_level, v_loot_durability
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_currency_type is not null then
    if v_currency_type = 'comet' then
      update public.characters set comet_count = comet_count + 1 where id = v_character_id
      returning comet_count into v_new_count;
    else
      update public.characters set fallen_star_count = fallen_star_count + 1 where id = v_character_id
      returning fallen_star_count into v_new_count;
    end if;

    delete from public.loot_holding where id = holding_id;

    return jsonb_build_object('ok', true, 'currency_type', v_currency_type, 'new_count', v_new_count);
  end if;

  select required_level, slot_type into v_required_level, v_slot_type from public.item_templates where id = v_template_id;

  insert into public.item_instances (template_id, owner_id, quality_tier, level, composition_level, durability)
  values (
    v_template_id,
    v_character_id,
    v_quality_tier,
    coalesce(v_required_level, 1),
    coalesce(v_composition_level, 0),
    coalesce(v_loot_durability, public.compute_max_durability(v_slot_type, coalesce(v_required_level, 1)), 0)
  )
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

revoke all on function public.claim_loot_holding(uuid) from public;
grant execute on function public.claim_loot_holding(uuid) to authenticated;
