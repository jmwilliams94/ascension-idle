-- Fixes a reported bug: an out-of-mana Wuxia (equipped Thunder skill,
-- currentPlayerMp hit 0) correctly stopped attacking client-side (see
-- useCombatStore.runTick's 'no-mana' gate, which blocks the attack outright
-- with no fallback), but resolve-combat/index.ts had zero knowledge that MP
-- existed at all -- its DPS/cycle-time reward math assumed the character
-- kept attacking at the theoretical rate for the entire elapsed window,
-- silently over-crediting kills/gold/EXP the whole time the player was
-- actually sitting idle. This was live-play-visible, not just an offline/
-- AFK edge case, since resolve-combat reconciles every ~4s
-- (RESOLVE_INTERVAL_MS) during a fight regardless.
--
-- New `characters.current_mp` column persists the MP pool server-side (null
-- = never tracked yet / presumed full, lazy-initialized the same way the
-- client's own currentPlayerMp is). No passive regen exists for MP (matches
-- HP's own "never regens" precedent), so once it hits 0 it stays 0 across
-- resolve calls until a Mana potion tops it back up.
--
-- resolve-combat/index.ts (code change, redeployed alongside this
-- migration) now reads current_mp, caps totalAttacks/the reward window's
-- effective elapsed time to whatever the starting MP can actually afford,
-- and passes the resulting new MP total back through
-- resolve_combat_apply_results' new p_current_mp param.
--
-- use_potion_stack now also credits current_mp when an MP-type potion is
-- used -- mirrors src/game/items/potionTypes.ts's MP tier heal amounts via a
-- case statement (the SQL side has no equivalent of the client's
-- attribute-interpolation table to compute a true max_mp cap, so this adds
-- without clamping to it; resolve-combat's own read clamps to the real max
-- on every resolve instead, self-correcting any minor overshoot).
begin;

alter table public.characters add column if not exists current_mp numeric;

-- Signature changes (new trailing param) -- explicit drop first per this
-- project's own "create or replace with a different signature creates an
-- ambiguous overload, not a replacement" gotcha.
drop function if exists public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb
);

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
    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, durability)
      values (
        (v_drop ->> 'template_id')::uuid,
        p_character_id,
        (v_drop ->> 'required_level')::integer,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        coalesce((v_drop ->> 'max_durability')::numeric, 0)
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level)
      values (
        p_character_id,
        (v_drop ->> 'template_id')::uuid,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer
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

-- use_potion_stack: now also credits current_mp on an MP potion use.
drop function if exists public.use_potion_stack(uuid, uuid);

create or replace function public.use_potion_stack(p_stack_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_character_id uuid;
  v_account_id uuid;
  v_count integer;
  v_new_count integer;
  v_potion_type text;
  v_restore_amount numeric;
begin
  select character_id, count, potion_type into v_owner_character_id, v_count, v_potion_type
  from public.potion_stacks
  where id = p_stack_id
  for update;

  if not found or v_owner_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_count <= 0 then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  update public.potion_stacks set count = count - 1 where id = p_stack_id
  returning count into v_new_count;

  -- Mirrors src/game/items/potionTypes.ts's MP-tier healAmount values — keep
  -- in sync. Only credited when current_mp is already a real (non-null)
  -- value — a null column means "presumed full" (see resolve-combat's own
  -- lazy-init read), and a potion used while already full is correctly a
  -- no-op, same as the client's own clamp-to-max restorePlayerMp.
  v_restore_amount := case v_potion_type
    when 'mossglow_tonic' then 8
    when 'whisperleaf_draught' then 15
    when 'moonpetal_elixir' then 25
    when 'starlight_brew' then 40
    when 'emberwind_panacea' then 55
    when 'nightbloom_draught' then 75
    when 'voidglass_elixir' then 100
    when 'astral_draught' then 130
    else null
  end;

  if v_restore_amount is not null then
    update public.characters
    set current_mp = current_mp + v_restore_amount
    where id = p_character_id and current_mp is not null;
  end if;

  return jsonb_build_object('ok', true, 'count', v_new_count);
end;
$$;

revoke all on function public.use_potion_stack(uuid, uuid) from public;
grant execute on function public.use_potion_stack(uuid, uuid) to authenticated;

commit;
